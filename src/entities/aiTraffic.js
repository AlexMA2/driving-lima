import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config.js';
import { rng, rand, choice } from '../utils/rng.js';
import { scene } from '../core/scene.js';
import { world, propMaterial } from '../core/physics.js';
import { LANE_X, laneDir } from '../world/road.js';
import { buildSedan, buildCombi, buildMototaxi } from '../assets/vehicles.js';
import { chassisBody } from './player.js';

const AI_TYPES = ['car', 'car', 'combi', 'mototaxi', 'mototaxi'];
const CAR_COLORS = [0xcc2b2b, 0x2e7d32, 0x455a64, 0xf9a825, 0x6a1b9a];

// Finite-state pool: DRIVE -> CHANGE_LANE (unsignaled) / STOPPED (sudden passenger stop) /
// TAILGATE (bad driver rides your bumper, then brake-checks) -> DRIVE.
export const aiPool = [];

let targetCount = CONFIG.AI_TARGET_COUNT;
let badDriverMultiplier = 1;

export function initAiTraffic(scenario) {
  targetCount = Math.round((scenario.aiTargetCount ?? CONFIG.AI_TARGET_COUNT));
  badDriverMultiplier = scenario.badDriverMultiplier ?? 1;
  aiPool.forEach(ai => { scene.remove(ai.mesh); world.removeBody(ai.body); });
  aiPool.length = 0;
}

function spawnAiVehicle() {
  const type = choice(AI_TYPES);
  const negLanes = LANE_X.filter(x => x < 0);
  const posLanes = LANE_X.filter(x => x > 0);
  const laneGroup = choice([negLanes, posLanes]);
  const currentX = choice(laneGroup);
  const dir = laneDir(currentX);
  // spawn ahead of the player relative to travel direction
  const spawnZ = dir < 0
    ? chassisBody.position.z - rand(60, 170)
    : chassisBody.position.z - rand(140, 320);

  let mesh, speed, half;
  const isBadDriver = type === 'car' && rng() < 0.25 * badDriverMultiplier;
  if (type === 'combi') { mesh = buildCombi(0x2266aa); speed = rand(6, 10); half = new CANNON.Vec3(1.05, 0.85, 2.8); }
  else if (type === 'mototaxi') { mesh = buildMototaxi(choice([0xffcc00, 0x43a047, 0x1e88e5])); speed = rand(5, 8); half = new CANNON.Vec3(0.65, 0.6, 1.1); }
  else { mesh = buildSedan(choice(CAR_COLORS)); speed = rand(8, 13); half = new CANNON.Vec3(0.95, 0.55, 2.2); }

  mesh.position.set(currentX, 0, spawnZ);
  mesh.rotation.y = dir < 0 ? 0 : Math.PI;
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: propMaterial });
  body.addShape(new CANNON.Box(half));
  body.position.set(currentX, half.y, spawnZ);
  body.userData = { isPenalized: true, type: 'ai-' + type };
  world.addBody(body);

  aiPool.push({
    mesh, body, type, laneGroup, currentX, targetX: currentX, dir, speed, baseSpeed: speed,
    state: 'DRIVE', stateTimer: 0, prevPos: new THREE.Vector3(currentX, 0, spawnZ), isBadDriver,
  });
}

export function updateAi(dt) {
  for (let i = aiPool.length - 1; i >= 0; i--) {
    const ai = aiPool[i];
    ai.stateTimer += dt;

    if (ai.state === 'DRIVE') {
      const laneChangeChance = CONFIG.AI_LANE_CHANGE_CHANCE_PER_SEC * badDriverMultiplier;
      if ((ai.type === 'combi' || ai.type === 'mototaxi') && rng() < laneChangeChance * dt) {
        const other = ai.laneGroup.find(x => x !== ai.currentX);
        if (other !== undefined) { ai.targetX = other; ai.state = 'CHANGE_LANE'; ai.stateTimer = 0; }
      } else if (ai.type === 'combi' && rng() < CONFIG.AI_SUDDEN_STOP_CHANCE_PER_SEC * dt) {
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

    if (ai.state !== 'STOPPED' && ai.state !== 'TAILGATE') ai.speed = THREE.MathUtils.lerp(ai.speed, ai.baseSpeed, 0.05);

    const newZ = ai.mesh.position.z + ai.dir * ai.speed * dt;
    const newPos = new THREE.Vector3(ai.currentX, 0, newZ);

    // brake-light visual (combis/mototaxis never signal lane changes — scenario requirement)
    if (ai.mesh.userData.tailLights) {
      ai.mesh.userData.tailLights.forEach(t => { t.material.emissiveIntensity = ai.state === 'STOPPED' ? 0.9 : 0.3; });
    }

    ai.body.position.set(newPos.x, ai.body.position.y, newPos.z);
    ai.body.velocity.set((newPos.x - ai.prevPos.x) / dt, 0, (newPos.z - ai.prevPos.z) / dt);
    ai.mesh.position.copy(newPos);
    ai.mesh.rotation.y = ai.dir < 0 ? 0 : Math.PI;
    ai.prevPos.copy(newPos);

    // recycle when far from player
    if (Math.abs(ai.mesh.position.z - chassisBody.position.z) > 420) {
      scene.remove(ai.mesh);
      world.removeBody(ai.body);
      aiPool.splice(i, 1);
    }
  }
  while (aiPool.length < targetCount) spawnAiVehicle();
}
