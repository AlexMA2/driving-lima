import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rng, rand, choice } from '../utils/rng.js';
import { LANE_X, PLAYER_LANES, laneDir } from '../world/road.js';
import { createTrafficVehicle, placeTrafficVehicle, removeTrafficVehicle, pickTrafficType } from './aiVehicles.js';
import { chassisBody } from './player.js';
import { stalledVehicles } from './obstacles.js';

// Traffic for the straight-avenue scenarios. Each car is a small state machine:
//   DRIVE -> CHANGE_LANE (unsignaled) / STOPPED (sudden passenger stop) / TAILGATE (bad driver
//   rides your bumper, then brake-checks) -> DRIVE.
// Cars keep a following distance to whatever is ahead (other cars, the player, stalled cars) and
// swerve around a blocked lane when the next one is clear. A share of the traffic is spawned as
// "overtakers": cars that come up fast from behind in the neighbouring lane, so the player has
// to check the mirrors before merging.
export const aiPool = [];

let targetCount = CONFIG.AI_TARGET_COUNT;
let badDriverMultiplier = 1;
let passingShare = 0.35;   // fraction of spawns that are overtakers coming up from behind
const MAX_OVERTAKERS = 3;

export function initAiTraffic(scenario) {
  targetCount = Math.round((scenario.aiTargetCount ?? CONFIG.AI_TARGET_COUNT));
  badDriverMultiplier = (scenario.badDrivers ?? 25) / 25; // 25% reckless == 1.0
  passingShare = (scenario.passing ?? 35) / 100;
  aiPool.forEach(removeTrafficVehicle);
  aiPool.length = 0;
}

function playerLaneX() {
  let best = PLAYER_LANES[0], bestD = Infinity;
  PLAYER_LANES.forEach(x => { const d = Math.abs(x - chassisBody.position.x); if (d < bestD) { bestD = d; best = x; } });
  return best;
}

function addAi(v, laneX, z, speed, extra = {}) {
  const dir = laneDir(laneX);
  const laneGroup = LANE_X.filter(x => (x > 0) === (laneX > 0));
  const ai = {
    ...v, laneGroup, currentX: laneX, targetX: laneX, dir, speed, baseSpeed: speed,
    state: 'DRIVE', stateTimer: 0, isBadDriver: false, role: 'traffic', braking: false, ...extra,
  };
  placeTrafficVehicle(ai, laneX, z, 0, dir, speed);
  ai.mesh.rotation.y = dir < 0 ? 0 : Math.PI;
  aiPool.push(ai);
  return ai;
}

function spawnAiVehicle() {
  const negLanes = LANE_X.filter(x => x < 0);
  const posLanes = LANE_X.filter(x => x > 0);
  const overtakers = aiPool.filter(a => a.role === 'overtaker').length;
  const playerSpeed = chassisBody.velocity.length();

  if (overtakers < MAX_OVERTAKERS && playerSpeed > 5 && rng() < passingShare) {
    // fast car closing from behind in a lane other than the player's (when there is one)
    const own = playerLaneX();
    const lanes = PLAYER_LANES.length > 1 ? PLAYER_LANES.filter(x => x !== own) : PLAYER_LANES;
    spawnOvertaker({ laneX: choice(lanes), gapBehind: rand(45, 95), relSpeed: rand(5, 9) });
    return;
  }

  const type = pickTrafficType();
  const laneGroup = choice([negLanes, posLanes]);
  const currentX = choice(laneGroup);
  const dir = laneDir(currentX);
  // spawn ahead of the player relative to travel direction
  const spawnZ = dir < 0
    ? chassisBody.position.z - rand(60, 170)
    : chassisBody.position.z - rand(140, 320);

  const v = createTrafficVehicle(type);
  const isBadDriver = type === 'car' && rng() < 0.25 * badDriverMultiplier;
  addAi(v, currentX, spawnZ, v.cruiseSpeed, { isBadDriver });
}

