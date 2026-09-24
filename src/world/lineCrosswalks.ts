import { CONFIG } from '../config';
import { ROAD_HALF_WIDTH } from './road';
import { INTERSECTIONS } from './intersections';
import { SPEED_BUMPS } from './speedBumps';
import { SCHOOL_ZONE } from './schoolZone';
import type { Amount } from '../state/settings';
import { resetCrosswalks, addCrosswalk, includeCandidate, flushZebras } from './crosswalks';

const CANDIDATE_SPACING = 150; // a possible mid-block zebra every 150 m along the avenue
const PARE_SIGN_Z = -2050;     // decorative stop sign (world/decorations.ts)

// Registers the avenue's pedestrian crossings: the painted ones at each intersection (always)
// plus mid-block zebras at the density the "zebras" setting asks for. Runs after the intersections,
// speed bumps and school zone exist so it can keep clear of them.
export function buildLineCrosswalks(level: Amount): void {
  resetCrosswalks();
  const roadHalf = ROAD_HALF_WIDTH;
  const walkHalf = roadHalf + CONFIG.SIDEWALK_WIDTH - 0.3;

  INTERSECTIONS.forEach(inter => {
    addCrosswalk({ cx: 0, cz: inter.crosswalkZ, axis: 'x', roadHalf, walkHalf, build: false });
  });

  const clear = (z: number): boolean =>
    INTERSECTIONS.every(i => Math.abs(z - i.z) > 45)
    && SPEED_BUMPS.every(b => Math.abs(z - b.z) > 30)
    && Math.abs(z - SCHOOL_ZONE.start) > 25 && Math.abs(z - SCHOOL_ZONE.end) > 25
    && Math.abs(z - PARE_SIGN_Z) > 20;

  for (let k = 0, z = -180; z > -2850; k++, z -= CANDIDATE_SPACING) {
    if (clear(z) && includeCandidate(k, level)) addCrosswalk({ cx: 0, cz: z, axis: 'x', roadHalf, walkHalf, sign: true });
  }
  flushZebras();
}
