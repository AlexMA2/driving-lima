import * as THREE from 'three';
import { CONFIG } from '../config';
import { rand } from '../utils/rng';
import { scene } from '../core/scene';
import { box } from '../assets/primitives';
import { ROAD_HALF_WIDTH } from './road';
import { addTrafficLight, resetTrafficLights, type TrafficLight } from './trafficLights';

export interface Intersection {
  z: number;
  index: number;
  light?: TrafficLight;
  crosswalkZ: number;
}

export const INTERSECTIONS: Intersection[] = [-320, -780, -1300, -1850, -2420].map((z, i) => ({
  z, index: i, crosswalkZ: z + 4.5,
}));

export function buildIntersections(): void {
  resetTrafficLights();
  INTERSECTIONS.forEach(inter => {
    // cross street strip
    const cross = box(10, 0.09, ROAD_HALF_WIDTH * 2 + CONFIG.SIDEWALK_WIDTH * 2 + 4, 0x3a3a3f);
    cross.position.set(0, -0.045, inter.z);
    scene.add(cross);

    // stop line for player's lanes (approaching from +Z toward -Z, own lanes on +x)
    // y sits just above the asphalt's actual top face (y=0.10, see world/road.ts) so it
    // doesn't get buried inside the opaque road mesh.
    const stopZ = inter.z + 6;
    const stopLine = box(ROAD_HALF_WIDTH, 0.02, 0.35, 0xffffff);
    stopLine.position.set(ROAD_HALF_WIDTH / 2, 0.115, stopZ);
    scene.add(stopLine);

    // green 7, yellow 2, red 7 (the cross street's turn), each light starting at a random point
    inter.light = addTrafficLight({
      heading: 'N', stop: { x: ROAD_HALF_WIDTH / 2, z: stopZ }, halfWidth: ROAD_HALF_WIDTH / 2,
      pole: { x: ROAD_HALF_WIDTH + 0.3, z: stopZ + 0.5 },
      cycle: { period: 16, start: -rand(0, 16), green: 7, yellow: 2 },
    });

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
