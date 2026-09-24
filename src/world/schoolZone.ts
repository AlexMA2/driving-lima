import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildSchoolPlate, buildSpeedLimitPlate, buildSignPost } from '../assets/props';
import { scene } from '../core/scene';
import { PLAYER_LANES, ONCOMING_LANES, ROAD_HALF_WIDTH } from './road';

export const SCHOOL_ZONE = { start: -1000, end: -1180 };
// The zebras inside the zone (registered in world/lineCrosswalks.ts): where the schoolchildren cross.
export const SCHOOL_CROSSINGS = [-1045, -1135];

// The zone is announced the way Peruvian roads do it, with no on-screen help: the "zona escolar" warning pentagon
// above a 30 km/h limit sign before it, the word "ZONA ESCOLAR" painted in each lane at its mouth, and the ordinary
// limit again once it ends. Inside it, the two school crossings get their own warning signs (world/crosswalks.ts).
// Signs stand on the right kerb of each direction of travel.
const SIGN_OFFSET = 0.6; // m from the road's edge
const APPROACH = 30;     // m before the zone that its signs stand

export function buildSchoolZone(urbanLimit: number): void {
  const kerb = ROAD_HALF_WIDTH + SIGN_OFFSET;

  // Own lanes drive towards -Z and see signs that face +Z; oncoming traffic is the mirror image.
  const place = (post: THREE.Object3D, x: number, z: number, towardsOncoming: boolean): void => {
    post.position.set(x, 0, z);
    if (towardsOncoming) post.rotation.y = Math.PI;
    scene.add(post);
  };
  const entry = (): THREE.Group => buildSignPost([
    { plate: buildSchoolPlate(), y: 2.8 },
    { plate: buildSpeedLimitPlate(CONFIG.SCHOOL_SPEED_LIMIT), y: 1.9 },
  ]);
  const exit = (): THREE.Group => buildSignPost([{ plate: buildSpeedLimitPlate(urbanLimit), y: 2.2 }], 2.7);

  place(entry(), kerb, SCHOOL_ZONE.start + APPROACH, false);
  place(exit(), kerb, SCHOOL_ZONE.end - 4, false);
  place(entry(), -kerb, SCHOOL_ZONE.end - APPROACH, true);
  place(exit(), -kerb, SCHOOL_ZONE.start + 4, true);

  paintLegend();
}

// "ZONA ESCOLAR" painted across each lane, stretched along the road so it reads from a moving car. The first word
// is the one nearest the driver.
function paintLegend(): void {
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 512;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#f2f2f2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 60px Arial';
  const size = Math.floor(60 * 224 / ctx.measureText('ESCOLAR').width);
  ctx.font = `bold ${size}px Arial`;
  [['ESCOLAR', 150], ['ZONA', 370]].forEach(([text, y]) => {
    ctx.save(); ctx.translate(128, y as number); ctx.scale(1, 2.6);
    ctx.fillText(text as string, 0, 0);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const geo = new THREE.PlaneGeometry(2.4, 6);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  // y=0.113 sits just above the asphalt's actual top face (y=0.10, see world/road.ts) and the lane markings
  const lay = (x: number, z: number, oncoming: boolean): void => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.set(-Math.PI / 2, 0, oncoming ? Math.PI : 0);
    mesh.position.set(x, 0.113, z);
    scene.add(mesh);
  };
  PLAYER_LANES.forEach(x => lay(x, SCHOOL_ZONE.start - 6, false));
  ONCOMING_LANES.forEach(x => lay(x, SCHOOL_ZONE.end + 6, true));
}

export function inSchoolZone(z: number): boolean {
  return z <= SCHOOL_ZONE.start && z >= SCHOOL_ZONE.end;
}
