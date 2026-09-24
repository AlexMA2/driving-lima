import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { scene } from '../core/scene.js';
import { controlState } from './input.js';
import { triggerInfraction } from './rules.js';
import { chassisBody } from '../entities/player.js';
import { spawnStalledCar } from '../entities/breakdowns.js';
import { spawnPedestrian } from '../entities/pedestrians.js';
import { spawnScriptedCar } from '../entities/scriptedCars.js';
import { CROSSWALKS } from '../world/crosswalks.js';
import { RB, ARMS, ringInfo, wrapAngle } from '../world/roundabout.js';
import { COURSE, setTutorialLight } from '../world/tutorialCourse.js';
import { showToast } from '../ui/hud.js';

// The guided tutorial: a fixed list of steps, each with an instruction shown in the panel at the
// top of the screen and a completion test evaluated every frame. The course itself (world/
// tutorialCourse.js) and everything that moves in it (scripted cars, one pedestrian, the
// traffic light) are driven from here, at the moment a step needs them — nothing is random.

const LEFT = COURSE.lanes.left, RIGHT = COURSE.lanes.right;
const kbd = (k) => `<kbd>${k}</kbd>`;
const laneOf = (x) => (x > 0.3 && x < 3.5 ? 'left' : x >= 3.5 && x < 7 ? 'right' : null);
const wheelLock = () => THREE.MathUtils.degToRad(CONFIG.WHEEL_MAX_ANGLE_DEG);
const angleBetween = (a, b) => Math.min(wrapAngle(a - b), wrapAngle(b - a));

// ---- moving the player into a lane is taught twice, so it's built once
function laneChangeStep({ id, title, text, toLane, signalKey, signalName, enter, hint }) {
  return {
    id, title, text, hint, enter,
    update(ctx, s, dt) {
      const lane = laneOf(ctx.p.x);
      s.inLane = lane === toLane ? (s.inLane ?? 0) + dt : 0;
      // note the signal state the moment the car starts crossing the lane line
      const crossing = toLane === 'left' ? ctx.p.x < 3.4 : ctx.p.x > 3.6;
      if (crossing && s.signaled === undefined) s.signaled = controlState[signalKey];
      if (s.inLane > 0.8) {
        if (s.signaled === false) showToast('Faltó la direccional', `Activa ${signalName} antes de cambiar de carril.`);
        return true;
      }
      return false;
    },
  };
}

