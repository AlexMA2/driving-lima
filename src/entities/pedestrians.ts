import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config';
import { rng, rand, choice } from '../utils/rng';
import { scene } from '../core/scene';
import { world, propMaterial } from '../core/physics';
import { ROAD_HALF_WIDTH } from '../world/road';
import { CROSSWALKS, type Crosswalk } from '../world/crosswalks';
import type { ResolvedScenario } from '../state/settings';
import { buildPedestrian } from '../assets/props';
import { chassisBody } from './player';
import { distanceBetween as distanceTo } from '../utils/cannonThree';
import { triggerInfraction } from '../systems/rules';
import { playPedestrianChatter } from '../systems/audio';

// Pedestrians. Most cross at a marked zebra (see world/crosswalks.ts), starting when the player
// is a fair way off so they're mid-crossing as the car arrives — drivers who don't stop for them
// get a G57. On the straight avenues some also jaywalk anywhere ahead, forcing a braking decision.
export interface Pedestrian {
  mesh: THREE.Group;
  body: CANNON.Body;
  axis: 'x' | 'z';
  dir: number;
  speed: number;
  center: number;
  fixed: number;
  roadHalf: number;
  walkHalf: number;
  u: number;              // position along the walking axis
  cw: Crosswalk | null;
  yieldChecked: boolean;
  onRoad: boolean;
  pos: THREE.Vector3;
  hit?: boolean;
  hitTimer?: number;
}

// Where a pedestrian walks: a registered crosswalk or a plain line (a jaywalker's).
export interface WalkLine {
  axis: 'x' | 'z';
  center?: number;
  fixed?: number;
  cx?: number;
  cz?: number;
  roadHalf: number;
  walkHalf: number;
}

export const pedestrianPool: Pedestrian[] = [];
let maxPedestrians = CONFIG.PEDESTRIAN_TARGET_COUNT;
let allowJaywalkers = true;

const SHIRTS = [0xd32f2f, 0x1976d2, 0x388e3c, 0xffa000, 0x5d4037];

export function initPedestrians(scenario: ResolvedScenario): void {
  maxPedestrians = scenario.pedestrians ?? CONFIG.PEDESTRIAN_TARGET_COUNT;
  allowJaywalkers = scenario.layout === 'line';
  pedestrianPool.forEach(removeBody);
  pedestrianPool.length = 0;
}

function removeBody(p: Pedestrian): void {
  scene.remove(p.mesh);
  world.removeBody(p.body);
}

// World position of a pedestrian: `u` along its walking axis, `fixed` on the other one.
function worldPos(p: Pedestrian, out: THREE.Vector3): THREE.Vector3 {
  if (p.axis === 'x') out.set(p.u, 0, p.fixed); else out.set(p.fixed, 0, p.u);
  return out;
}

// `crosswalk` may be a registry entry or a plain descriptor for a jaywalking line
// ({ axis, center, fixed, roadHalf, walkHalf }); `dir` is +1 or -1 along the walking axis.
export function spawnPedestrian(crosswalk: WalkLine, dir = choice([-1, 1]), speed = rand(1.1, 1.7)): Pedestrian {
  const axis = crosswalk.axis;
  const center = (axis === 'x' ? (crosswalk.cx ?? crosswalk.center) : (crosswalk.cz ?? crosswalk.center)) as number;
  const fixed = (crosswalk.fixed ?? (axis === 'x' ? crosswalk.cz : crosswalk.cx)) as number;
  const mesh = buildPedestrian(choice(SHIRTS));
  scene.add(mesh);

  // A kinematic body has infinite mass: with normal contact response a pedestrian strolling into the side of a
  // stopped car would shove it across the road, and a car that hit one would stop dead as against a wall. So the
  // pedestrian only *reports* touches (systems/rules.ts decides whether they cost a fine) and never pushes.
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.65, 0.2)));
  body.collisionResponse = false;
  body.userData = { isPenalized: true, type: 'pedestrian' };
  world.addBody(body);

  const p: Pedestrian = {
    mesh, body, axis, dir, speed, center, fixed,
    roadHalf: crosswalk.roadHalf, walkHalf: crosswalk.walkHalf,
    u: center - dir * crosswalk.walkHalf,
    cw: CROSSWALKS.includes(crosswalk as Crosswalk) ? (crosswalk as Crosswalk) : null,
    yieldChecked: false, onRoad: false, pos: new THREE.Vector3(),
  };
  worldPos(p, p.pos);
  mesh.position.copy(p.pos);
  body.position.set(p.pos.x, 0.65, p.pos.z);
  body.userData.onHit = () => knockDown(p);
  pedestrianPool.push(p);
  return p;
}

const DOWN_SECONDS = 6; // how long a pedestrian who was run over stays on the road

// A car ran into this pedestrian: they stop walking and lie where they fell for a few seconds.
function knockDown(p: Pedestrian): void {
  if (p.hit) return;
  p.hit = true;
  p.hitTimer = DOWN_SECONDS;
  p.body.velocity.set(0, 0, 0);
  p.mesh.rotation.x = -Math.PI / 2;
  p.mesh.position.y = 0.15;
}

function spawnIfNeeded(dt: number): void {
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

export function updatePedestrians(dt: number): void {
  CROSSWALKS.forEach(cw => { cw.pedsOnRoad = 0; });
  const pl = chassisBody.position;
  const playerSpeedKmh = chassisBody.velocity.length() * 3.6;

  for (let i = pedestrianPool.length - 1; i >= 0; i--) {
    const p = pedestrianPool[i];
    if (p.hit) {
      p.hitTimer = (p.hitTimer ?? 0) - dt;
      if (p.cw && p.onRoad) p.cw.pedsOnRoad++; // traffic still stops for someone lying on the crossing
      if (p.hitTimer <= 0 || distanceTo(pl, p.pos) > 250) { removeBody(p); pedestrianPool.splice(i, 1); }
      continue;
    }
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
    if (distanceTo(pl, p.pos) < 6) playPedestrianChatter();

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
    if (crossedFully || distanceTo(pl, p.pos) > 250) {
      removeBody(p);
      pedestrianPool.splice(i, 1);
    }
  }
  spawnIfNeeded(dt);
}
