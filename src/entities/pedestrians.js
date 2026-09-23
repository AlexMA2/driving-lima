import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config.js';
import { rng, rand, choice } from '../utils/rng.js';
import { scene } from '../core/scene.js';
import { world, propMaterial } from '../core/physics.js';
import { ROAD_HALF_WIDTH } from '../world/road.js';
import { CROSSWALKS } from '../world/crosswalks.js';
import { buildPedestrian } from '../assets/props.js';
import { chassisBody } from './player.js';
import { triggerInfraction } from '../systems/rules.js';
import { playPedestrianChatter } from '../systems/audio.js';

// Pedestrians. Most cross at a marked zebra (see world/crosswalks.js), starting when the player
// is a fair way off so they're mid-crossing as the car arrives — drivers who don't stop for them
// get a G57. On the straight avenues some also jaywalk anywhere ahead, forcing a braking decision.
export const pedestrianPool = [];
let maxPedestrians = CONFIG.PEDESTRIAN_TARGET_COUNT;
let allowJaywalkers = true;

const SHIRTS = [0xd32f2f, 0x1976d2, 0x388e3c, 0xffa000, 0x5d4037];

export function initPedestrians(scenario) {
  maxPedestrians = scenario.pedestrians ?? CONFIG.PEDESTRIAN_TARGET_COUNT;
  allowJaywalkers = scenario.layout === 'line';
  pedestrianPool.forEach(removeBody);
  pedestrianPool.length = 0;
}

function removeBody(p) {
  scene.remove(p.mesh);
  world.removeBody(p.body);
}

// World position of a pedestrian: `u` along its walking axis, `fixed` on the other one.
function worldPos(p, out) {
  if (p.axis === 'x') out.set(p.u, 0, p.fixed); else out.set(p.fixed, 0, p.u);
  return out;
}

// `crosswalk` may be a registry entry or a plain descriptor for a jaywalking line
// ({ axis, center, fixed, roadHalf, walkHalf }); `dir` is +1 or -1 along the walking axis.
export function spawnPedestrian(crosswalk, dir = choice([-1, 1]), speed = rand(1.1, 1.7)) {
  const axis = crosswalk.axis;
  const center = axis === 'x' ? (crosswalk.cx ?? crosswalk.center) : (crosswalk.cz ?? crosswalk.center);
  const fixed = crosswalk.fixed ?? (axis === 'x' ? crosswalk.cz : crosswalk.cx);
  const mesh = buildPedestrian(choice(SHIRTS));
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.65, 0.2)));
  body.userData = { isPenalized: true, type: 'pedestrian' };
  world.addBody(body);

  const p = {
    mesh, body, axis, dir, speed, center, fixed,
    roadHalf: crosswalk.roadHalf, walkHalf: crosswalk.walkHalf,
    u: center - dir * crosswalk.walkHalf,
    cw: CROSSWALKS.includes(crosswalk) ? crosswalk : null,
    yieldChecked: false, onRoad: false, pos: new THREE.Vector3(),
  };
  worldPos(p, p.pos);
  mesh.position.copy(p.pos);
  body.position.set(p.pos.x, 0.65, p.pos.z);
  pedestrianPool.push(p);
  return p;
}

function spawnIfNeeded(dt) {
  if (pedestrianPool.length >= maxPedestrians || rng() >= CONFIG.PEDESTRIAN_SPAWN_CHANCE_PER_SEC * dt) return;
  const pl = chassisBody.position;

  if (allowJaywalkers && rng() < 0.4) {
    const fixed = pl.z - rand(25, 90);
    spawnPedestrian({ axis: 'x', center: 0, fixed, roadHalf: ROAD_HALF_WIDTH, walkHalf: ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH - 0.3 });
    return;
  }

  // a free zebra somewhere ahead-ish: close enough to matter, far enough to see the pedestrian set off
  const candidates = CROSSWALKS.filter(cw => {
    const d = Math.hypot(cw.cx - pl.x, cw.cz - pl.z);
    return cw.pedsOnRoad === 0 && d > 30 && d < 110 && !pedestrianPool.some(p => p.cw === cw);
  });
  if (candidates.length) spawnPedestrian(choice(candidates));
}

export function updatePedestrians(dt) {
  CROSSWALKS.forEach(cw => { cw.pedsOnRoad = 0; });
  const pl = chassisBody.position;
  const playerSpeedKmh = chassisBody.velocity.length() * 3.6;

  for (let i = pedestrianPool.length - 1; i >= 0; i--) {
    const p = pedestrianPool[i];
    const prev = p.pos.clone();
    p.u += p.dir * p.speed * dt;
    worldPos(p, p.pos);
    p.body.position.set(p.pos.x, 0.65, p.pos.z);
    p.body.velocity.set((p.pos.x - prev.x) / dt, 0, (p.pos.z - prev.z) / dt);
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.y = p.axis === 'x' ? (p.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (p.dir > 0 ? Math.PI : 0);

    p.onRoad = Math.abs(p.u - p.center) < p.roadHalf + 0.6;
    if (p.cw && p.onRoad) p.cw.pedsOnRoad++;

    // A passerby close to the car calls out / chats — small ambience, not a rule check.
    if (pl.distanceTo(p.pos) < 6) playPedestrianChatter();

    // G57: the player rolls through the crossing while a pedestrian is on the roadway beside them
    if (p.cw && p.onRoad && !p.yieldChecked && playerSpeedKmh > 8) {
      const along = p.axis === 'x' ? Math.abs(pl.z - p.cw.cz) : Math.abs(pl.x - p.cw.cx);
      const across = p.axis === 'x' ? Math.abs(pl.x - p.pos.x) : Math.abs(pl.z - p.pos.z);
      if (along < 3 && across < 4) {
        triggerInfraction('G57');
        p.yieldChecked = true;
      }
    }

    const crossedFully = Math.abs(p.u - p.center) > p.walkHalf;
    if (crossedFully || pl.distanceTo(p.pos) > 250) {
      removeBody(p);
      pedestrianPool.splice(i, 1);
    }
  }
  spawnIfNeeded(dt);
}
