import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config';
import { rand } from '../utils/rng';
import { scene } from '../core/scene';
import { world, propMaterial } from '../core/physics';
import { box, cyl } from '../assets/primitives';
import { buildSignPost, buildYieldPlate } from '../assets/props';
import { buildGround, buildStreet, scatterBlockBuildings, annulus, arcCurbColliders } from './streetKit';
import { resetCrosswalks, addCrosswalk, includeCandidate, flushZebras } from './crosswalks';
import type { Amount } from '../state/settings';

// "Rotondas" scenario: one central roundabout with four arms (S, E, N, W). Peru drives on the
// right, so traffic circulates counter-clockwise seen from above (north = -Z): you enter by
// turning right, yield to whoever is already circling, and leave by turning right again.
//
// Angles use the world (x, z) plane: theta = atan2(z - cz, x - cx). East is 0, south (+Z) is
// PI/2, so DECREASING theta is the counter-clockwise flow direction of the ring.

const TWO_PI = Math.PI * 2;

export const RB = {
  cx: 0, cz: 0,
  islandR: 12.5,   // raised central island (collider), curb sits on its edge
  innerR: 13,      // inner edge of the drivable ring
  outerR: 20,      // outer edge of the ring; arms attach here
  laneR: 18.25,    // centre of the outer ring lane — where entering/exiting traffic drives
  armLength: 240,  // distance from the ring's outer edge to the end of each arm
  mouth: 8,        // flared, curb-free apron between the ring and where each arm's curbs begin
};
const MOUTH_HALF = 10; // half-width of that apron where it meets the ring

// Listed in circulation order from the south arm: S -> E is the first exit (a right turn),
// N the second (straight ahead), W the third (a left turn).
export type ArmId = 'S' | 'E' | 'N' | 'W';

export interface Arm { id: ArmId; angle: number; ux: number; uz: number }

export const ARMS: Arm[] = [
  { id: 'S', angle: Math.PI / 2, ux: 0, uz: 1 },
  { id: 'E', angle: 0, ux: 1, uz: 0 },
  { id: 'N', angle: -Math.PI / 2, ux: 0, uz: -1 },
  { id: 'W', angle: Math.PI, ux: -1, uz: 0 },
];
const ARM_BY_ID = Object.fromEntries(ARMS.map(a => [a.id, a])) as Record<ArmId, Arm>;

const LANE_OFFSET = CONFIG.LANE_WIDTH / 2; // lane centre distance from an arm's axis

export function wrapAngle(a: number): number { return ((a % TWO_PI) + TWO_PI) % TWO_PI; }

// Polar position of a world point relative to the roundabout centre.
export function ringInfo(x: number, z: number): { r: number; theta: number } {
  const dx = x - RB.cx, dz = z - RB.cz;
  return { r: Math.hypot(dx, dz), theta: Math.atan2(dz, dx) };
}

// ---------------------------------------------------------------- routes

interface Pt { x: number; z: number }

function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      z: u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
    });
  }
  return pts;
}

function ringPoint(theta: number, r = RB.laneR): Pt {
  return { x: RB.cx + r * Math.cos(theta), z: RB.cz + r * Math.sin(theta) };
}
// Counter-clockwise (decreasing theta) unit tangent of the ring at `theta`.
function ringTangent(theta: number): Pt { return { x: Math.sin(theta), z: -Math.cos(theta) }; }

const ENTRY_FLARE = 0.45; // radians of ring the entry/exit curves take to merge in / peel off
export interface Route {
  id: string;
  entry: ArmId;
  exit: ArmId;
  pts: Pt[];
  cum: number[];      // arc length at each point
  length: number;
  yieldS: number;     // arc length of the yield line
  entryTheta: number;
  exitStartS: number;
  exitEndS: number;
}

const ROUTES: Record<string, Route> = {};