// A car that comes from behind the player in `laneX`, `gapBehind` metres back, faster than the
// player by `relSpeed` m/s (so it passes within a handful of seconds). Used both for ambient
// passing traffic and by the breakdown event (entities/breakdowns.js), which times it to arrive
// alongside the player right when they are trying to get around the stalled car.
export function spawnOvertaker({ laneX, gapBehind, relSpeed }) {
  // Anything already in that lane behind the player would trap the overtaker in a queue (or
  // overlap it at spawn), so clear the stretch it has to cover. It's behind the player, out of
  // the forward view.
  const playerZ = chassisBody.position.z;
  for (let i = aiPool.length - 1; i >= 0; i--) {
    const o = aiPool[i], oz = o.mesh.position.z;
    if (o.dir === laneDir(laneX) && Math.abs(o.currentX - laneX) < 2 && oz > playerZ + 8 && oz < playerZ + gapBehind + 15) {
      removeTrafficVehicle(o);
      aiPool.splice(i, 1);
    }
  }
  const v = createTrafficVehicle(choice(['car', 'car', 'car', 'combi']));
  const speed = Math.max(14, chassisBody.velocity.length() + relSpeed);
  return addAi(v, laneX, chassisBody.position.z + gapBehind, speed, { role: 'overtaker' });
}

// Nearest thing ahead of `ai` in its own lane: other traffic, the player, stalled cars.
function findLeader(ai) {
  const z = ai.mesh.position.z;
  let best = null;
  const consider = (ox, oz, halfZ, speed) => {
    if (Math.abs(ox - ai.currentX) > 1.9) return;
    const along = ai.dir < 0 ? z - oz : oz - z;
    if (along <= 0 || along > 60) return;
    const gap = along - ai.half.z - halfZ;
    if (!best || gap < best.gap) best = { gap, speed };
  };
  aiPool.forEach(o => { if (o !== ai && o.dir === ai.dir) consider(o.currentX, o.mesh.position.z, o.half.z, o.speed); });
  if (laneDir(chassisBody.position.x) === ai.dir) consider(chassisBody.position.x, chassisBody.position.z, 2.2, chassisBody.velocity.length());
  stalledVehicles.forEach(s => { if (laneDir(s.x) === ai.dir) consider(s.x, s.z, s.halfZ, 0); });
  return best;
}

// Is `laneX` free of vehicles alongside `ai` (16 m behind, 28 m ahead)?
function laneClear(ai, laneX) {
  const z = ai.mesh.position.z;
  const conflicts = (ox, oz) => {
    if (Math.abs(ox - laneX) > 2.0) return false;
    const along = ai.dir < 0 ? z - oz : oz - z;
    return along > -16 && along < 28;
  };
  if (aiPool.some(o => o !== ai && o.dir === ai.dir && conflicts(o.currentX, o.mesh.position.z))) return false;
  if (laneDir(chassisBody.position.x) === ai.dir && conflicts(chassisBody.position.x, chassisBody.position.z)) return false;
  return !stalledVehicles.some(s => laneDir(s.x) === ai.dir && conflicts(s.x, s.z));
}

function beginLaneChange(ai, laneX) {
  ai.targetX = laneX;
  ai.state = 'CHANGE_LANE';
  ai.stateTimer = 0;
}

