import * as THREE from 'three';
import { chassisBody, carYaw, CAR_HALF_WIDTH } from '../entities/player';
import { COURSE } from '../world/examCourse';
import { RB, ARMS, ringInfo, wrapAngle } from '../world/roundabout';
import type { PenaltyCode } from '../config';
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

const kbd = kbdHtml;
const angleBetween = (a: number, b: number): number => Math.min(wrapAngle(a - b), wrapAngle(b - a));

interface Ctx { x: number; z: number; yaw: number; vx: number; vz: number; kmh: number }
interface St {
  stillFor?: number;
  stopped?: boolean;
  signaled?: boolean;
  inRing?: boolean;
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

const STEPS: Step[] = [
  {
    id: 'stop', title: '1. Detente en la línea de PARE',
    text: `Adelante hay una señal de PARE, la primera del circuito de evaluación. Detente por completo antes de la línea, cuenta hasta 3 y continúa.`,
    hint: (ctx, s) => (s.stopped ? '✔ Detención completa.' : ''),
    update(ctx, s, dt) {
      const before = ctx.z > COURSE.stopLineZ && ctx.z < COURSE.stopLineZ + 16;
      if (before && ctx.kmh < 2) s.stillFor = (s.stillFor ?? 0) + dt; else if (before) s.stillFor = 0;
      if ((s.stillFor ?? 0) > 1.2) s.stopped = true;
      if (ctx.z < COURSE.stopLineZ - 1.5) {
        if (!s.stopped) triggerInfraction('STOP_SIGN');
        return true;
      }
      return false;
    },
  },
  {
    id: 'parallel', title: '2. Estacionamiento en paralelo',
    text: `Estaciona junto a la vereda, entre las dos líneas pintadas, en paralelo. Retrocede con la direccional puesta y ajusta hasta quedar dentro del recuadro.`,
    enter: (ctx, s) => { s.faultSnapshot = parkFaultTotal(); },
    hint: (ctx) => {
      const gap = COURSE.kerbX - (ctx.x + CAR_HALF_WIDTH);
      return `Distancia a la vereda: ${Math.round(Math.max(gap, 0) * 100)} cm`;
    },
    update(ctx, s) {
      const { frontZ, rearZ } = COURSE.parallel;
      const inSlot = ctx.z < rearZ && ctx.z > frontZ && ctx.x > 0.8 && ctx.x < COURSE.kerbX;
      const angleOk = Math.abs(ctx.yaw) < THREE.MathUtils.degToRad(10);
      const gapOk = COURSE.kerbX - (ctx.x + CAR_HALF_WIDTH) < 0.7;
      const parked = inSlot && angleOk && gapOk && ctx.kmh < 1.5;
      s.stillFor = parked ? (s.stillFor ?? 0) + 1 / 60 : 0;
      if ((s.stillFor ?? 0) > 1.2) {
        parallelFaults = parkFaultTotal() - (s.faultSnapshot ?? 0);
        return true;
      }
      return false;
    },
  },
  {
    id: 'roundabout', title: '3. Rotonda',
    text: `Entra a la rotonda cediendo el paso, da la vuelta en sentido antihorario y sal de frente (segunda salida), señalizando con ${kbd('signalRight')} antes de salir.`,
    hint: (ctx, s) => (s.exitArm && s.exitArm !== 'N' ? 'Saliste por el lado equivocado: da otra vuelta y sal de frente.' : ''),
    update(ctx, s) {
      const { r, theta } = ringInfo(ctx.x, ctx.z);
      if (r < RB.outerR - 1 && r > RB.innerR) s.inRing = true;
      if (s.inRing && r > RB.outerR + 1) {
        s.inRing = false;
        s.exitArm = ARMS.reduce((best, a) => (angleBetween(theta, a.angle) < angleBetween(theta, best.angle) ? a : best)).id;
        return s.exitArm === 'N';
      }
      return false;
    },
  },
  {
    id: 'speed', title: '4. Demuestra tu manejo',
    text: `Acelera en la recta hasta unos 30–35 km/h para mostrar control del vehículo, sin pasarte del límite del circuito.`,
    hint: (ctx) => `Velocidad: ${Math.round(ctx.kmh)} km/h`,
    update: (ctx) => ctx.z < COURSE.speedGateZ && ctx.kmh > 26,
  },
  {
    id: 'diagonal', title: '5. Estacionamiento diagonal',
    text: `Entra de frente a la plaza en 45°, guiándote por las líneas y el auto vecino.`,
    enter: (ctx, s) => { s.faultSnapshot = parkFaultTotal(); },
    update(ctx, s) {
      const { cz, angle, pitch } = COURSE.diagonal;
      const c = Math.cos(-angle), sn = Math.sin(-angle);
      const dx = ctx.x - (COURSE.kerbX - 1.0), dz = ctx.z - cz;
      const u = dx * c - dz * sn, v = dx * sn + dz * c;
      const inside = Math.abs(u) <= 1.6 && Math.abs(v) <= pitch / 2 - 0.3;
      const angleOk = angleBetween(ctx.yaw, -angle) < THREE.MathUtils.degToRad(10);
      const parked = inside && angleOk && ctx.kmh < 1.5;
      s.stillFor = parked ? (s.stillFor ?? 0) + 1 / 60 : 0;
      if ((s.stillFor ?? 0) > 1.2) {
        diagonalFaults = parkFaultTotal() - (s.faultSnapshot ?? 0);
        return true;
      }
      return false;
    },
  },
  {
    id: 'uturn1', title: '6. Retorno en U',
    text: `Sal de la plaza en reversa con las intermitentes activas, luego activa la direccional izquierda ${kbd('signalLeft')} y gira en U.`,
    update(ctx, s) {
      if (s.signaled === undefined && ctx.z < COURSE.uturnZ + 25) {
        s.signaled = controlState.signalLeft;
        if (!s.signaled) triggerInfraction('TURN_SIGNAL');
      }
      return Math.abs(ctx.z - COURSE.uturnZ) < 40 && angleBetween(ctx.yaw, Math.PI) < 0.3 && ctx.vz > 1.5;
    },
  },
  {
    id: 'uturn2', title: '7. Retorno en U: continúa hacia la meta',
    text: `Activa la direccional izquierda ${kbd('signalLeft')} y gira en U otra vez para retomar el circuito hacia la meta.`,
    update(ctx, s) {
      if (s.signaled === undefined && ctx.z > COURSE.uturnZ - 25) {
        s.signaled = controlState.signalLeft;
        if (!s.signaled) triggerInfraction('TURN_SIGNAL');
      }
      return Math.abs(ctx.z - COURSE.uturnZ) < 40 && angleBetween(ctx.yaw, 0) < 0.3 && ctx.vz < -1.5;
    },
  },
  {
    id: 'finish', title: '¡Circuito completado!',
    text: buildSummaryHtml,
    final: true,
    update: (ctx, s, dt) => { s.stillFor = (s.stillFor ?? 0) + dt; return ctx.z < COURSE.finishZ && (s.stillFor ?? 0) > 0.5; },
  },
];

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

function showStep(i: number): void {
  index = i;
  stepState = {};
  const step = STEPS[i];
  showTutorialStep({
    label: step.final ? '¡LISTO!' : `PASO ${i + 1} / ${STEPS.length - 1}`,
    title: step.title.replace(/^\d+\.\s*/, ''),
    html: typeof step.text === 'function' ? step.text() : step.text,
    progress: i / (STEPS.length - 1),
  });
  step.enter?.(ctxNow(), stepState);
}

export function initExamCourse({ onDone }: { onDone?: () => void } = {}): void {
  onComplete = onDone ?? null;
  finished = false;
  parallelFaults = 0; diagonalFaults = 0;
  showToast('Examen Oficial MTC', 'Sigue los pasos del panel — el circuito reproduce el examen práctico de manejo.');
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