// ---- the steps
const STEPS = [
  {
    id: 'accelerate', title: 'Acelera',
    text: `Gira la <b>rueda del mouse hacia arriba</b> para acelerar. El acelerador se queda donde lo dejes, como un acelerador de mano.`,
    update: (ctx) => ctx.kmh > 12,
  },
  {
    id: 'steer', title: 'Gira el volante',
    text: `Arrastra el mouse alrededor del volante, o usa ${kbd('A')} / ${kbd('D')}, para girar un poco a la <b>izquierda</b> y luego a la <b>derecha</b>. Al soltarlo se centra solo.`,
    hint: (ctx, s) => `Izquierda ${s.left ? '✔' : '·'}   Derecha ${s.right ? '✔' : '·'}`,
    update(ctx, s) {
      if (controlState.wheelAngle < -wheelLock() * 0.3) s.left = true;
      if (controlState.wheelAngle > wheelLock() * 0.3) s.right = true;
      return s.left && s.right;
    },
  },
  {
    id: 'brake', title: 'Frena',
    text: `Mantén ${kbd('S')} para frenar hasta <b>detenerte por completo</b>. Baja también el acelerador con la rueda del mouse (hacia abajo).`,
    hint: (ctx) => `Velocidad: ${Math.round(ctx.kmh)} km/h`,
    update(ctx, s, dt) {
      s.still = ctx.kmh < 1.5 ? (s.still ?? 0) + dt : 0;
      return s.still > 0.6;
    },
  },
  {
    id: 'signals', title: 'Direccionales',
    text: `Activa la direccional izquierda con ${kbd('Q')} y la derecha con ${kbd('E')}. Cada tecla la enciende o la apaga. Aparecen como flechas junto al velocímetro.`,
    hint: (ctx, s) => `Izquierda ${s.left ? '✔' : '·'}   Derecha ${s.right ? '✔' : '·'}`,
    update(ctx, s) {
      if (controlState.signalLeft) s.left = true;
      if (controlState.signalRight) s.right = true;
      return s.left && s.right;
    },
  },
  {
    id: 'signalsOff', title: 'Apaga las direccionales',
    text: `Presiona ${kbd('L')} para apagarlas (o vuelve a pulsar la misma tecla). Las direccionales no se apagan solas.`,
    update: () => !controlState.signalLeft && !controlState.signalRight,
  },
  {
    id: 'horn', title: 'Bocina',
    text: `Toca la bocina con ${kbd('H')}. Úsala solo cuando de verdad haga falta.`,
    enter: (ctx, s) => { s.since = ctx.now; },
    update: (ctx, s) => controlState.lastHonkTime > s.since,
  },
  {
    id: 'drive', title: 'A rodar',
    text: `Acelera y avanza por el <b>carril derecho</b> hasta la columna verde. Mantente en <b>40 km/h o menos</b>: es el límite de este recorrido.`,
    waypoint: { x: RIGHT, z: COURSE.driveGateZ },
    update: (ctx) => ctx.p.z < COURSE.driveGateZ,
  },
  laneChangeStep({
    id: 'laneLeft', title: 'Cambio de carril: izquierda',
    text: `Antes de cambiar de carril: <b>1)</b> mira el espejo izquierdo, <b>2)</b> activa la direccional izquierda ${kbd('Q')}, <b>3)</b> pasa al carril izquierdo cuando esté libre.`,
    toLane: 'left', signalKey: 'signalLeft', signalName: 'la izquierda (Q)',
    enter(ctx, s) {
      // a car comes up the left lane from behind: the lesson is to see it in the mirror and wait
      s.car = spawnScriptedCar({ x: LEFT, z: ctx.p.z + 85, speed: Math.max(ctx.kmh / 3.6 + 9, 17) });
    },
    hint(ctx, s) {
      if (!s.car) return '';
      if (s.car.z > ctx.p.z - 6) return '⚠ Un auto viene por el carril izquierdo. Mira el espejo y espera a que pase.';
      return '✔ Vía libre. Activa Q y cambia de carril.';
    },
  }),
  laneChangeStep({
    id: 'laneRight', title: 'Regresa al carril derecho',
    text: `Ahora al revés: mira el espejo derecho, activa la direccional derecha ${kbd('E')} y vuelve al carril derecho.`,
    toLane: 'right', signalKey: 'signalRight', signalName: 'la derecha (E)',
  }),
  {
    id: 'bump', title: 'Rompemuelas',
    text: `Rompemuelas adelante: <b>reduce a menos de 20 km/h</b> antes de pasarlo. A más velocidad hay multa y el auto salta.`,
    waypoint: { x: RIGHT, z: COURSE.bumpZ },
    hint: (ctx) => `Velocidad: ${Math.round(ctx.kmh)} km/h`,
    update: (ctx) => ctx.p.z < COURSE.bumpZ - 3,
  },
  {
    id: 'zebra', title: 'Cruce peatonal',
    text: `Hay una <b>cebra</b> adelante. Si un peatón está cruzando, <b>detente y cédele el paso</b>. Avanza solo cuando la vía esté libre.`,
    waypoint: { x: RIGHT, z: COURSE.zebraZ },
    enter(ctx, s) { s.cw = CROSSWALKS.find(c => c.cz === COURSE.zebraZ); },
    hint: (ctx, s) => (s.cw && s.cw.pedsOnRoad > 0 && ctx.p.z > COURSE.zebraZ ? '🚶 Peatón cruzando: ¡detente!' : ''),
    update(ctx, s) {
      // the pedestrian sets off from the west kerb once the player is ~70 m away
      if (!s.spawned && ctx.p.z < COURSE.zebraZ + 70) { spawnPedestrian(s.cw, +1, 1.25); s.spawned = true; }
      return s.spawned && ctx.p.z < COURSE.zebraZ - 6 && s.cw.pedsOnRoad === 0;
    },
  },
  {
    id: 'hazard', title: 'Auto malogrado',
    text: `Un auto se malogró en tu carril. Mira el espejo izquierdo, señaliza con ${kbd('Q')} y <b>rodéalo por el carril izquierdo</b>. Cuidado: puede venir un auto por detrás.`,
    waypoint: { x: RIGHT, z: COURSE.stalledZ },
    enter() { spawnStalledCar(RIGHT, COURSE.stalledZ); },
    hint: (ctx, s) => (s.car && s.car.z > ctx.p.z - 6 ? '⚠ Auto por el carril izquierdo: espera a que pase.' : ''),
    update(ctx, s) {
      // an overtaker timed to reach the player's side while they approach the wreck
      if (!s.car && ctx.p.z < COURSE.hazardTriggerZ) {
        s.car = spawnScriptedCar({ x: LEFT, z: ctx.p.z + 75, speed: Math.max(ctx.kmh / 3.6 + 9, 18) });
      }
      return ctx.p.z < COURSE.stalledZ - 14;
    },
  },
  laneChangeStep({
    id: 'laneBack', title: 'Vuelve a tu carril',
    text: `Ya lo pasaste. Mira el espejo derecho, activa la direccional derecha ${kbd('E')} y regresa al carril derecho.`,
    toLane: 'right', signalKey: 'signalRight', signalName: 'la derecha (E)',
  }),
  {
    id: 'redLight', title: 'Semáforo',
    text: `Adelante hay un semáforo. Cuando se ponga en rojo, <b>detente antes de la línea blanca</b> y espera a que cambie.`,
    waypoint: { x: RIGHT, z: COURSE.light.stopZ },
    enter() { setTutorialLight('GREEN'); },
    hint(ctx, s) {
      if (s.phase === 'red') return '🔴 Rojo: espera detenido.';
      if (s.phase === 'yellow') return '🟡 Amarillo: prepárate para detenerte.';
      return '';
    },
    update(ctx, s, dt) {
      const stopZ = COURSE.light.stopZ;
      // lights change once the player is comfortably close, so there's room to stop
      if (!s.phase && ctx.p.z < stopZ + 95) { s.phase = 'yellow'; s.t = 0; setTutorialLight('YELLOW'); }
      if (s.phase === 'yellow') { s.t += dt; if (s.t > 2) { s.phase = 'red'; s.t = 0; s.still = 0; setTutorialLight('RED'); } }
      if (s.phase === 'red') {
        s.t += dt;
        const nearLine = ctx.p.z < stopZ + 32 && ctx.p.z > stopZ - 12;
        s.still = nearLine && ctx.kmh < 2 ? s.still + dt : 0;
        if (s.still >= 2.5) return true;                       // stopped correctly
        if (ctx.p.z < stopZ - 0.5 && ctx.kmh > 6) {            // ran the red
          triggerInfraction('G28');
          return true;
        }
        if (s.t > 40) return true;                             // safety net
      }
      return false;
    },
  },
  {
    id: 'greenLight', title: 'Luz verde',
    text: `¡Verde! Antes de avanzar, revisa que el cruce esté libre.`,
    waypoint: { x: RIGHT, z: COURSE.light.stopZ - 6 },
    enter() { setTutorialLight('GREEN'); },
    update: (ctx) => ctx.p.z < COURSE.light.stopZ - 3,
  },
  {
    id: 'turnRight', title: 'Gira a la derecha',
    text: `Activa la direccional derecha ${kbd('E')} <b>antes</b> de girar y toma la calle de la derecha. Gira sin invadir el otro carril.`,
    waypoint: { x: 20, z: COURSE.light.z + 1.75 },
    update(ctx, s) {
      // the turn starts as the car leaves the avenue's right edge
      if (s.signaled === undefined && ctx.p.x > 7) {
        s.signaled = controlState.signalRight;
        if (!s.signaled) triggerInfraction('TURN_SIGNAL');
      }
      return ctx.p.x > 16 && ctx.v.x > 2 && Math.abs(ctx.p.z - (COURSE.light.z + 1.75)) < 3.5;
    },
  },
  {
    id: 'stopSign', title: 'Señal de PARE',
    text: `Adelante hay una señal de <b>PARE</b>. Detente por completo antes de la línea blanca, cuenta hasta 2 y solo entonces continúa.`,
    waypoint: { x: COURSE.stop.lineX - 1, z: COURSE.stop.laneZ },
    hint: (ctx, s) => (s.stopped ? '✔ Detención completa. Ya puedes continuar.' : ''),
    update(ctx, s, dt) {
      const before = ctx.p.x < COURSE.stop.lineX && ctx.p.x > COURSE.stop.lineX - 16;
      // "stopped" tolerates the slow creep of holding the brake at a standstill (which selects reverse)
      if (before && ctx.kmh < 2) s.stillFor = (s.stillFor ?? 0) + dt; else if (before) s.stillFor = 0;
      if ((s.stillFor ?? 0) > 1.2) s.stopped = true;
      if (ctx.p.x > COURSE.stop.lineX + 1.5) {                 // crossed the line
        if (!s.stopped) triggerInfraction('STOP_SIGN');
        return true;
      }
      return false;
    },
  },
  {
    id: 'turnLeft', title: 'Gira a la izquierda',
    text: `Activa la direccional izquierda ${kbd('Q')} <b>antes</b> de girar y toma la calle hacia la rotonda. Cede el paso si viene alguien.`,
    waypoint: { x: COURSE.ring.cx + 1.75, z: COURSE.light.z - 22 },
    update(ctx, s) {
      // the left turn starts once the car reaches the middle of the crossing
      if (s.signaled === undefined && ctx.p.x > COURSE.ring.cx - 8) {
        s.signaled = controlState.signalLeft;
        if (!s.signaled) triggerInfraction('TURN_SIGNAL');
      }
      return Math.abs(ctx.p.x - (COURSE.ring.cx + 1.75)) < 4 && ctx.p.z < COURSE.light.z - 14 && ctx.v.z < -2;
    },
  },
  {
    id: 'roundabout', title: 'Rotonda',
    text: `Entra por la derecha (en la rotonda se gira en <b>sentido antihorario</b>), cede el paso, toma la <b>segunda salida</b> —siempre recto— y activa la derecha ${kbd('E')} antes de salir.`,
    waypoint: { x: COURSE.ring.cx, z: COURSE.ring.cz - 55 },
    hint: (ctx, s) => (s.exitArm === 'S' ? 'Saliste por donde entraste: da otra vuelta y toma la segunda salida.' : ''),
    update(ctx, s) {
      const { r, theta } = ringInfo(ctx.p.x, ctx.p.z);
      if (r < RB.outerR - 1 && r > RB.innerR) s.inRing = true;
      if (s.inRing && r > RB.outerR + 1) {
        s.inRing = false;
        s.exitArm = ARMS.reduce((best, a) => (angleBetween(theta, a.angle) < angleBetween(theta, best.angle) ? a : best)).id;
        return s.exitArm !== 'S';
      }
      return false;
    },
  },
  {
    id: 'finish', title: '¡Tutorial completado!',
    text: `¡Muy bien! Ya sabes cambiar de carril, girar, ceder el paso y manejar rotondas. Ahora prueba los otros escenarios.`,
    final: true,
    update: (ctx, s, dt) => { s.t = (s.t ?? 0) + dt; return s.t > 4.5; },
  },
];

