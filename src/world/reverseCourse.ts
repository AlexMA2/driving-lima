import { scene } from '../core/scene';
import { box } from '../assets/primitives';
import { buildCone } from '../assets/props';
import { buildGround, barrier } from './streetKit';
import { setLaneLayout } from './road';
import type { Spawn } from '../entities/player';

// The reversing exercise: an open paved lot (cones mark the lane, same as a real driving
// school's practice pad — there's no kerb to feel your way with, only the cones). The player
// starts facing AWAY from the course (south) at p0, so the only way to make progress is to
// reverse: the straight leg p0->p1 first, then the bent leg p1->p2, ending in a marked box.
export interface Pt { x: number; z: number }

export const COURSE = {
  laneHalf: 1.7,
  p0: { x: 0, z: 24 } as Pt,
  p1: { x: 0, z: -18 } as Pt,
  p2: { x: 17, z: -33 } as Pt,
  finishHalf: 2.3,
};

const LINE_Y = 0.105;

function placeCones(a: Pt, b: Pt, half: number): void {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const nx = -uz, nz = ux;
  const step = 3.2;
  const count = Math.max(1, Math.round(len / step));
  for (let i = 0; i <= count; i++) {
    const t = (i / count) * len;
    const cx = a.x + ux * t, cz = a.z + uz * t;
    [-1, 1].forEach(side => {
      const cone = buildCone();
      cone.position.set(cx + nx * half * side, 0, cz + nz * half * side);
      scene.add(cone);
    });
  }
}

export function buildReverseCourse(): Spawn {
  setLaneLayout(1);
  const { p0, p1, p2, laneHalf, finishHalf } = COURSE;

  const minX = Math.min(p0.x, p1.x, p2.x) - 12, maxX = Math.max(p0.x, p1.x, p2.x) + 12;
  const minZ = Math.min(p0.z, p1.z, p2.z) - 12, maxZ = Math.max(p0.z, p1.z, p2.z) + 12;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  buildGround(cx, cz, maxX - minX + 60, maxZ - minZ + 60);
  const pad = box(maxX - minX, 0.3, maxZ - minZ, 0x3a3a3f, { roughness: 1 });
  pad.position.set(cx, -0.05, cz);
  pad.receiveShadow = true;
  scene.add(pad);

  // a starting line under the player and a green finish box at the end
  const startLine = box(laneHalf * 2 + 0.6, 0.02, 0.14, 0xffffff);
  startLine.position.set(p0.x, LINE_Y, p0.z - 3.5);
  scene.add(startLine);
  const finish = box(finishHalf * 2, 0.02, finishHalf * 2, 0x2ecc71, { transparent: true, opacity: 0.28 });
  finish.position.set(p2.x, LINE_Y, p2.z);
  finish.castShadow = false;
  scene.add(finish);

  placeCones(p0, p1, laneHalf);
  placeCones(p1, p2, laneHalf);

  // fence the practice pad in: it's a closed lot, not a through street
  barrier(cx, minZ, maxX - minX, 2);
  barrier(cx, maxZ, maxX - minX, 2);
  barrier(minX, cz, 2, maxZ - minZ);
  barrier(maxX, cz, 2, maxZ - minZ);

  return { x: p0.x, y: 1.2, z: p0.z, rotY: Math.PI }; // nose facing south, away from the course
}
