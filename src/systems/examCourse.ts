import * as THREE from 'three';
import { chassisBody, carYaw, CAR_HALF_WIDTH } from '../entities/player';
import { COURSE } from '../world/examCourse';
import { RB, ARMS, ringInfo, wrapAngle, type ArmId } from '../world/roundabout';
import type { ExamRouteId } from '../world/examRoutes';
import { claimPlayerBay, playerBay, playerParked } from '../entities/examTraffic';
import { CONFIG, type PenaltyCode } from '../config';
import { gameState } from '../state/gameState';
import { triggerInfraction } from './rules';
import { controlState } from './input';
import { showToast } from '../game/hud';
import { showTutorialStep, setTutorialHint } from '../ui/tutorialPanel';
import { kbdHtml } from '../state/keybindings';

// The exam circuit's own step list — structured like systems/tutorial.ts's STEPS (an ordered,
// always-advancing script with its own completion test per step) but self-contained, since this
// course chains maneuvers the tutorial doesn't (both parking styles, a roundabout with a
// required exit, a U-turn) into one fixed run, then reports a four-category score modelled on
// the real exam's "Notas de Evaluación" sheet.
//
// The route is Ruta A or Ruta B, picked at random per run (world/examRoutes.ts has both): they
// differ up to the first óvalo exit — A goes straight on from the PARE for the speed run along the
// top road and takes the óvalo's first exit, B turns left onto road 3, over the speed bump, and
// goes all the way round the óvalo from the south — then share the rest: diagonal bay, a second
// full turn of the óvalo to come back the way you came, parallel bay, SALIDA.

const kbd = kbdHtml;
const angleBetween = (a: number, b: number): number => Math.min(wrapAngle(a - b), wrapAngle(b - a));

interface Ctx { x: number; z: number; yaw: number; vx: number; vz: number; kmh: number }
interface St {
  stillFor?: number;
  stopped?: boolean;
  bumped?: boolean;
  inRing?: boolean;
  lastTheta?: number;
  swept?: number;
  exitArm?: string;
  faultSnapshot?: number;
}
interface Step { id: string; title: string; text: string | (() => string); hint?: (ctx: Ctx, s: St) => string; enter?: (ctx: Ctx, s: St) => void; update: (ctx: Ctx, s: St, dt: number) => boolean; final?: boolean }

function ctxNow(): Ctx {
  const p = chassisBody.position, v = chassisBody.velocity;
  return { x: p.x, z: p.z, yaw: carYaw(), vx: v.x, vz: v.z, kmh: v.length() * 3.6 };
}

// Sum of the parking-related infraction counts so far — snapshotted at the start of each bay's
// step and diffed at the end of it, so the final report can tell the two bays' faults apart even
// though systems/rules.ts's collision listener tallies them under the same handful of codes.
const PARK_CODES: PenaltyCode[] = ['PARK_CAR', 'PARK_CURB', 'PARK_SIGNAL'];
const parkFaultTotal = (): number => PARK_CODES.reduce((n, c) => n + (gameState.infractionCounts[c] ?? 0), 0);

let parallelFaults = 0, diagonalFaults = 0;

const X = COURSE.roads;

function stopStep(route: ExamRouteId): Step {
  return {
    id: 'stop', title: '1. Detente en la línea de PARE',
    text: route === 'A'
      ? `Estás en el carril derecho de la ENTRADA. Adelante hay una señal de PARE: detente por completo antes de la línea, cuenta hasta 3 y sigue <b>de frente</b>.`
      : `Estás en el carril izquierdo de la ENTRADA. Adelante hay una señal de PARE: detente por completo antes de la línea, cuenta hasta 3 y gira <b>a la izquierda</b> hacia la vía 3 con la direccional ${kbd('signalLeft')}.`,
    hint: (ctx, s) => (s.stopped ? '✔ Detención completa.' : ''),
    update(ctx, s, dt) {
      const before = ctx.z > COURSE.stopLineZ && ctx.z < COURSE.stopLineZ + 16;
      if (before && ctx.kmh < 2) s.stillFor = (s.stillFor ?? 0) + dt; else if (before) s.stillFor = 0;
      if ((s.stillFor ?? 0) > 1.2) s.stopped = true;
      if (ctx.z < COURSE.stopLineZ - 1.5) {
        if (!s.stopped) triggerInfraction('STOP_SIGN');
        if (route === 'B' && !controlState.signalLeft) triggerInfraction('TURN_SIGNAL');
        return true;
      }
      return false;
    },
  };
}