// ---- state + UI
let index = -1;
let stepState = {};
let panel = null;
let onComplete = null;
let waypointMesh = null;
let finished = false;

function buildWaypoint() {
  waypointMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 9, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x4cff6b, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
  );
  waypointMesh.visible = false;
  waypointMesh.frustumCulled = false;
  scene.add(waypointMesh);
}

function currentContext() {
  const p = chassisBody.position, v = chassisBody.velocity;
  return { p, v, kmh: v.length() * 3.6, now: performance.now() / 1000 };
}

function showStep(i) {
  index = i;
  stepState = {};
  const step = STEPS[i];
  document.getElementById('tutStepNo').textContent = step.final ? '¡LISTO!' : `PASO ${i + 1} / ${STEPS.length - 1}`;
  document.getElementById('tutTitle').textContent = step.title;
  document.getElementById('tutText').innerHTML = step.text;
  document.getElementById('tutProgressFill').style.width = `${(i / (STEPS.length - 1)) * 100}%`;
  document.getElementById('tutHint').textContent = '';
  if (step.waypoint) {
    waypointMesh.position.set(step.waypoint.x, 4.5, step.waypoint.z);
    waypointMesh.visible = true;
  } else {
    waypointMesh.visible = false;
  }
  step.enter?.(currentContext(), stepState);
}