export function updateAi(dt) {
  for (let i = aiPool.length - 1; i >= 0; i--) {
    const ai = aiPool[i];
    ai.stateTimer += dt;
    const leader = findLeader(ai);

    if (ai.state === 'DRIVE') {
      const laneChangeChance = CONFIG.AI_LANE_CHANGE_CHANCE_PER_SEC * badDriverMultiplier;
      const blocked = leader && leader.speed < 2 && leader.gap < 45;
      if (blocked) {
        // a stalled car (or a stopped queue) ahead: go around if the next lane is clear, else wait
        const free = ai.laneGroup.find(x => x !== ai.currentX && laneClear(ai, x));
        if (free !== undefined) beginLaneChange(ai, free);
      } else if ((ai.type === 'combi' || ai.type === 'mototaxi') && ai.role === 'traffic' && rng() < laneChangeChance * dt) {
        const other = ai.laneGroup.find(x => x !== ai.currentX && laneClear(ai, x));
        if (other !== undefined) beginLaneChange(ai, other);
      } else if (ai.type === 'combi' && ai.role === 'traffic' && rng() < CONFIG.AI_SUDDEN_STOP_CHANCE_PER_SEC * dt) {
        ai.state = 'STOPPED'; ai.stateTimer = 0;
      } else if (ai.isBadDriver) {
        // Reckless tailgater: when close behind the player in the same lane, surges forward
        // then randomly brake-checks — a hazard the player has to react to, not cause.
        const sameLane = Math.abs(ai.currentX - chassisBody.position.x) < 2 && ai.dir === laneDir(chassisBody.position.x);
        const gap = ai.dir < 0 ? chassisBody.position.z - ai.mesh.position.z : ai.mesh.position.z - chassisBody.position.z;
        if (sameLane && gap > 0 && gap < 18) {
          ai.state = 'TAILGATE'; ai.stateTimer = 0;
        } else if (rng() < CONFIG.AI_TAILGATE_CHANCE_PER_SEC * badDriverMultiplier * dt) {
          ai.state = 'TAILGATE'; ai.stateTimer = 0; // also weaves erratically even without a target
        }
      }
    } else if (ai.state === 'CHANGE_LANE') {
      const t = Math.min(ai.stateTimer / 1.1, 1);
      ai.currentX = THREE.MathUtils.lerp(ai.currentX, ai.targetX, 0.08);
      if (t >= 1) { ai.currentX = ai.targetX; ai.state = 'DRIVE'; }
    } else if (ai.state === 'STOPPED') {
      ai.speed = THREE.MathUtils.lerp(ai.speed, 0, 0.15);
      if (ai.stateTimer > rand(2.5, 4.5)) { ai.state = 'DRIVE'; }
    } else if (ai.state === 'TAILGATE') {
      ai.speed = THREE.MathUtils.lerp(ai.speed, ai.baseSpeed * 1.9, 0.06);
      if (ai.stateTimer > rand(1.8, 3.2)) { ai.state = 'DRIVE'; ai.stateTimer = 0; }
    }

    // Cruise toward baseSpeed, easing down to match whatever is close ahead.
    ai.braking = false;
    if (ai.state !== 'STOPPED' && ai.state !== 'TAILGATE') {
      let target = ai.baseSpeed;
      if (leader) {
        const safe = 4 + ai.speed * 0.9;
        if (leader.gap < safe) {
          target = Math.min(target, leader.speed * THREE.MathUtils.clamp((leader.gap - 2) / (safe - 2), 0, 1));
          ai.braking = target < ai.speed - 0.5;
        }
      }
      ai.speed = THREE.MathUtils.lerp(ai.speed, target, target < ai.speed ? 0.12 : 0.05);
    }
    if (leader && leader.gap < 1.5) ai.speed = Math.min(ai.speed, leader.speed); // never phase through

    const newZ = ai.mesh.position.z + ai.dir * ai.speed * dt;
    if (ai.mesh.userData.tailLights) {
      ai.mesh.userData.tailLights.forEach(t => { t.material.emissiveIntensity = ai.state === 'STOPPED' || ai.braking ? 0.9 : 0.3; });
    }

    ai.body.position.set(ai.currentX, ai.body.position.y, newZ);
    ai.body.velocity.set((ai.currentX - ai.mesh.position.x) / dt, 0, (newZ - ai.mesh.position.z) / dt);
    ai.mesh.position.set(ai.currentX, 0, newZ);
    ai.mesh.rotation.y = ai.dir < 0 ? 0 : Math.PI;

    // recycle when far from the player
    if (Math.abs(ai.mesh.position.z - chassisBody.position.z) > 420) {
      removeTrafficVehicle(ai);
      aiPool.splice(i, 1);
    }
  }
  while (aiPool.length < targetCount) spawnAiVehicle();
}
