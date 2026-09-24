import * as THREE from 'three';
import { chassisBody, carYaw, forwardSpeed, CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../entities/player.js';
import { PARKING } from '../world/parkingLot.js';
import { controlState } from './input.js';
import { triggerInfraction } from './rules.js';
import { showToast } from '../ui/hud.js';

// The parking exercises (world/parkingLot.js builds the ground). Each run is a short list of
// steps shown in the guide panel — the classic reference-point method for that manoeuvre — while
// every frame the car's pose is measured against the target to decide when it is parked.
//
// Conventions: north is -Z, the player starts heading north, the kerb / bays are on the right (+X).
// `yaw` is the nose's heading: 0 = north, positive = turned toward the west (three.js rotation.y).

const kbd = (k) => `<kbd>${k}</kbd>`;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (rad) => Math.round(THREE.MathUtils.radToDeg(rad));
const cm = (m) => `${Math.round(m * 100)} cm`;

// Smallest turning circle of the rear axle at full lock: wheelbase / tan(max steer).
const WHEELBASE = 2.9;
const REAR_OVERHANG = CAR_HALF_LENGTH - 1.35;
const TURN_RADIUS = () => WHEELBASE / Math.tan(0.55);

// The pose every check works from, refreshed once per frame.
const pose = { x: 0, z: 0, yaw: 0, kmh: 0, corners: [], fr: null, rear: null };

function readPose() {
  const p = chassisBody.position;
  pose.x = p.x; pose.z = p.z;
  pose.yaw = carYaw();
  pose.kmh = chassisBody.velocity.length() * 3.6;
  const s = Math.sin(pose.yaw), c = Math.cos(pose.yaw);
  const fwd = { x: -s, z: -c }, right = { x: c, z: -s };
  const corner = (f, r) => ({ x: p.x + fwd.x * f + right.x * r, z: p.z + fwd.z * f + right.z * r });
  const L = CAR_HALF_LENGTH, W = CAR_HALF_WIDTH;
  pose.fr = corner(L, W); pose.fl = corner(L, -W);
  pose.rr = corner(-L, W); pose.rl = corner(-L, -W);
  pose.corners = [pose.fr, pose.fl, pose.rr, pose.rl];
  pose.rear = corner(-L, 0);
}

const minOf = (pts, k) => Math.min(...pts.map(q => q[k]));
const maxOf = (pts, k) => Math.max(...pts.map(q => q[k]));

// ---- parallel -------------------------------------------------------------------------------
// gap to the kerb, angle to it, and whether the car is inside the painted slot
function parallelMetrics() {
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

const PARALLEL_STEPS = () => {
  const P = PARKING;
  const frontCarSideX = P.kerbX - 0.3 - 2 * CAR_HALF_WIDTH; // the parked car's side facing the road
  return [
    {
      id: 'align', title: '1. Ponte a la par del auto de adelante',
      text: `Activa la direccional derecha ${kbd('E')} y avanza despacio por el carril derecho, pasando el espacio libre. Detente <b>al lado del auto de adelante</b>, a <b>50–100 cm</b> de él y con <b>tu parachoques trasero a la altura del suyo</b>. Baja el acelerador con la rueda del mouse (↓) para ir lento.`,
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
      text: `Mantén ${kbd('S')} hasta que el auto se detenga y siga presionado: entra la reversa. Gira el volante <b>todo a la derecha</b> (mantén ${kbd('D')}) y retrocede despacio hasta formar unos <b>45°</b> con la vereda. En el <b>espejo derecho</b> verás cómo la esquina trasera de tu auto se acerca a la vereda.`,
      hint: () => `Ángulo con la vereda: ${deg(Math.abs(pose.yaw))}° (objetivo ~45°)`,
      done: () => pose.yaw > 0.7,
    },
    {
      id: 'straight', title: '3. Endereza y sigue retrocediendo',
      text: `Suelta ${kbd('D')} para <b>enderezar el volante</b> y retrocede en línea recta hasta que <b>el frente de tu auto haya pasado el parachoques trasero</b> del auto de adelante (míralo en el espejo izquierdo: ya no tapa tu camino).`,
      hint: () => (pose.fr.z > P.zF + 0.4 ? '✔ Tu frente ya libró al auto de adelante' : 'Sigue retrocediendo en línea recta…'),
      done: () => pose.fr.z > P.zF + 0.4,
    },
    {
      id: 'left', title: '4. Volante a la izquierda para acomodarte',
      text: `Gira el volante <b>todo a la izquierda</b> (mantén ${kbd('A')}) mientras sigues retrocediendo despacio: el auto se acomoda paralelo a la vereda. Suelta ${kbd('A')} cuando quede recto.`,
      hint: () => `Ángulo con la vereda: ${deg(Math.abs(pose.yaw))}°`,
      done: () => Math.abs(pose.yaw) < 0.14,
    },
    {
      id: 'finish', title: '5. Ajusta y detente',
      text: `Termina dentro de las líneas, <b>paralelo</b> y a <b>menos de 60 cm de la vereda</b>. Si hace falta, avanza y retrocede en trechos cortos. Cuando estés bien, quédate detenido unos 2 segundos (puedes usar ${kbd('Espacio')}).`,
      hint: () => parallelMetrics().hint,
      done: () => false,
    },
  ];
};

// ---- perpendicular ----------------------------------------------------------------------------
function perpendicularMetrics() {
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

const PERPENDICULAR_STEPS = () => {
  const P = PARKING;
  // rear axle must be one turning radius north of the bay's centre line to swing in with full lock
  const idealRearBumperZ = P.zBay - TURN_RADIUS() + REAR_OVERHANG;
  return [
    {
      id: 'pass', title: '1. Pasa la plaza y detente',
      text: `Activa la direccional derecha ${kbd('E')} y avanza despacio, <b>pegado a la fila de autos</b> (a menos de 1 m de las líneas). Pasa la plaza libre y detente cuando <b>tu parachoques trasero quede a la altura de la 2.ª línea</b> contando desde la plaza libre: en el <b>espejo derecho</b> verás esa línea justo en la esquina trasera de tu auto.`,
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
      text: `Mantén ${kbd('S')} para meter la reversa y gira el volante <b>todo a la derecha</b> (mantén ${kbd('D')}). Retrocede despacio: el frente de tu auto barre el pasillo mientras la cola entra a la plaza. Mira <b>ambos espejos</b>: las líneas de la plaza deben quedar a los costados de tu auto.`,
      hint: () => `Ángulo con el pasillo: ${deg(pose.yaw)}° (objetivo ~80°)`,
      done: () => pose.yaw > Math.PI / 2 - 0.3,
    },
    {
      id: 'straight', title: '3. Endereza y retrocede hasta el tope',
      text: `Cuando el auto esté casi recto en la plaza, <b>endereza el volante</b> (suelta ${kbd('D')}) y retrocede despacio hasta acercarte al tope. Comprueba que hay el mismo espacio a cada lado en los espejos y <b>detente ~2 s</b> dentro de las líneas.`,
      hint: () => perpendicularMetrics().hint,
      done: () => false,
    },
  ];
};

// ---- state + UI -----------------------------------------------------------------------------------
let steps = [];
let stepIndex = 0;
let metricsOf = null;
let guide = true;
let onComplete = null;
let stillFor = 0;
let signalChecked = false;
let finished = false;

function showStep(i) {
  stepIndex = i;
  if (!guide) return;
  const step = steps[i];
  document.getElementById('tutStepNo').textContent = `PASO ${i + 1} / ${steps.length}`;
  document.getElementById('tutTitle').textContent = step.title.replace(/^\d+\.\s*/, '');
  document.getElementById('tutText').innerHTML = step.text;
  document.getElementById('tutProgressFill').style.width = `${(i / steps.length) * 100}%`;
  document.getElementById('tutHint').textContent = '';
}

export function initParking(scenario, { onDone } = {}) {
  onComplete = onDone;
  finished = false; stillFor = 0; signalChecked = false;
  guide = scenario.guide !== false;
  const perpendicular = PARKING.mode === 'perpendicular';
  steps = perpendicular ? PERPENDICULAR_STEPS() : PARALLEL_STEPS();
  metricsOf = perpendicular ? perpendicularMetrics : parallelMetrics;

  PARKING.zone.visible = guide;
  document.getElementById('tutKind').textContent = perpendicular ? 'ESTACIONAMIENTO EN BATERÍA' : 'ESTACIONAMIENTO EN PARALELO';
  document.body.classList.toggle('guided', guide);
  readPose();
  showStep(0);
  showToast(
    perpendicular ? 'Estacionamiento en batería' : 'Estacionamiento en paralelo',
    guide ? 'Sigue los pasos del panel y usa los espejos como referencia.' : 'Estaciona en el espacio libre.'
  );
}

export function updateParking(dt) {
  if (finished) return;
  readPose();
  const m = metricsOf();

  // the manoeuvre should be signalled: check once, when the car first starts to reverse
  if (!signalChecked && forwardSpeed() < -0.4) {
    signalChecked = true;
    if (!controlState.signalLeft && !controlState.signalRight) triggerInfraction('PARK_SIGNAL');
  }

  const step = steps[stepIndex];
  if (guide) {
    const hint = step.hint();
    const hintEl = document.getElementById('tutHint');
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
  }
  if (step.done() && stepIndex < steps.length - 1) {
    if (guide) showToast('✓ Bien hecho', step.title.replace(/^\d+\.\s*/, ''), 'good');
    showStep(stepIndex + 1);
  }

  // parked: inside the target, aligned, and standing still for a moment
  stillFor = m.parked && pose.kmh < 1.5 ? stillFor + dt : 0;
  if (stillFor > 1.5) {
    finished = true;
    onComplete?.();
  }
}
