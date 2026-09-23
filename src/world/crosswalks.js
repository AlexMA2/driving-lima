import * as THREE from 'three';
import { scene } from '../core/scene.js';
import { buildSign } from '../assets/props.js';

// Registry of marked pedestrian crossings ("cebras"). A crosswalk is described by its centre,
// the axis pedestrians walk along, and the width of the roadway they cross:
//   axis 'x': pedestrians walk along X, across a road that runs along Z (centre at cx, cz)
//   axis 'z': pedestrians walk along Z, across a road that runs along X
// `pedsOnRoad` is kept up to date by entities/pedestrians.js; drivers use it to know when to stop.

export const CROSSWALKS = [];

const STRIPE_W = 0.5, STRIPE_L = 1.6, STRIPE_STEP = 0.9;
const stripeMatrices = [];

// Density presets for the "zebras" setting: the share of candidate spots that get a crossing.
export const ZEBRA_LEVELS = { off: 0, low: 0.25, medium: 0.5, high: 1 };

export function resetCrosswalks() {
  CROSSWALKS.length = 0;
  stripeMatrices.length = 0;
}

// Deterministic pseudo-random in [0,1) from an index, so choosing which candidate spots get a
// zebra never consumes the world's seeded RNG (and stays stable between runs).
export function hash01(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function includeCandidate(index, level) {
  return hash01(index) < (ZEBRA_LEVELS[level] ?? ZEBRA_LEVELS.medium);
}

// `build: false` registers a crossing whose stripes already exist (the avenue's intersections).
// `sign` adds "PASO PEATONAL" signs on both approaches.
export function addCrosswalk({ cx, cz, axis, roadHalf, walkHalf, build = true, sign = false }) {
  const cw = { cx, cz, axis, roadHalf, walkHalf, pedsOnRoad: 0 };
  CROSSWALKS.push(cw);
  if (build) queueStripes(cw);
  if (sign) placeSigns(cw);
  return cw;
}

function queueStripes(cw) {
  const m = new THREE.Matrix4();
  for (let i = -cw.roadHalf; i < cw.roadHalf - 0.05; i += STRIPE_STEP) {
    const off = i + STRIPE_W / 2;
    if (cw.axis === 'x') m.makeTranslation(cw.cx + off, 0.12, cw.cz);
    else m.makeTranslation(cw.cx, 0.12, cw.cz + off);
    stripeMatrices.push({ m: m.clone(), rotated: cw.axis === 'z' });
  }
}

// One InstancedMesh for every stripe of every crossing built so far.
export function flushZebras() {
  if (!stripeMatrices.length) return;
  const geo = new THREE.BoxGeometry(STRIPE_W, 0.015, STRIPE_L);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  const inst = new THREE.InstancedMesh(geo, mat, stripeMatrices.length);
  const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  stripeMatrices.forEach(({ m, rotated }, i) => inst.setMatrixAt(i, rotated ? m.clone().multiply(rot) : m));
  inst.instanceMatrix.needsUpdate = true;
  inst.receiveShadow = true;
  scene.add(inst);
  stripeMatrices.length = 0;
}

function placeSigns(cw) {
  // one sign per direction of travel, on the kerb before the crossing, facing oncoming drivers
  const offset = cw.roadHalf + 0.9, back = 9;
  const make = (x, z, rotY) => {
    const s = buildSign('PASO\nPEATONAL', 0xffd54a, 'rect');
    s.position.set(x, 0, z);
    s.rotation.y = rotY;
    scene.add(s);
  };
  if (cw.axis === 'x') {
    make(cw.cx + offset, cw.cz + back, 0);            // own lanes (heading -Z) approach from +Z
    make(cw.cx - offset, cw.cz - back, Math.PI);      // oncoming lanes approach from -Z
  } else {
    make(cw.cx + back, cw.cz - offset, Math.PI / 2);  // approaching from +X, the sign faces +X
    make(cw.cx - back, cw.cz + offset, -Math.PI / 2);
  }
}

// Distance (m) from a car's front bumper to the nearest crossing ahead that has pedestrians on
// the roadway — how far it can roll before it must stop — or Infinity when nothing is in the
// way. (x, z) is the car's centre, (hx, hz) its heading along one of the two road axes and
// `halfLen` half its length. Crossings already underneath the car don't count.
export function occupiedCrosswalkGap(x, z, hx, hz, halfLen, maxDist = 32) {
  let best = Infinity;
  for (const cw of CROSSWALKS) {
    if (cw.pedsOnRoad === 0) continue;
    let along, lateral;
    if (cw.axis === 'x') {
      if (Math.abs(hz) < 0.7) continue;
      lateral = Math.abs(cw.cx - x);
      along = (cw.cz - z) * Math.sign(hz);
    } else {
      if (Math.abs(hx) < 0.7) continue;
      lateral = Math.abs(cw.cz - z);
      along = (cw.cx - x) * Math.sign(hx);
    }
    if (lateral > cw.roadHalf + 1.5 || along < 1 || along > maxDist) continue;
    const gap = along - halfLen - 2.4; // stop just short of the stripes
    if (gap < -3) continue;            // already too close to stop: let it clear the crossing
    if (gap < best) best = gap;
  }
  return best;
}
