import * as THREE from 'three';
import { rng, rand, choice } from '../utils/rng.js';
import { chassisBody } from './player.js';
import { createTrafficVehicle, placeTrafficVehicle, removeTrafficVehicle, pickTrafficType } from './aiVehicles.js';
import { RB, ARMS, getRoute, sampleRoute, ringInfo, wrapAngle } from '../world/roundabout.js';

// Traffic for the roundabout scenario. Every car follows a precomputed route (entry arm ->
// ring -> exit arm, see world/roundabout.js). Cars yield at the line to anyone already on the
// ring, keep a following distance to whatever is ahead (other cars *and* the player), and a
// share of them are reckless and roll through the yield without looking.

const TWO_PI = Math.PI * 2;
export const roundaboutPool = [];
const pool = roundaboutPool;
let targetCount = 20;
let recklessChance = 0.2;
let spawnTimer = 0;
const sample = {};

// Angular window (radians, upstream of an entry point) inside which a circling car counts as
// "about to arrive" — traffic entering must give way to it.
const YIELD_WINDOW = 1.2;
const JUST_PASSED = 0.3;

export function initRoundaboutAi(scenario) {
  targetCount = scenario.aiTargetCount ?? 20;
  recklessChance = (scenario.badDrivers ?? 20) / 100;
  pool.forEach(removeTrafficVehicle);
  pool.length = 0;
  spawnTimer = 0;
  // populate the approaches right away so the ring isn't empty for the first half-minute
  for (let i = 0; i < targetCount; i++) trySpawn(true);
}

function trySpawn(scatter) {
  const entry = choice(ARMS).id;
  const exit = choice(ARMS.filter(a => a.id !== entry)).id;
  const route = getRoute(entry, exit);
  const s = scatter ? rand(0, route.yieldS - 12) : 0;
  sampleRoute(route, s, sample);

  const p = chassisBody.position;
  if (Math.hypot(sample.x - p.x, sample.z - p.z) < (scatter ? 40 : 25)) return false;
  if (pool.some(o => Math.hypot(o.x - sample.x, o.z - sample.z) < 14)) return false;

  const v = createTrafficVehicle(pickTrafficType());
  const ai = {
    ...v, route, s, speed: v.cruiseSpeed * 0.8, x: sample.x, z: sample.z,
    reckless: rng() < recklessChance, braking: false, inRing: false, theta: 0,
  };
  placeTrafficVehicle(ai, sample.x, sample.z, sample.hx, sample.hz, ai.speed);
  pool.push(ai);
  return true;
}

// Is any circling car (other than `self`, plus the player) about to reach `entryTheta`?
function ringBusyAt(entryTheta, self, maxWindow = YIELD_WINDOW) {
  const check = (theta, speed) => {
    const d = wrapAngle(theta - entryTheta);
    return speed > 0.5 && (d < maxWindow || d > TWO_PI - JUST_PASSED);
  };
  for (const o of pool) if (o !== self && o.inRing && check(o.theta, o.speed)) return true;
  const p = chassisBody.position;
  const pi = ringInfo(p.x, p.z);
  return pi.r < RB.outerR && pi.r > RB.innerR - 1 && check(pi.theta, chassisBody.velocity.length());
}

// For the player's own yield check (systems/rules.js): is an AI car circling toward the
// point where the player is entering, close enough that entering now cuts it off?
export function aiCirclingTowards(entryTheta, maxWindow = 0.9) {
  for (const o of pool) {
    if (!o.inRing || o.speed < 1.5) continue;
    const d = wrapAngle(o.theta - entryTheta);
    if (d < maxWindow) return true;
  }
  return false;
}

function leadGap(ai, hx, hz) {
  let bestGap = Infinity, bestSpeed = 0;
  const consider = (ox, oz, ohalfZ, ospeed) => {
    const dx = ox - ai.x, dz = oz - ai.z;
    const along = dx * hx + dz * hz;
    if (along <= 0 || along > 34) return;
    if (Math.abs(dx * hz - dz * hx) > 2.3) return;
    const gap = along - ai.half.z - ohalfZ;
    if (gap < bestGap) { bestGap = gap; bestSpeed = ospeed; }
  };
  for (const o of pool) if (o !== ai) consider(o.x, o.z, o.half.z, o.speed);
  const p = chassisBody.position;
  consider(p.x, p.z, 2.2, chassisBody.velocity.length());
  return { gap: bestGap, speed: bestSpeed };
}

export function updateRoundaboutAi(dt) {
  for (const ai of pool) {
    const info = ringInfo(ai.x, ai.z);
    ai.theta = info.theta;
    ai.inRing = info.r < RB.outerR + 0.5 && info.r > RB.innerR - 1;
    ai.r = info.r;
  }

  for (let i = pool.length - 1; i >= 0; i--) {
    const ai = pool[i];
    sampleRoute(ai.route, ai.s, sample);
    const { hx, hz } = sample;

    let target = ai.cruiseSpeed * (ai.reckless ? 1.25 : 1);
    if (ai.r < RB.outerR + 16) target = Math.min(target, 8);
    if (ai.inRing) target = Math.min(target, 6.5);

    // give way at the yield line while the ring is busy upstream of the entry
    const toYield = ai.route.yieldS - ai.s;
    if (!ai.reckless && toYield > -1 && toYield < 28 && ringBusyAt(ai.route.entryTheta, ai)) {
      const room = toYield - ai.half.z - 1.5;
      target = Math.min(target, THREE.MathUtils.clamp(room / 9, 0, 1) * target);
    }

    // keep a gap to whatever is ahead, the player included
    const lead = leadGap(ai, hx, hz);
    const safe = (ai.reckless ? 2 : 3) + ai.speed * (ai.reckless ? 0.45 : 0.8);
    if (lead.gap < safe) {
      target = Math.min(target, lead.speed * THREE.MathUtils.clamp((lead.gap - 1.5) / (safe - 1.5), 0, 1));
    }

    const accel = target > ai.speed ? 2.8 : -7;
    ai.speed = Math.max(0, ai.speed + THREE.MathUtils.clamp(target - ai.speed, -Math.abs(accel) * dt, Math.abs(accel) * dt));
    ai.braking = target < ai.speed - 0.3;
    ai.s += ai.speed * dt;

    if (ai.s >= ai.route.length - 2) { removeTrafficVehicle(ai); pool.splice(i, 1); continue; }

    sampleRoute(ai.route, ai.s, sample);
    ai.x = sample.x; ai.z = sample.z;
    placeTrafficVehicle(ai, sample.x, sample.z, sample.hx, sample.hz, ai.speed);
    if (ai.mesh.userData.tailLights) {
      ai.mesh.userData.tailLights.forEach(t => { t.material.emissiveIntensity = ai.braking ? 0.9 : 0.3; });
    }
  }

  spawnTimer += dt;
  if (pool.length < targetCount && spawnTimer > 0.8 && trySpawn(false)) spawnTimer = 0;
}
