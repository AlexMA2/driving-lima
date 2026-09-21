import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config.js';
import { rng, rand, choice } from '../utils/rng.js';
import { scene } from '../core/scene.js';
import { world, propMaterial } from '../core/physics.js';
import { ROAD_HALF_WIDTH } from '../world/road.js';
import { INTERSECTIONS } from '../world/intersections.js';
import { buildPedestrian } from '../assets/props.js';
import { chassisBody } from './player.js';
import { triggerInfraction } from '../systems/rules.js';
import { playPedestrianChatter } from '../systems/audio.js';

// Jaywalking pedestrians: spawn/despawn relative to the player, some cross near a marked
// crosswalk (feeding the G57 "did not yield" check), most cross wherever, forcing braking.
export const pedestrianPool = [];

function spawnPedestrian() {
  const fromLeft = rng() < 0.5;
  const startX = fromLeft ? -(ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH - 0.6) : (ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH - 0.6);
  const nearCrosswalk = rng() < 0.4 && INTERSECTIONS.length > 0;
  const z = nearCrosswalk ? choice(INTERSECTIONS).crosswalkZ + rand(-1, 1) : chassisBody.position.z - rand(25, 90);

  const mesh = buildPedestrian(choice([0xd32f2f, 0x1976d2, 0x388e3c, 0xffa000, 0x5d4037]));
  mesh.position.set(startX, 0, z);
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.2, 0.65, 0.2)));
  body.position.set(startX, 0.65, z);
  body.userData = { isPenalized: true, type: 'pedestrian' };
  world.addBody(body);

  pedestrianPool.push({
    mesh, body, dirX: fromLeft ? 1 : -1, speed: rand(1.1, 1.7), z,
    nearCrosswalk, yieldChecked: false, prevPos: new THREE.Vector3(startX, 0, z),
  });
}

export function updatePedestrians(dt) {
  for (let i = pedestrianPool.length - 1; i >= 0; i--) {
    const p = pedestrianPool[i];
    const newX = p.mesh.position.x + p.dirX * p.speed * dt;
    const newPos = new THREE.Vector3(newX, 0, p.z);
    p.body.position.set(newX, 0.65, p.z);
    p.body.velocity.set((newX - p.prevPos.x) / dt, 0, 0);
    p.mesh.position.copy(newPos);
    p.mesh.rotation.y = p.dirX > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.prevPos.copy(newPos);

    // A passerby close to the car calls out / chats — small ambience, not a rule check.
    if (chassisBody.position.distanceTo(newPos) < 6) playPedestrianChatter();

    // G57 check: player driving through the crosswalk while pedestrian actively occupies it, not yielding
    if (p.nearCrosswalk && !p.yieldChecked && Math.abs(newX) < ROAD_HALF_WIDTH) {
      const playerZ = chassisBody.position.z;
      const playerSpeedKmh = chassisBody.velocity.length() * 3.6;
      if (Math.abs(playerZ - p.z) < 3 && Math.abs(chassisBody.position.x - newX) < 4 && playerSpeedKmh > 8) {
        triggerInfraction('G57');
        p.yieldChecked = true;
      }
    }

    const crossedFully = Math.abs(newX) > (ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH - 0.3);
    const tooFar = Math.abs(p.z - chassisBody.position.z) > 250;
    if (crossedFully || tooFar) {
      scene.remove(p.mesh);
      world.removeBody(p.body);
      pedestrianPool.splice(i, 1);
    }
  }
  if (pedestrianPool.length < CONFIG.PEDESTRIAN_TARGET_COUNT && rng() < CONFIG.PEDESTRIAN_SPAWN_CHANCE_PER_SEC * dt) {
    spawnPedestrian();
  }
}
