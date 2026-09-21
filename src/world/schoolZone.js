import { box } from '../assets/primitives.js';
import { buildSign } from '../assets/props.js';
import { scene } from '../core/scene.js';
import { ROAD_HALF_WIDTH } from './road.js';

export const SCHOOL_ZONE = { start: -1000, end: -1180 };

export function buildSchoolZone() {
  const tint = box(ROAD_HALF_WIDTH * 2, 0.02, SCHOOL_ZONE.start - SCHOOL_ZONE.end, 0x4488ff, { transparent: true, opacity: 0.12 });
  tint.position.set(0, 0.02, (SCHOOL_ZONE.start + SCHOOL_ZONE.end) / 2);
  scene.add(tint);

  const signStart = buildSign('ZONA ESCOLAR\nMAX 30 KM/H', 0xffffff, 'rect');
  signStart.position.set(ROAD_HALF_WIDTH + 0.6, 0, SCHOOL_ZONE.start + 8);
  scene.add(signStart);

  const signEnd = buildSign('FIN ZONA\nESCOLAR', 0xffffff, 'rect');
  signEnd.position.set(ROAD_HALF_WIDTH + 0.6, 0, SCHOOL_ZONE.end - 8);
  signEnd.rotation.y = Math.PI;
  scene.add(signEnd);
}

export function inSchoolZone(z) {
  return z <= SCHOOL_ZONE.start && z >= SCHOOL_ZONE.end;
}
