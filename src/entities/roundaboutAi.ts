import * as THREE from 'three';
import { rand, choice } from '../utils/rng';
import { chassisBody } from './player';
import { createTrafficVehicle, placeTrafficVehicle, removeTrafficVehicle, pickTrafficType, type TrafficVehicle } from './aiVehicles';
import { pickDriverProfile, PROFILE_SPEED, PROFILE_GAP, type DriverProfile } from './drivers';
import type { ResolvedScenario } from '../state/settings';
import { RB, ARMS, getRoute, sampleRoute, ringInfo, wrapAngle, type Route, type RouteSample } from '../world/roundabout';
import { occupiedCrosswalkGap } from '../world/crosswalks';

// Traffic for the roundabout scenario. Every car follows a precomputed route (entry arm ->
// ring -> exit arm, see world/roundabout.ts). Cars yield at the line to anyone already on the
// ring, keep a following distance to whatever is ahead (other cars *and* the player), and a
// share of them are bad drivers who roll through the yield without looking, while the good ones
// leave more room and signal right before leaving the ring.

const TWO_PI = Math.PI * 2;
export interface RoundaboutCar extends TrafficVehicle {
  route: Route;
  s: number;            // arc length travelled along the route
  speed: number;
  x: number;
  z: number;
  profile: DriverProfile;
  reckless: boolean;
  braking: boolean;
  inRing: boolean;
  theta: number;
  r: number;
}

export const roundaboutPool: RoundaboutCar[] = [];
const pool = roundaboutPool;
let targetCount = 20;
let scenarioRef: { badDrivers?: number; goodDrivers?: number } = {};
let spawnTimer = 0;
const sample: RouteSample = { x: 0, z: 0, hx: 0, hz: 0 };

// Angular window (radians, upstream of an entry point) inside which a circling car counts as
// "about to arrive" — traffic entering must give way to it.
const YIELD_WINDOW = 1.2;
const JUST_PASSED = 0.3;

export function initRoundaboutAi(scenario: ResolvedScenario): void {
  targetCount = scenario.aiTargetCount ?? 20;
  scenarioRef = scenario;
  pool.forEach(removeTrafficVehicle);
  pool.length = 0;
  spawnTimer = 0;
  // populate the approaches right away so the ring isn't empty for the first half-minute
  for (let i = 0; i < targetCount; i++) trySpawn(true);
}

function trySpawn(scatter: boolean): boolean {
  const entry = choice(ARMS).id;
  const exit = choice(ARMS.filter(a => a.id !== entry)).id;
  const route = getRoute(entry, exit);
  const s = scatter ? rand(0, route.yieldS - 12) : 0;
  sampleRoute(route, s, sample);

  const p = chassisBody.position;
  if (Math.hypot(sample.x - p.x, sample.z - p.z) < (scatter ? 40 : 25)) return false;
  if (pool.some(o => Math.hypot(o.x - sample.x, o.z - sample.z) < 14)) return false;

  const v = createTrafficVehicle(pickTrafficType());
  const profile = pickDriverProfile(scenarioRef);
  const ai: RoundaboutCar = {
    ...v, route, s, speed: v.cruiseSpeed * 0.8, x: sample.x, z: sample.z,
    profile, reckless: profile === 'bad', braking: false, inRing: false, theta: 0, r: 0,
  };
  placeTrafficVehicle(ai, sample.x, sample.z, sample.hx, sample.hz, ai.speed);
  pool.push(ai);
  return true;
}

// Is any circling car (other than `self`, plus the player) about to reach `entryTheta`?
function ringBusyAt(entryTheta: number, self: RoundaboutCar, maxWindow = YIELD_WINDOW): boolean {
  const check = (theta: number, speed: number): boolean => {
    const d = wrapAngle(theta - entryTheta);
    return speed > 0.5 && (d < maxWindow || d > TWO_PI - JUST_PASSED);
  };
  for (const o of pool) if (o !== self && o.inRing && check(o.theta, o.speed)) return true;
  const p = chassisBody.position;
  const pi = ringInfo(p.x, p.z);
  return pi.r < RB.outerR && pi.r > RB.innerR - 1 && check(pi.theta, chassisBody.velocity.length());
}

// For the player's own yield check (systems/rules.ts): is an AI car circling toward the
// point where the player is entering, close enough that entering now cuts it off?
export function aiCirclingTowards(entryTheta: number, maxWindow = 0.9): boolean {
  for (const o of pool) {
    if (!o.inRing || o.speed < 1.5) continue;
    const d = wrapAngle(o.theta - entryTheta);
    if (d < maxWindow) return true;
  }
  return false;
}

function leadGap(ai: RoundaboutCar, hx: number, hz: number): { gap: number; speed: number } {
  let bestGap = Infinity, bestSpeed = 0;
  const consider = (ox: number, oz: number, ohalfZ: number, ospeed: number): void => {
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

export function updateRoundaboutAi(dt: number): void {
  const blinkOn = Math.floor(performance.now() / 350) % 2 === 0;
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

    let target = ai.cruiseSpeed * PROFILE_SPEED[ai.profile];
    if (ai.r < RB.outerR + 16) target = Math.min(target, 8);
    if (ai.inRing) target = Math.min(target, 6.5);

    // give way at the yield line while the ring is busy upstream of the entry
    const toYield = ai.route.yieldS - ai.s;
    if (!ai.reckless && toYield > -1 && toYield < 28 && ringBusyAt(ai.route.entryTheta, ai)) {
      const room = toYield - ai.half.z - 1.5;
      target = Math.min(target, THREE.MathUtils.clamp(room / 9, 0, 1) * target);
    }

    // stop short of a zebra with pedestrians on it (bad drivers don't)
    if (ai.profile !== 'bad') {
      const zgap = occupiedCrosswalkGap(ai.x, ai.z, hx, hz, ai.half.z);
      if (zgap < Infinity) target = Math.min(target, THREE.MathUtils.clamp(zgap / 8, 0, 1) * target);
    }

    // keep a gap to whatever is ahead, the player included
    const lead = leadGap(ai, hx, hz);
    const [standing, headway] = PROFILE_GAP[ai.profile];
    const safe = standing + ai.speed * headway;
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
    // courteous drivers signal right from just before the exit curve until they've left the ring
    const signalling = ai.profile === 'good' && ai.s > ai.route.exitStartS - 10 && ai.s < ai.route.exitEndS;
    ai.mesh.userData.indicators?.right.forEach(m => { m.material.emissiveIntensity = signalling && blinkOn ? 1 : 0; });
  }

  spawnTimer += dt;
  if (pool.length < targetCount && spawnTimer > 0.8 && trySpawn(false)) spawnTimer = 0;
}