// Ruta A's second step: the speed run along the top road.
const speedStep: Step = {
  id: 'speed', title: '2. Demuestra tu manejo',
  text: `Sigue de frente por la avenida este. Tras la curva ("Trocha"), acelera en la recta superior hasta unos 30–35 km/h para mostrar control del vehículo, sin pasarte del límite, y sigue hacia el óvalo.`,
  hint: (ctx) => `Velocidad: ${Math.round(ctx.kmh)} km/h`,
  update: (ctx) => ctx.x < COURSE.speedGateX && ctx.z < X.ZT + 8 && ctx.kmh > 26,
};

// Ruta B's second step: road 3 westbound, over the speed bump, round the corner to the óvalo.
const roadThreeStep: Step = {
  id: 'road3', title: '2. Vía 3 y rompemuelles',
  text: `Sigue por la vía 3 hacia el oeste en el carril derecho. Pasa el rompemuelles despacio (menos de 15 km/h), respeta los semáforos y la cebra, y sigue la curva hasta la avenida oeste, rumbo al óvalo.`,
  hint: (ctx) => (Math.abs(ctx.x - COURSE.bump.x) < 25 && ctx.z > X.ZB - 6 ? `Rompemuelles: ${Math.round(ctx.kmh)} km/h` : ''),
  update(ctx, s) {
    if (!s.bumped && Math.abs(ctx.x - COURSE.bump.x) < 1 && Math.abs(ctx.z - COURSE.bump.z) < 4) {
      s.bumped = true;
      if (ctx.kmh > 15) triggerInfraction('BUMP');
    }
    return ctx.x < X.XW + 8 && ctx.z < X.ZB - X.RC - 2;
  },
};

// A pass through the óvalo that must leave by `exit`; `fullTurn` when that's the arm it came in by.
function ovaloStep(id: string, title: string, text: string, exit: ArmId, fullTurn: boolean): Step {
  return {
    id, title, text,
    hint: (ctx, s) => (s.exitArm && s.exitArm !== exit
      ? 'Saliste por el lado equivocado: vuelve a entrar y sal por donde indica el paso.'
      : fullTurn && s.inRing ? 'Da la vuelta completa al óvalo.' : ''),
    update(ctx, s) {
      const { r, theta } = ringInfo(ctx.x, ctx.z);
      const inRing = r < RB.outerR - 1 && r > RB.innerR;
      if (inRing) {
        if (!s.inRing) { s.swept = 0; s.exitArm = undefined; }
        else s.swept = (s.swept ?? 0) + Math.max(0, wrapAngle((s.lastTheta ?? theta) - theta + Math.PI) - Math.PI); // counter-clockwise only
        s.inRing = true;
        s.lastTheta = theta;
      }
      if (s.inRing && r > RB.outerR + 1) {
        s.inRing = false;
        s.exitArm = ARMS.reduce((best, a) => (angleBetween(theta, a.angle) < angleBetween(theta, best.angle) ? a : best)).id;
        return s.exitArm === exit && (!fullTurn || (s.swept ?? 0) > Math.PI);
      }
      return false;
    },
  };
}

// The bay each parking step sends the player to is drawn when the step starts, among the free
// ones (entities/examTraffic.ts); in the rare case none is free yet, it's drawn as soon as one is.
function waitForBay(kind: 'diag' | 'par'): number | null {
  const had = playerBay(kind);
  const bay = had ?? claimPlayerBay(kind);
  if (had === null && bay !== null) renderStep(index); // now there's a number to show
  return bay;
}

