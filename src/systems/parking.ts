import * as THREE from 'three';
import { chassisBody, carYaw, forwardSpeed, CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../entities/player';
import { PARKING } from '../world/parkingLot';
import { controlState } from './input';
import { triggerInfraction } from './rules';
import { showToast } from '../game/hud';
import { showTutorialStep, setTutorialHint } from '../ui/tutorialPanel';
import type { ResolvedScenario } from '../state/settings';
import { kbdHtml } from '../state/keybindings';

// The parking exercises (world/parkingLot.ts builds the ground). Each run is a short list of
// steps shown in the guide panel — the classic reference-point method for that manoeuvre — while
// every frame the car's pose is measured against the target to decide when it is parked.
//
// Conventions: north is -Z, the player starts heading north, the kerb / bays are on the right (+X).
// `yaw` is the nose's heading: 0 = north, positive = turned toward the west (three.js rotation.y).

const kbd = kbdHtml; // takes an action id, e.g. kbd('signalRight')
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (rad: number): number => Math.round(THREE.MathUtils.radToDeg(rad));
const cm = (m: number): string => `${Math.round(m * 100)} cm`;

// Smallest turning circle of the rear axle at full lock: wheelbase / tan(max steer). Exported for
// systems/parkingAutopilot.ts, which needs the same "how far past the bay to stop before swinging
// in" geometry the perpendicular step's own hint uses.
const WHEELBASE = 2.9;
export const REAR_OVERHANG = CAR_HALF_LENGTH - 1.35;
export const TURN_RADIUS = () => WHEELBASE / Math.tan(0.55);

// The pose every check works from, refreshed once per frame.
interface Pt { x: number; z: number }

const origin = (): Pt => ({ x: 0, z: 0 });
const pose = {
  x: 0, z: 0, yaw: 0, kmh: 0,
  fr: origin(), fl: origin(), rr: origin(), rl: origin(), rear: origin(),
  corners: [] as Pt[],
};

// Read-only view of the same pose the checks above work from — updateParking() refreshes it every
// frame before systems/parkingAutopilot.ts's own update runs, so this is always this frame's pose.
export function getParkingPose(): Readonly<typeof pose> { return pose; }

function readPose(): void {
  const p = chassisBody.position;
  pose.x = p.x; pose.z = p.z;
  pose.yaw = carYaw();
  pose.kmh = chassisBody.velocity.length() * 3.6;
  const s = Math.sin(pose.yaw), c = Math.cos(pose.yaw);
  const fwd = { x: -s, z: -c }, right = { x: c, z: -s };
  const corner = (f: number, r: number): Pt => ({ x: p.x + fwd.x * f + right.x * r, z: p.z + fwd.z * f + right.z * r });
  const L = CAR_HALF_LENGTH, W = CAR_HALF_WIDTH;
  pose.fr = corner(L, W); pose.fl = corner(L, -W);
  pose.rr = corner(-L, W); pose.rl = corner(-L, -W);
  pose.corners = [pose.fr, pose.fl, pose.rr, pose.rl];
  pose.rear = corner(-L, 0);
}

const minOf = (pts: Pt[], k: 'x' | 'z'): number => Math.min(...pts.map(q => q[k]));
const maxOf = (pts: Pt[], k: 'x' | 'z'): number => Math.max(...pts.map(q => q[k]));

// ---- parallel -------------------------------------------------------------------------------
// gap to the kerb, angle to it, and whether the car is inside the painted slot
interface Metrics { inside: boolean; parked: boolean; hint: string }

interface Step {
  id: string;
  title: string;
  text: string;
  hint: () => string;
  done: () => boolean;
  enter?: () => void;
}

// The sign shown the moment the car is judged correctly parked (a lenient threshold — see each
// mode's `parked` check above — not a pixel-perfect fit), right before the guide moves on to the
// last step: pulling back out. Also resets the exit dwell timer, so leaving has to happen after
// this point rather than before the player ever parked.
function confirmParked(): void {
  showToast('✔ Correctamente estacionado', 'Ahora sal del espacio con cuidado.', 'good');
  exitFor = 0;
  if (PARKING.zone) (PARKING.zone.material as THREE.MeshBasicMaterial).opacity = 0.45;
}

// Whether the car has pulled fully back out of the slot/bay into the lane or aisle — the last
// step of every mode, so leaving is part of the exercise and not just parking.
export function exitMetrics(): boolean {
  const P = PARKING;
  return P.mode === 'parallel'
    ? maxOf(pose.corners, 'x') < P.laneEdgeX + 0.1
    : maxOf(pose.corners, 'x') < P.aisleX + 0.15;
}

export function parallelMetrics(): Metrics & { gap: number; angle: number } {
  const P = PARKING;
  const gap = P.kerbX - maxOf(pose.corners, 'x');
  const angle = Math.abs(pose.yaw);
  const inSlot = pose.z < P.zR && pose.z > P.zF
    && minOf(pose.corners, 'x') >= P.laneEdgeX - 0.15 && maxOf(pose.corners, 'x') <= P.kerbX + 0.03;
  return {
    inside: inSlot, gap, angle,
    parked: inSlot && gap <= 0.6 && angle <= THREE.MathUtils.degToRad(8),
    hint: `Vereda: ${cm(Math.max(gap, 0))} ${gap <= 0.6 ? '✔' : '(máx. 60 cm)'}   ·   Ángulo: ${deg(angle)}° ${angle <= 0.14 ? '✔' : '(máx. 8°)'}   ·   ${inSlot ? 'Dentro del espacio ✔' : 'Aún no estás dentro del espacio'}`,
  };
}

const PARALLEL_STEPS = (): Step[] => {
  const P = PARKING;
  const frontCarSideX = P.kerbX - 0.3 - 2 * CAR_HALF_WIDTH; // the parked car's side facing the road
  return [
    {
      id: 'align', title: '1. Ponte a la par del auto de adelante',
      text: `Activa la direccional derecha ${kbd('signalRight')} y avanza despacio por el carril derecho, pasando el espacio libre. Detente <b>al lado del auto de adelante</b>, a <b>50–100 cm</b> de él y con <b>tu parachoques trasero a la altura del suyo</b>. Baja el acelerador con la rueda del mouse (↓) para ir lento.`,
      hint: () => {
        const gap = frontCarSideX - maxOf(pose.corners, 'x');
        const dz = pose.rear.z - P.zF;
        return `Separación: ${cm(gap)} (ideal 50–100 cm) · Parachoques: ${Math.abs(dz) < 0.9 ? 'alineados ✔' : dz > 0 ? 'te falta avanzar' : 'te pasaste un poco'}`;
      },
      done: () => {
        const gap = frontCarSideX - maxOf(pose.corners, 'x');
        return Math.abs(pose.rear.z - P.zF) < 0.9 && gap > 0.3 && gap < 1.4 && pose.kmh < 2 && Math.abs(pose.yaw) < 0.14;
      },
    },
    {
      id: 'reverse', title: '2. Retrocede con el volante a la derecha',
      text: `Con el auto detenido presiona ${kbd('brake')}: entra la reversa <b>R</b>, y la rueda del mouse (↑) acelera hacia atrás. Gira el volante <b>todo a la derecha</b> (mantén ${kbd('steerRight')}) y retrocede despacio hasta formar unos <b>45°</b> con la vereda. En el <b>espejo derecho</b> verás cómo la esquina trasera de tu auto se acerca a la vereda.`,
      hint: () => `Ángulo con la vereda: ${deg(Math.abs(pose.yaw))}° (objetivo ~45°)`,
      done: () => pose.yaw > 0.7,
    },
    {
      id: 'straight', title: '3. Endereza y sigue retrocediendo',
      text: `Suelta ${kbd('steerRight')} para <b>enderezar el volante</b> y retrocede en línea recta hasta que <b>el frente de tu auto haya pasado el parachoques trasero</b> del auto de adelante (míralo en el espejo izquierdo: ya no tapa tu camino).`,
      hint: () => (pose.fr.z > P.zF + 0.4 ? '✔ Tu frente ya libró al auto de adelante' : 'Sigue retrocediendo en línea recta…'),
      done: () => pose.fr.z > P.zF + 0.4,
    },
    {
      id: 'left', title: '4. Volante a la izquierda para acomodarte',
      text: `Gira el volante <b>todo a la izquierda</b> (mantén ${kbd('steerLeft')}) mientras sigues retrocediendo despacio: el auto se acomoda paralelo a la vereda. Suelta ${kbd('steerLeft')} cuando quede recto.`,
      hint: () => `Ángulo con la vereda: ${deg(Math.abs(pose.yaw))}°`,
      done: () => Math.abs(pose.yaw) < 0.14,
    },
    {
      id: 'finish', title: '5. Ajusta y detente',
      text: `Termina dentro de las líneas, <b>paralelo</b> y a <b>menos de 60 cm de la vereda</b>. Si hace falta, avanza (${kbd('drive')}) y retrocede (${kbd('brake')}) en trechos cortos. Cuando estés bien, quédate detenido unos 2 segundos (puedes usar ${kbd('handbrake')}).`,
      hint: () => parallelMetrics().hint,
      done: () => parkedFor > 1.5,
    },
    {
      id: 'exit', title: '6. Sal del espacio',
      text: `Activa la direccional izquierda ${kbd('signalLeft')}, revisa el espejo y avanza (${kbd('drive')}) despacio hasta volver por completo al carril.`,
      hint: () => (exitMetrics() ? '✔ Ya estás en el carril.' : `Falta salir: ${cm(Math.max(maxOf(pose.corners, 'x') - P.laneEdgeX, 0))}`),
      enter: confirmParked,
      done: () => exitFor > 0.5,
    },
  ];
};

// ---- perpendicular ----------------------------------------------------------------------------
export function perpendicularMetrics(): Metrics & { angle: number; off: number } {
  const P = PARKING;
  const half = P.bayW / 2;
  const noseOut = Math.abs(wrap(pose.yaw - Math.PI / 2));   // nose toward the aisle (reversed in)
  const noseIn = Math.abs(wrap(pose.yaw + Math.PI / 2));
  const angle = Math.min(noseOut, noseIn);
  const inside = pose.corners.every(q => q.x >= P.aisleX - 0.15 && q.x <= P.wallX + 0.05 && Math.abs(q.z - P.zBay) <= half + 0.05);
  const off = pose.z - P.zBay;
  return {
    inside, angle, off,
    parked: inside && angle <= THREE.MathUtils.degToRad(8) && pose.x >= P.aisleX + CAR_HALF_LENGTH + 0.05,
    hint: `Dentro de las líneas: ${inside ? '✔' : 'no'}   ·   Ángulo: ${deg(angle)}° ${angle <= 0.14 ? '✔' : '(máx. 8°)'}   ·   Descentrado: ${cm(Math.abs(off))}`,
  };
}

const PERPENDICULAR_STEPS = (): Step[] => {
  const P = PARKING;
  // rear axle must be one turning radius north of the bay's centre line to swing in with full lock
  const idealRearBumperZ = P.zBay - TURN_RADIUS() + REAR_OVERHANG;
  return [
    {
      id: 'pass', title: '1. Pasa la plaza y detente',
      text: `Activa la direccional derecha ${kbd('signalRight')} y avanza despacio, <b>pegado a la fila de autos</b> (a menos de 1 m de las líneas). Pasa la plaza libre y detente cuando <b>tu parachoques trasero quede a la altura de la 2.ª línea</b> contando desde la plaza libre: en el <b>espejo derecho</b> verás esa línea justo en la esquina trasera de tu auto.`,
      hint: () => {
        const dz = pose.rear.z - idealRearBumperZ;
        const gap = P.aisleX - maxOf(pose.corners, 'x');
        return `Parachoques trasero: ${Math.abs(dz) < 0.9 ? 'en posición ✔' : dz > 0 ? 'avanza un poco más' : 'te pasaste, retrocede un poco'} · Separación de las líneas: ${cm(Math.abs(gap))}`;
      },
      done: () => Math.abs(pose.rear.z - idealRearBumperZ) < 0.9 && pose.kmh < 2 && Math.abs(pose.yaw) < 0.14
        && maxOf(pose.corners, 'x') < P.aisleX + 1.4,
    },
    {
      id: 'swing', title: '2. Retrocede con el volante a tope a la derecha',
      text: `Con el auto detenido presiona ${kbd('brake')} para meter la reversa <b>R</b> (la rueda del mouse ↑ acelera hacia atrás) y gira el volante <b>todo a la derecha</b> (mantén ${kbd('steerRight')}). Retrocede despacio: el frente de tu auto barre el pasillo mientras la cola entra a la plaza. Mira <b>ambos espejos</b>: las líneas de la plaza deben quedar a los costados de tu auto.`,
      hint: () => `Ángulo con el pasillo: ${deg(pose.yaw)}° (objetivo ~80°)`,
      done: () => pose.yaw > Math.PI / 2 - 0.3,
    },
    {
      id: 'straight', title: '3. Endereza y retrocede hasta el tope',
      text: `Cuando el auto esté casi recto en la plaza, <b>endereza el volante</b> (suelta ${kbd('steerRight')}) y retrocede despacio hasta acercarte al tope. Comprueba que hay el mismo espacio a cada lado en los espejos y <b>detente ~2 s</b> dentro de las líneas.`,
      hint: () => perpendicularMetrics().hint,
      done: () => parkedFor > 1.5,
    },
    {
      id: 'exit', title: '4. Sal del estacionamiento',
      text: `Con el auto detenido, activa la direccional y avanza (${kbd('drive')}) despacio hasta salir por completo de la plaza hacia el pasillo.`,
      hint: () => (exitMetrics() ? '✔ Ya estás en el pasillo.' : `Falta salir: ${cm(Math.max(maxOf(pose.corners, 'x') - P.aisleX, 0))}`),
      enter: confirmParked,
      done: () => exitFor > 0.5,
    },
  ];
};

// ---- diagonal ---------------------------------------------------------------------------------
// angle to the bay's own centreline, and whether the car sits inside the bay's raked rectangle
// (checked in the bay's own rotated frame, since it isn't axis-aligned like the other two modes)
export function diagonalMetrics(): Metrics & { angle: number } {
  const P = PARKING;
  const angle = Math.abs(wrap(pose.yaw - P.bayAngle));
  const c = Math.cos(P.bayAngle), s = Math.sin(P.bayAngle);
  const inside = pose.corners.every(q => {
    const dx = q.x - P.bayCx, dz = q.z - P.zBay;
    const u = dx * c - dz * s, v = dx * s + dz * c; // world offset expressed in the bay's own (width, depth) axes
    return Math.abs(u) <= P.bayW / 2 + 0.1 && Math.abs(v) <= P.bayDepth / 2 + 0.1;
  });
  return {
    inside, angle,
    parked: inside && angle <= THREE.MathUtils.degToRad(8),
    hint: `Dentro de las líneas: ${inside ? '✔' : 'no'}   ·   Ángulo: ${deg(angle)}° ${angle <= 0.14 ? '✔' : '(objetivo 45°)'}`,
  };
}

const DIAGONAL_STEPS = (): Step[] => {
  const P = PARKING;
  return [
    {
      id: 'enter', title: '1. Entra de frente a la plaza',
      text: `Activa la direccional derecha ${kbd('signalRight')} y, sin detenerte del todo, gira hacia la plaza libre siguiendo el ángulo de las líneas. Guíate por la línea derecha en tu espejo.`,
      hint: () => `Ángulo con la plaza: ${deg(Math.abs(wrap(pose.yaw - P.bayAngle)))}° (objetivo 45°)`,
      done: () => diagonalMetrics().inside,
    },
    {
      id: 'straight', title: '2. Endereza y avanza hasta el tope',
      text: `Endereza el volante para quedar paralelo a las líneas de la plaza y avanza despacio hasta el tope, sin tocarlo.`,
      hint: () => diagonalMetrics().hint,
      done: () => parkedFor > 1.5,
    },
    {
      id: 'exit', title: '3. Sal en reversa',
      text: `Activa la direccional izquierda ${kbd('signalLeft')}, mira los espejos y retrocede (${kbd('brake')}) en línea recta hasta quedar completamente en el pasillo.`,
      hint: () => (exitMetrics() ? '✔ Ya estás en el pasillo.' : `Falta salir: ${cm(Math.max(maxOf(pose.corners, 'x') - P.aisleX, 0))}`),
      enter: confirmParked,
      done: () => exitFor > 0.5,
    },
  ];
};

// ---- state + UI -----------------------------------------------------------------------------------
let steps: Step[] = [];
let stepIndex = 0;
let metricsOf: () => Metrics = parallelMetrics;
let guide = true;
let onComplete: (() => void) | null = null;
let parkedFor = 0; // dwell inside the slot/bay, aligned and still — gates the move to the exit step
let exitFor = 0;   // dwell back in the lane/aisle after parking — gates finishing the exercise
let signalChecked = false;
let finished = false;

// For systems/parkingAutopilot.ts: which step it should be driving right now (or null before
// initParking/after the exercise is done).
export function currentParkingStepId(): string | null { return steps[stepIndex]?.id ?? null; }

function showStep(i: number): void {
  stepIndex = i;
  const step = steps[i];
  step.enter?.();
  if (!guide) return;
  showTutorialStep({
    label: `PASO ${i + 1} / ${steps.length}`,
    title: step.title.replace(/^\d+\.\s*/, ''),
    html: step.text,
    progress: i / steps.length,
  });
}

export function initParking(scenario: ResolvedScenario, { onDone }: { onDone?: () => void } = {}): void {
  onComplete = onDone ?? null;
  finished = false; parkedFor = 0; exitFor = 0; signalChecked = false;
  guide = scenario.guide !== false;
  steps = PARKING.mode === 'perpendicular' ? PERPENDICULAR_STEPS()
    : PARKING.mode === 'diagonal' ? DIAGONAL_STEPS()
    : PARALLEL_STEPS();
  metricsOf = PARKING.mode === 'perpendicular' ? perpendicularMetrics
    : PARKING.mode === 'diagonal' ? diagonalMetrics
    : parallelMetrics;

  if (PARKING.zone) PARKING.zone.visible = guide;
  readPose();
  showStep(0);
  const label = PARKING.mode === 'perpendicular' ? 'Estacionamiento en batería'
    : PARKING.mode === 'diagonal' ? 'Estacionamiento diagonal'
    : 'Estacionamiento en paralelo';
  showToast(label, guide ? 'Sigue los pasos del panel y usa los espejos como referencia.' : 'Estaciona en el espacio libre.');
}

export function updateParking(dt: number): void {
  if (finished) return;
  readPose();

  // the manoeuvre should be signalled: check once, when the car first starts to reverse
  if (!signalChecked && forwardSpeed() < -0.4) {
    signalChecked = true;
    if (!controlState.signalLeft && !controlState.signalRight) triggerInfraction('PARK_SIGNAL');
  }

  // parked: inside the target, aligned, and standing still for a moment (a lenient threshold —
  // see each mode's `parked` check — not a pixel-perfect fit)
  const m = metricsOf();
  parkedFor = m.parked && pose.kmh < 1.5 ? parkedFor + dt : 0;
  // back in the lane/aisle after parking — only counted once the exit step is actually reached,
  // otherwise the dwell would already be satisfied from the moment the exercise starts there
  if (stepIndex === steps.length - 1) exitFor = exitMetrics() ? exitFor + dt : 0;

  const step = steps[stepIndex];
  if (guide) setTutorialHint(step.hint());

  if (step.done()) {
    if (stepIndex < steps.length - 1) {
      if (guide) showToast('✓ Bien hecho', step.title.replace(/^\d+\.\s*/, ''), 'good');
      showStep(stepIndex + 1);
    } else {
      finished = true;
      onComplete?.();
    }
  }
}
