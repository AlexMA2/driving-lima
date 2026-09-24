import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { rand, choice } from '../utils/rng';
import { scene } from '../core/scene';
import { world, propMaterial } from '../core/physics';
import { buildSedan } from '../assets/vehicles';
import { buildCone } from '../assets/props';
import { PLAYER_LANES, laneDir } from '../world/road';
import { chassisBody } from './player';
import { stalledVehicles, type StalledVehicle } from './obstacles';
import { spawnOvertaker } from './aiTraffic';
import type { Amount, ResolvedScenario } from '../state/settings';

// "Carro malogrado" events. Every so often a car breaks down ahead of the player *in the lane
// the player is driving in*, hazard lights blinking and cones set out behind it. To get past,
// the player has to change lanes — and that's exactly when the neighbouring lane fills up: a
// fast car is timed to come up from behind and reach the player's side while they approach the
// wreck, so merging without a look in the mirrors ends in a collision.

// Metres of road between consecutive events, by the "hazards" setting.
const SPACING: Partial<Record<Amount, number>> = { low: 900, medium: 560, high: 340 };
const FIRST_EVENT_DISTANCE = 260;
const MIN_SECONDS_BETWEEN = 12;

let spacing: number | null = SPACING.medium ?? null;
let nextTriggerZ = 0;
let lastEventTime = -Infinity;

export function initBreakdowns(scenario: Pick<ResolvedScenario, 'hazards'>): void {
  stalledVehicles.forEach(removeStalled);
  stalledVehicles.length = 0;
  spacing = SPACING[scenario.hazards ?? 'medium'] ?? null; // null = events switched off
  nextTriggerZ = chassisBody.position.z - FIRST_EVENT_DISTANCE;
  lastEventTime = -Infinity;
}

function nearestOwnLane(x: number): number {
  return PLAYER_LANES.reduce((best, lx) => (Math.abs(lx - x) < Math.abs(best - x) ? lx : best), PLAYER_LANES[0]);
}

export function spawnStalledCar(laneX: number, z: number): StalledVehicle {
  const mesh = buildSedan(choice([0x6b6b6b, 0x8d6e63, 0x546e7a, 0xb0bec5]));
  mesh.position.set(laneX, 0, z);
  mesh.rotation.y = laneDir(laneX) < 0 ? 0 : Math.PI;
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 0, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.95, 0.55, 2.2)));
  body.position.set(laneX, 0.55, z);
  body.userData = { isPenalized: true, type: 'breakdown' };
  world.addBody(body);

  // Makeshift warning markers (cones) placed before the vehicle, in the approach direction
  const approachSign = laneDir(laneX) < 0 ? 1 : -1;
  const cones: THREE.Group[] = [];
  for (let i = 1; i <= 3; i++) {
    const cone = buildCone();
    cone.position.set(laneX + rand(-0.4, 0.4), 0, z + approachSign * (2.6 + i * 3.2));
    scene.add(cone);
    cones.push(cone);
  }

  const entry = { x: laneX, z, halfZ: 2.2, halfX: 0.95, mesh, body, cones };
  stalledVehicles.push(entry);
  return entry;
}

function removeStalled(s: StalledVehicle): void {
  scene.remove(s.mesh);
  s.cones.forEach(c => scene.remove(c));
  world.removeBody(s.body);
}

function triggerBreakdown(): void {
  const speed = chassisBody.velocity.length();
  const laneX = nearestOwnLane(chassisBody.position.x);
  const distance = THREE.MathUtils.clamp(speed * 8, 110, 200);
  spawnStalledCar(laneX, chassisBody.position.z - distance);

  // Time the neighbouring-lane traffic to be alongside the player about halfway through the
  // approach: far enough back that it isn't visible yet, fast enough to arrive in time.
  const reachTime = distance / Math.max(speed, 6);
  const laneIndex = PLAYER_LANES.indexOf(laneX);
  PLAYER_LANES.forEach((otherX, i) => {
    if (Math.abs(i - laneIndex) !== 1) return;
    const passTime = reachTime * (0.5 + 0.12 * i) + rand(0, 1.2);
    const gapBehind = Math.min(95, 9 * passTime);
    const relSpeed = THREE.MathUtils.clamp(gapBehind / passTime, 5, 16);
    spawnOvertaker({ laneX: otherX, gapBehind, relSpeed });
  });
}

export function updateBreakdowns(): void {
  const blinkOn = Math.floor(performance.now() / 300) % 2 === 0;
  for (let i = stalledVehicles.length - 1; i >= 0; i--) {
    const s = stalledVehicles[i];
    [...s.mesh.userData.indicators.left, ...s.mesh.userData.indicators.right].forEach(m => {
      m.material.emissiveIntensity = blinkOn ? 1 : 0;
    });
    if (chassisBody.position.z < s.z - 90) { // well behind the player now
      removeStalled(s);
      stalledVehicles.splice(i, 1);
    }
  }

  if (spacing === null || chassisBody.position.z > nextTriggerZ) return;
  const now = performance.now() / 1000;
  if (now - lastEventTime < MIN_SECONDS_BETWEEN || chassisBody.velocity.length() < 3) return;
  lastEventTime = now;
  nextTriggerZ = chassisBody.position.z - spacing * rand(0.8, 1.25);
  triggerBreakdown();
}
