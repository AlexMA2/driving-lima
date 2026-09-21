import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { world, propMaterial } from '../core/physics.js';
import { buildSpeedBump, buildSign } from '../assets/props.js';
import { ROAD_HALF_WIDTH } from './road.js';

// Unmarked "rompemuelas" — the physics body itself gives the RaycastVehicle a real bounce;
// `triggered` is used separately by systems/rules.js to apply the over-speed penalty once per pass.
export const SPEED_BUMPS = [-560, -960, -1480, -2050, -2680].map(z => ({
  z, width: ROAD_HALF_WIDTH * 2 - 0.4, triggered: false,
}));

export function buildSpeedBumps() {
  SPEED_BUMPS.forEach(bump => {
    const mesh = buildSpeedBump(bump.width);
    mesh.position.set(0, 0, bump.z);
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 0, material: propMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(bump.width / 2, 0.09, 0.35)));
    body.position.set(0, 0.05, bump.z);
    body.userData = { isPenalized: false };
    world.addBody(body);

    const sign = buildSign('DESPACIO\nROMPEMUELAS', 0xffcc00, 'rect');
    sign.position.set(-ROAD_HALF_WIDTH - 0.6, 0, bump.z + 14);
    scene.add(sign);
  });
}