// A route is the polyline a car follows: straight in along the arm, a flared curve onto the
// ring, an arc around the island, a curve back out and a straight run to the end of the exit arm.
function buildRoute(entryId: ArmId, exitId: ArmId): Route {
  const en = ARM_BY_ID[entryId], ex = ARM_BY_ID[exitId];
  const far = RB.outerR + RB.armLength;
  const near = RB.outerR + 18;
  const eps = Math.asin(LANE_OFFSET / RB.laneR);
  const kLeg = 12; // Bezier handle length

  // The right-hand side of a heading (hx, hz) in the (x, z) plane is (-hz, hx).
  const inRightX = en.uz, inRightZ = -en.ux;   // driving in: heading is -u
  const outRightX = -ex.uz, outRightZ = ex.ux; // driving out: heading is +u

  const pts: Pt[] = [];
  // 1) straight approach along the incoming lane, from the far end in to `near`
  for (let d = far; d >= near; d -= 6) {
    pts.push({ x: RB.cx + en.ux * d + inRightX * LANE_OFFSET, z: RB.cz + en.uz * d + inRightZ * LANE_OFFSET });
  }
  const A = pts[pts.length - 1];

  // 2) flared entry onto the ring
  const thetaIn = en.angle - eps;
  const B = ringPoint(thetaIn - ENTRY_FLARE);
  const tB = ringTangent(thetaIn - ENTRY_FLARE);
  pts.push(...bezier(A, { x: A.x - en.ux * kLeg, z: A.z - en.uz * kLeg }, { x: B.x - tB.x * kLeg, z: B.z - tB.z * kLeg }, B, 18));

  // 3) arc around the island (counter-clockwise = decreasing theta)
  const thetaOut = ex.angle + eps;
  let sweep = wrapAngle((thetaIn - ENTRY_FLARE) - (thetaOut + ENTRY_FLARE));
  if (sweep > TWO_PI - 0.5) sweep = 0; // adjacent-arm wrap guard
  const start = thetaIn - ENTRY_FLARE;
  const arcSteps = Math.max(1, Math.ceil(sweep * RB.laneR / 1.5));
  for (let i = 1; i <= arcSteps; i++) pts.push(ringPoint(start - sweep * (i / arcSteps)));

  // 4) flared exit off the ring
  const C = ringPoint(thetaOut + ENTRY_FLARE);
  const tC = ringTangent(thetaOut + ENTRY_FLARE);
  const D = { x: RB.cx + ex.ux * near + outRightX * LANE_OFFSET, z: RB.cz + ex.uz * near + outRightZ * LANE_OFFSET };
  const exitStartIdx = pts.length - 1; // last point on the ring, where the exit curve begins
  pts.push(...bezier(C, { x: C.x + tC.x * kLeg, z: C.z + tC.z * kLeg }, { x: D.x - ex.ux * kLeg, z: D.z - ex.uz * kLeg }, D, 18));
  const exitEndIdx = pts.length - 1;

  // 5) straight exit run
  for (let d = near + 6; d <= far; d += 6) {
    pts.push({ x: RB.cx + ex.ux * d + outRightX * LANE_OFFSET, z: RB.cz + ex.uz * d + outRightZ * LANE_OFFSET });
  }

  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));

  // the yield line sits just outside the ring's outer edge on the way in
  let yieldS = cum[cum.length - 1];
  for (let i = 0; i < pts.length; i++) {
    if (ringInfo(pts[i].x, pts[i].z).r < RB.outerR + 2.5) { yieldS = cum[i]; break; }
  }

  return {
    id: `${entryId}>${exitId}`, entry: entryId, exit: exitId, pts, cum, length: cum[cum.length - 1], yieldS, entryTheta: thetaIn,
    exitStartS: cum[exitStartIdx], exitEndS: cum[exitEndIdx], // where a courteous driver's right signal is on
  };
}

export function getRoute(entryId: ArmId, exitId: ArmId): Route {
  const key = `${entryId}>${exitId}`;
  return ROUTES[key] ?? (ROUTES[key] = buildRoute(entryId, exitId));
}

// Position and unit heading at arc-length `s` along a route (clamped to its ends).
export interface RouteSample { x: number; z: number; hx: number; hz: number }

export function sampleRoute(route: Route, s: number, out: RouteSample = { x: 0, z: 0, hx: 0, hz: 0 }): RouteSample {
  const { pts, cum } = route;
  if (s <= 0) s = 0;
  if (s >= route.length) s = route.length - 1e-3;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi];
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  const hx = b.x - a.x, hz = b.z - a.z, hl = Math.hypot(hx, hz) || 1;
  out.hx = hx / hl; out.hz = hz / hl;
  return out;
}

// ---------------------------------------------------------------- geometry

function buildTree(x: number, z: number, scale: number): void {
  const g = new THREE.Group();
  const trunk = cyl(0.25 * scale, 0.32 * scale, 2.2 * scale, 0x6b4a2b, 6); trunk.position.y = 1.1 * scale;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.7 * scale, 4.2 * scale, 8), new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.9 }));
  crown.position.y = 4.0 * scale; crown.castShadow = true;
  g.add(trunk, crown);
  g.position.set(x, 0.3, z);
  scene.add(g);
}