export function initTutorial({ onDone } = {}) {
  onComplete = onDone;
  finished = false;
  panel = document.getElementById('tutorialPanel');
  document.body.classList.add('tutorial');
  buildWaypoint();
  showStep(0);
}

export function updateTutorial(dt) {
  if (finished || index < 0) return;
  const ctx = currentContext();
  const step = STEPS[index];

  const done = step.update(ctx, stepState, dt);
  const hint = step.hint?.(ctx, stepState);
  const hintEl = document.getElementById('tutHint');
  if (hintEl && hint !== undefined && hintEl.textContent !== hint) hintEl.textContent = hint;

  // pulse the objective marker so it reads as "go here"
  if (waypointMesh.visible) {
    const t = performance.now() / 1000;
    waypointMesh.material.opacity = 0.28 + 0.12 * Math.sin(t * 4);
    waypointMesh.scale.set(1 + 0.06 * Math.sin(t * 3), 1, 1 + 0.06 * Math.sin(t * 3));
  }

  if (!done) return;
  if (step.final) {
    finished = true;
    waypointMesh.visible = false;
    onComplete?.();
    return;
  }
  showToast('✓ Bien hecho', step.title, 'good');
  showStep(index + 1);
}

// The avenue's lane-change rule (G10) only applies once the lane-change lessons begin and until
// the car has left the avenue: earlier steps (like the steering exercise) legitimately drift
// across the lane lines.
const LANE_RULE_FROM = STEPS.findIndex(s => s.id === 'laneLeft');
const LANE_RULE_UNTIL = STEPS.findIndex(s => s.id === 'laneBack');
export function laneRuleActive() { return index >= LANE_RULE_FROM && index <= LANE_RULE_UNTIL; }

// Number of steps, for the progress readout in tests and the panel.
export const TUTORIAL_STEP_COUNT = STEPS.length;
export function currentTutorialStep() { return index; }
export function skipTutorialStep() { showStep(Math.min(index + 1, STEPS.length - 1)); } // debugging aid
