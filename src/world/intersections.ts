import * as THREE from 'three';
import { CONFIG } from '../config';
import { rand } from '../utils/rng';
import { scene } from '../core/scene';
import { box } from '../assets/primitives';
import { buildTrafficLightPole, type TrafficLightLamps } from '../assets/props';
import { ROAD_HALF_WIDTH } from './road';

export type LightState = 'GREEN' | 'YELLOW' | 'RED';

export interface Intersection {
  z: number;
  state: LightState;
  timer: number;
  triggeredRedCross: boolean;
  index: number;
  lights?: TrafficLightLamps;
  crosswalkZ: number;
}

export const INTERSECTIONS: Intersection[] = [-320, -780, -1300, -1850, -2420].map((z, i) => ({
  z, state: 'GREEN', timer: rand(0, 5), triggeredRedCross: false, index: i, crosswalkZ: z + 4.5,
}));

const LIGHT_CYCLE: Record<LightState, number> = { GREEN: 7, YELLOW: 2, RED: 7 };

export function buildIntersections(): void {
  INTERSECTIONS.forEach(inter => {
    // cross street strip
    const cross = box(10, 0.09, ROAD_HALF_WIDTH * 2 + CONFIG.SIDEWALK_WIDTH * 2 + 4, 0x3a3a3f);
    cross.position.set(0, -0.045, inter.z);
    scene.add(cross);

    // stop line for player's lanes (approaching from +Z toward -Z, own lanes on +x)
    // y sits just above the asphalt's actual top face (y=0.10, see world/road.ts) so it
    // doesn't get buried inside the opaque road mesh.
    const stopLine = box(ROAD_HALF_WIDTH, 0.02, 0.35, 0xffffff);
    stopLine.position.set(ROAD_HALF_WIDTH / 2, 0.115, inter.z + 6);
    scene.add(stopLine);

    const pole = buildTrafficLightPole(true);
    pole.position.set(ROAD_HALF_WIDTH + 0.3, 0, inter.z + 6.5);
    pole.rotation.y = Math.PI;
    scene.add(pole);
    inter.lights = pole.userData.lights;

    // crosswalk stripes
    const crosswalkGroup = new THREE.Group();
    for (let i = -ROAD_HALF_WIDTH; i < ROAD_HALF_WIDTH; i += 0.9) {
      const stripe = box(0.5, 0.015, 1.6, 0xffffff);
      stripe.position.set(i + 0.25, 0.12, inter.z + 4.5);
      crosswalkGroup.add(stripe);
    }
    scene.add(crosswalkGroup);
  });
}

export function updateTrafficLight(inter: Intersection, dt: number): void {
  inter.timer += dt;
  const dur = LIGHT_CYCLE[inter.state];
  if (inter.timer >= dur) {
    inter.timer = 0;
    inter.state = inter.state === 'GREEN' ? 'YELLOW' : inter.state === 'YELLOW' ? 'RED' : 'GREEN';
    inter.triggeredRedCross = false;
  }
  const L = inter.lights;
  if (!L) return;
  L.red.material.emissive.set(inter.state === 'RED' ? 0xff0000 : 0x000000);
  L.red.material.color.set(inter.state === 'RED' ? 0xff2222 : 0x550000);
  L.yellow.material.emissive.set(inter.state === 'YELLOW' ? 0xffaa00 : 0x000000);
  L.yellow.material.color.set(inter.state === 'YELLOW' ? 0xffcc33 : 0x554400);
  L.green.material.emissive.set(inter.state === 'GREEN' ? 0x00ff00 : 0x000000);
  L.green.material.color.set(inter.state === 'GREEN' ? 0x33ff33 : 0x004d00);
}