function buildIsland(): void {
  // curb ring + grass top
  const curb = cyl(RB.islandR + 0.5, RB.islandR + 0.5, 0.3, 0xcfcac0, 40); curb.position.set(RB.cx, 0.15, RB.cz);
  const grass = cyl(RB.islandR, RB.islandR, 0.34, 0x4f7a3c, 40); grass.position.set(RB.cx, 0.17, RB.cz);
  scene.add(curb, grass);

  // central monument + trees
  const base = cyl(2.6, 3, 0.8, 0xb9b6ad, 16); base.position.set(RB.cx, 0.7, RB.cz);
  const column = cyl(0.7, 0.9, 5, 0xe6e2d6, 12); column.position.set(RB.cx, 3.5, RB.cz);
  const top = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.5, metalness: 0.4 }));
  top.position.set(RB.cx, 6.6, RB.cz); top.castShadow = true;
  scene.add(base, column, top);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TWO_PI + 0.3, r = rand(6.5, 9.5);
    buildTree(RB.cx + r * Math.cos(a), RB.cz + r * Math.sin(a), rand(0.8, 1.15));
  }

  // physical island: a convex cylinder (cannon-es cylinders are Y-aligned), tall like the curbs
  const body = new CANNON.Body({ mass: 0, material: propMaterial });
  body.addShape(new CANNON.Cylinder(RB.islandR + 0.5, RB.islandR + 0.5, 2, 28));
  body.position.set(RB.cx, 0.9, RB.cz);
  body.userData = { isPenalized: false, isStatic: true, isCurb: true };
  world.addBody(body);
}

function buildRingMarkings(): void {
  // dashed lane divider between the ring's two lanes
  const r = (RB.innerR + RB.outerR) / 2;
  const count = 44;
  const geo = new THREE.BoxGeometry(0.14, 0.02, 2.2);
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff }), count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const th = (i / count) * TWO_PI;
    dummy.position.set(RB.cx + r * Math.cos(th), 0.112, RB.cz + r * Math.sin(th));
    dummy.rotation.set(0, -th, 0);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
}

// "Ceda el paso" line (a row of dashes) across the incoming lane plus its sign.
function buildArmFurniture(arm: Arm): void {
  const rightX = arm.uz, rightZ = -arm.ux; // right-hand side of a car driving in (heading -u)
  const yieldD = RB.outerR + 3.2;
  for (let i = 0; i < 5; i++) {
    const lateral = (i + 0.5) * (CONFIG.LANE_WIDTH / 5);
    const dash = box(0.5, 0.02, 0.55, 0xffffff);
    dash.position.set(
      RB.cx + arm.ux * yieldD + rightX * lateral,
      0.113,
      RB.cz + arm.uz * yieldD + rightZ * lateral
    );
    dash.rotation.y = arm.ux === 0 ? 0 : Math.PI / 2;
    scene.add(dash);
  }

  const sign = buildSignPost([{ plate: buildYieldPlate(), y: 2.35 }], 2.7);
  sign.position.set(
    RB.cx + arm.ux * (RB.outerR + 14) + rightX * (CONFIG.LANE_WIDTH + 0.8),
    0,
    RB.cz + arm.uz * (RB.outerR + 14) + rightZ * (CONFIG.LANE_WIDTH + 0.8)
  );
  sign.rotation.y = Math.atan2(arm.ux, arm.uz);
  scene.add(sign);
}