const diagonalStep: Step = {
  id: 'diagonal', title: '4. Estacionamiento diagonal',
  text: () => {
    const k = playerBay('diag');
    const where = k === null ? 'en la plaza que se te asigne (espera a que se libere una)' : `en la plaza <b>${COURSE.diagonal.label(k)}</b>`;
    return `Baja por la avenida oeste, gira a la izquierda hacia la vía interior y a la derecha al pasillo de estacionamiento. Estaciona de frente ${where} del estacionamiento diagonal (lado sur, marcada en verde), en 45°.`;
  },
  enter: (ctx, s) => { s.faultSnapshot = parkFaultTotal(); claimPlayerBay('diag'); },
  update(ctx, s) {
    const k = waitForBay('diag');
    if (k === null) return false;
    const { cz, yaw: diagYaw, pitch } = COURSE.diagonal;
    const cx = COURSE.diagonal.bayCx(k);
    const c = Math.cos(diagYaw), sn = Math.sin(diagYaw);
    const dx = ctx.x - cx, dz = ctx.z - cz;
    const u = dx * c - dz * sn, v = dx * sn + dz * c;
    const inside = Math.abs(u) <= 1.6 && Math.abs(v) <= pitch / 2 - 0.3;
    const angleOk = angleBetween(ctx.yaw, diagYaw) < THREE.MathUtils.degToRad(10);
    const parked = inside && angleOk && ctx.kmh < 1.5;
    s.stillFor = parked ? (s.stillFor ?? 0) + 1 / 60 : 0;
    if ((s.stillFor ?? 0) > 1.2) {
      diagonalFaults = parkFaultTotal() - (s.faultSnapshot ?? 0);
      playerParked('diag');
      return true;
    }
    return false;
  },
};

const parallelStep: Step = {
  id: 'parallel', title: '6. Estacionamiento en paralelo',
  text: () => {
    const n = playerBay('par');
    const where = n === null ? 'en la plaza que se te asigne (espera a que se libere una)' : `en la plaza <b>${n}</b>`;
    return `Sigue por la recta superior hacia el este, baja por la avenida este y gira a la derecha al pasillo. Estaciona en paralelo ${where} (lado norte, marcada en verde), junto a la vereda, y ajusta hasta quedar dentro del recuadro.`;
  },
  enter: (ctx, s) => { s.faultSnapshot = parkFaultTotal(); claimPlayerBay('par'); },
  hint: (ctx) => {
    const gap = (ctx.z - CAR_HALF_WIDTH) - COURSE.parallel.kerbZ;
    return `Distancia a la vereda: ${Math.round(Math.max(gap, 0) * 100)} cm`;
  },
  update(ctx, s) {
    const n = waitForBay('par');
    if (n === null) return false;
    const { kerbZ } = COURSE.parallel;
    const { frontX, rearX } = COURSE.parallel.bay(n);
    const inSlot = ctx.x > frontX && ctx.x < rearX && ctx.z > kerbZ + 0.8 && ctx.z < kerbZ + CONFIG.LANE_WIDTH * 2;
    const angleOk = angleBetween(ctx.yaw, Math.PI / 2) < THREE.MathUtils.degToRad(10);
    const gapOk = (ctx.z - CAR_HALF_WIDTH) - kerbZ < 0.7;
    const parked = inSlot && angleOk && gapOk && ctx.kmh < 1.5;
    s.stillFor = parked ? (s.stillFor ?? 0) + 1 / 60 : 0;
    if ((s.stillFor ?? 0) > 1.2) {
      parallelFaults = parkFaultTotal() - (s.faultSnapshot ?? 0);
      playerParked('par');
      return true;
    }
    return false;
  },
};

const finishStep: Step = {
  id: 'finish', title: '¡Circuito completado!',
  text: () => `Sal del estacionamiento, gira a la izquierda hacia la vía interior, otra vez a la izquierda en la vía 3 y a la derecha hacia la SALIDA.<br><br>${buildSummaryHtml()}`,
  final: true,
  update: (ctx, s, dt) => {
    const close = Math.hypot(ctx.x - COURSE.salida.x, ctx.z - COURSE.salida.z) < 6;
    s.stillFor = close ? (s.stillFor ?? 0) + dt : 0;
    return (s.stillFor ?? 0) > 0.5;
  },
};

