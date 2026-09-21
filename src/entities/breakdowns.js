import * as CANNON from 'cannon-es';
import { rand, choice } from '../utils/rng.js';
import { scene } from '../core/scene.js';
import { world, propMaterial } from '../core/physics.js';
import { buildSedan } from '../assets/vehicles.js';
import { buildCone } from '../assets/props.js';
import { LANE_X, laneDir } from '../world/road.js';

// "Carro malogrado" scenario: fixed stalled-vehicle spots with hazard lights + cone markers,
// forcing the player to evaluate oncoming traffic and change lanes.
const BREAKDOWN_POSITIONS = [-460, -1620, -2230];

export const breakdownHazards = [];

export function buildBreakdowns() {
  BREAKDOWN_POSITIONS.forEach(z => {
    const lane = choice([LANE_X[0], LANE_X[1]]);
    const mesh = buildSedan(0x6b6b6b);
    mesh.position.set(lane, 0, z);
    mesh.rotation.y = laneDir(lane) < 0 ? 0 : Math.PI;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 0, material: propMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.95, 0.55, 2.2)));
    body.position.set(lane, 0.55, z);
    body.userData = { isPenalized: true, type: 'breakdown' };
    world.addBody(body);

    // Makeshift warning markers (cones) placed before the vehicle, in the approach direction
    const approachSign = laneDir(lane) < 0 ? 1 : -1;
    for (let i = 1; i <= 3; i++) {
      const cone = buildCone();
      cone.position.set(lane + rand(-0.4, 0.4), 0, z + approachSign * i * 3.2);
      scene.add(cone);
    }

    breakdownHazards.push(mesh);
  });
}

export function updateBreakdownHazards() {
  const blinkOn = Math.floor(performance.now() / 300) % 2 === 0;
  breakdownHazards.forEach(mesh => {
    [...mesh.userData.indicators.left, ...mesh.userData.indicators.right].forEach(m => {
      m.material.emissiveIntensity = blinkOn ? 1 : 0;
    });
  });
}