// Paved, curb-free apron that widens each arm's mouth where it meets the ring. A car has to
// swing from the arm's lane onto the ring's tangent, and its yawed corners would otherwise
// clip the arm's (tall, solid) curbs.
function buildApron(arm: Arm): void {
  const nx = arm.uz, nz = -arm.ux; // lateral direction
  const d0 = RB.outerR - 0.8, d1 = RB.outerR + RB.mouth;
  const corner = (d: number, w: number): number[] => [RB.cx + arm.ux * d + nx * w, 0.1, RB.cz + arm.uz * d + nz * w];
  const v = [corner(d0, -MOUTH_HALF), corner(d1, -3.5), corner(d1, 3.5), corner(d0, MOUTH_HALF)].flat();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3a3f, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// Options (all optional): `cx`/`cz` re-centre the roundabout, `ground` and `buildings` switch off
// the terrain plane / filler skyline when the caller builds a bigger world around it,
// `armLengths` overrides an arm's length by id and `armCrossings` lists coordinates along an arm
// (z for N/S, x for E/W) where a cross street cuts through its curbs.
export interface RoundaboutOptions {
  cx?: number;
  cz?: number;
  ground?: boolean;
  buildings?: boolean;
  armLengths?: Partial<Record<ArmId, number>>;
  armCrossings?: Partial<Record<ArmId, number[]>>;
}

export function buildRoundabout(
  scenario: { laneCountPerSide: number; zebras: Amount },
  { cx = 0, cz = 0, ground = true, buildings = true, armLengths = {}, armCrossings = {} }: RoundaboutOptions = {},
): { x: number; y: number; z: number; rotY: number } {
  RB.cx = cx; RB.cz = cz;
  Object.keys(ROUTES).forEach(k => delete ROUTES[k]); // routes are cached relative to the centre
  const armLength = (id: ArmId): number => armLengths[id] ?? RB.armLength;

  if (ground) {
    const reach = RB.outerR + RB.armLength + 90;
    buildGround(RB.cx, RB.cz, reach * 2, reach * 2);
  }

  // ring asphalt (top face just under the arms' 0.10 so the overlapping slabs never z-fight)
  annulus(RB.cx, RB.cz, RB.innerR, RB.outerR, -0.05, 0.097, 0x3a3a3f);
  buildRingMarkings();
  buildIsland();

  // arms: curbs/markings begin past the flared mouth, asphalt slabs pad back into the ring
  const o = RB.outerR, m = RB.mouth, lanes = scenario.laneCountPerSide;
  const cross = (id: ArmId): number[] => armCrossings[id] ?? [];
  buildStreet('z', RB.cx, RB.cz + o + m, RB.cz + o + armLength('S'), lanes, cross('S'), { padLo: m + 1.5 }); // S
  buildStreet('z', RB.cx, RB.cz - o - armLength('N'), RB.cz - o - m, lanes, cross('N'), { padHi: m + 1.5 }); // N
  buildStreet('x', RB.cz, RB.cx + o + m, RB.cx + o + armLength('E'), lanes, cross('E'), { padLo: m + 1.5 }); // E
  buildStreet('x', RB.cz, RB.cx - o - armLength('W'), RB.cx - o - m, lanes, cross('W'), { padHi: m + 1.5 }); // W
  ARMS.forEach(buildApron);
  ARMS.forEach(buildArmFurniture);

  // outer sidewalk between arms; a curb collider still marks the edge for the ticket in
  // systems/rules.ts, but the car simply drives over it rather than being walled in
  const gap = Math.asin(MOUTH_HALF / (RB.outerR + CONFIG.SIDEWALK_WIDTH / 2));
  const sectors = [[-Math.PI, -Math.PI / 2], [-Math.PI / 2, 0], [0, Math.PI / 2], [Math.PI / 2, Math.PI]]; // between neighbouring arms
  sectors.forEach(([a0, a1]) => {
    annulus(RB.cx, RB.cz, RB.outerR, RB.outerR + CONFIG.SIDEWALK_WIDTH, -0.04, 0.14, 0xb9b6ad, a0 + gap, a1 - gap);
    arcCurbColliders(RB.cx, RB.cz, RB.outerR + CONFIG.SIDEWALK_WIDTH / 2, CONFIG.SIDEWALK_WIDTH, a0 + gap, a1 - gap);
  });

  // pedestrian crossings on each arm, near the ring and farther out
  resetCrosswalks();
  const roadHalf = CONFIG.LANE_WIDTH * lanes, walkHalf = roadHalf + CONFIG.SIDEWALK_WIDTH - 0.3;
  ARMS.forEach((arm, ai) => [35, 95].forEach((d, di) => {
    if (!includeCandidate(100 + ai * 2 + di, scenario.zebras)) return;
    addCrosswalk({
      cx: RB.cx + arm.ux * d, cz: RB.cz + arm.uz * d, axis: arm.ux === 0 ? 'x' : 'z', roadHalf, walkHalf, sign: true,
    });
  }));
  flushZebras();

  // filler buildings in the four quadrants between the arms
  if (buildings) {
    const q = RB.outerR + RB.armLength / 2 + 10, size = RB.armLength + 20;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
      scatterBlockBuildings(RB.cx + sx * q, RB.cz + sz * q, size, CONFIG.LANE_WIDTH + CONFIG.SIDEWALK_WIDTH + 12, [10, 16]);
    });
  }

  // player starts far out on the south arm, in the incoming lane, facing the ring
  return { x: RB.cx + LANE_OFFSET, y: 1.2, z: RB.cz + RB.outerR + RB.armLength - 30, rotY: 0 };
}
