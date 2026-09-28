import * as CANNON from 'cannon-es';
import { scene } from '../core/scene';
import { world, propMaterial } from '../core/physics';
import { buildSpeedBump, buildSign } from '../assets/props';
import { ROAD_HALF_WIDTH } from './road';

// "Rompemuelles" — painted humps across the road (assets/props.ts). The physics body itself gives the RaycastVehicle a real bounce;
// `triggered` is used separately by systems/rules.ts to apply the over-speed penalty once per pass.
// Widths are filled in by buildSpeedBumps(), not here: this array is built once at module-import
// time, before any scenario has picked a lane count, so a width baked in at this point would be
// frozen at whatever ROAD_HALF_WIDTH happened to default to (missing the extra lane(s) on wider
// roads like "Autopista Densa" and leaving the bump short of the road's outer edge).
export const SPEED_BUMPS = [-560, -960, -1480, -2050, -2680].map(z => ({
  z, width: 0, triggered: false,
}));

export function buildSpeedBumps(): void {
  SPEED_BUMPS.forEach(bump => {
    bump.width = ROAD_HALF_WIDTH * 2 - 0.4;
    const mesh = buildSpeedBump(bump.width);
    mesh.position.set(0, 0, bump.z);
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 0, material: propMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(bump.width / 2, 0.09, 0.35)));
    body.position.set(0, 0.05, bump.z);
    body.userData = { isPenalized: false };
    world.addBody(body);

    const sign = buildSign('DESPACIO\nROMPEMUELAS', 0xffcc00, 'rect');
    sign.position.set(ROAD_HALF_WIDTH + 0.6, 0, bump.z + 14);
    scene.add(sign);
  });
}