function buildSteps(route: ExamRouteId): Step[] {
  const signal = kbd('signalRight');
  return [
    stopStep(route),
    route === 'A' ? speedStep : roadThreeStep,
    route === 'A'
      ? ovaloStep('roundabout', '3. Óvalo: primera salida',
        `Entra al óvalo cediendo el paso, circula en sentido antihorario y toma la <b>primera salida</b> (sur), hacia la avenida oeste, señalizando con ${signal} antes de salir.`, 'S', false)
      : ovaloStep('roundabout', '3. Óvalo: vuelta completa',
        `Entra al óvalo desde el sur cediendo el paso, da la <b>vuelta completa</b> en sentido antihorario y sal por la misma vía por la que entraste (sur), señalizando con ${signal} antes de salir.`, 'S', true),
    diagonalStep,
    ovaloStep('ovalo2', '5. Óvalo: regreso',
      `Sal de la plaza en reversa, sigue de frente por el pasillo y gira a la izquierda en la avenida este. Vuelve por la recta superior al óvalo, da la <b>vuelta completa</b> y sal por la misma vía por la que entraste (este), señalizando con ${signal} antes de salir.`, 'E', true),
    parallelStep,
    finishStep,
  ];
}

let STEPS: Step[] = buildSteps('A');

// Buckets the run's infractions into the exam's four "Notas de Evaluación" categories.
function buildSummaryHtml(): string {
  const n = (c: PenaltyCode): number => gameState.infractionCounts[c] ?? 0;
  const skill = n('COLLISION') + n('CURB_CRASH') + n('BUMP');
  const rules = n('M20') + n('G10') + n('G28') + n('G57') + n('M12') + n('STOP_SIGN') + n('TURN_SIGNAL') + n('RB_YIELD') + n('RB_SIGNAL') + n('NO_PARK');
  return `
    <b>Habilidad conductiva:</b> ${skill} falta(s)<br>
    <b>Reglas de tránsito:</b> ${rules} falta(s)<br>
    <b>Estacionamiento diagonal:</b> ${diagonalFaults} falta(s)<br>
    <b>Estacionamiento paralelo:</b> ${parallelFaults} falta(s)`;
}

let index = -1;
let stepState: St = {};
let onComplete: (() => void) | null = null;
let finished = false;

// For systems/examAutopilot.ts: which step it should be driving for right now.
export function currentExamStepId(): string | null { return STEPS[index]?.id ?? null; }

function renderStep(i: number): void {
  const step = STEPS[i];
  showTutorialStep({
    label: step.final ? '¡LISTO!' : `PASO ${i + 1} / ${STEPS.length - 1}`,
    title: step.title.replace(/^\d+\.\s*/, ''),
    html: typeof step.text === 'function' ? step.text() : step.text,
    progress: i / (STEPS.length - 1),
  });
}

// `enter` runs first: a parking step draws its bay there, and its text names it.
function showStep(i: number): void {
  index = i;
  stepState = {};
  STEPS[i].enter?.(ctxNow(), stepState);
  renderStep(i);
}

export function initExamCourse({ route, onDone }: { route: ExamRouteId; onDone?: () => void }): void {
  STEPS = buildSteps(route);
  onComplete = onDone ?? null;
  finished = false;
  parallelFaults = 0; diagonalFaults = 0;
  showToast(`Examen Oficial MTC — Ruta ${route}`, 'Sigue los pasos del panel — el circuito reproduce el examen práctico de manejo.');
  showStep(0);
}

export function updateExamCourse(dt: number): void {
  if (finished || index < 0) return;
  const ctx = ctxNow();
  const step = STEPS[index];

  const done = step.update(ctx, stepState, dt);
  const hint = step.hint?.(ctx, stepState);
  if (hint !== undefined) setTutorialHint(hint);

  if (!done) return;
  if (step.final) {
    finished = true;
    onComplete?.();
    return;
  }
  showToast('✓ Bien hecho', step.title.replace(/^\d+\.\s*/, ''), 'good');
  showStep(index + 1);
}
