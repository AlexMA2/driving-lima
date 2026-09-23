import * as CANNON from 'cannon-es';
import { rand, choice } from '../utils/rng.js';
import { scene } from '../core/scene.js';
import { world, propMaterial } from '../core/physics.js';
import { buildSedan, buildCombi, buildMototaxi } from '../assets/vehicles.js';

// Shared mesh + kinematic-body construction for AI traffic, so every scenario's AI uses the
// same vehicle sizes, colours and collision behaviour (bodies flagged `isPenalized` so hitting
// one costs the player a fine, see systems/rules.js).

export const AI_TYPES = ['car', 'car', 'combi', 'mototaxi', 'mototaxi'];
export const CAR_COLORS = [0xcc2b2b, 0x2e7d32, 0x455a64, 0xf9a825, 0x6a1b9a];

// Speed ranges are m/s "cruise" speeds; scenarios that want a different pace scale them.
const SPECS = {
  combi: { half: [1.05, 0.85, 2.8], speed: [6, 10] },
  mototaxi: { half: [0.65, 0.6, 1.1], speed: [5, 8] },
  car: { half: [0.95, 0.55, 2.2], speed: [8, 13] },
};

// Builds the mesh and a kinematic collision body for a vehicle `type`. Neither is placed yet.
export function createTrafficVehicle(type) {
  const spec = SPECS[type];
  let mesh;
  if (type === 'combi') mesh = buildCombi(0x2266aa);
  else if (type === 'mototaxi') mesh = buildMototaxi(choice([0xffcc00, 0x43a047, 0x1e88e5]));
  else mesh = buildSedan(choice(CAR_COLORS));

  const half = new CANNON.Vec3(...spec.half);
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: propMaterial });
  body.addShape(new CANNON.Box(half));
  body.userData = { isPenalized: true, type: 'ai-' + type };

  scene.add(mesh);
  world.addBody(body);
  return { type, mesh, body, half, cruiseSpeed: rand(spec.speed[0], spec.speed[1]) };
}

// Moves a vehicle to (x, z) facing `heading` (unit vector in the x/z plane; the models point
// toward -Z at rotation 0) and gives its kinematic body the matching velocity.
export function placeTrafficVehicle(v, x, z, hx, hz, speed = 0) {
  const rotY = Math.atan2(-hx, -hz);
  v.mesh.position.set(x, 0, z);
  v.mesh.rotation.y = rotY;
  v.body.position.set(x, v.half.y, z);
  v.body.quaternion.setFromEuler(0, rotY, 0);
  v.body.velocity.set(hx * speed, 0, hz * speed);
}

export function removeTrafficVehicle(v) {
  scene.remove(v.mesh);
  world.removeBody(v.body);
}

export function pickTrafficType() {
  return choice(AI_TYPES);
}
