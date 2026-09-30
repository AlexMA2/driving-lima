import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { box } from '../assets/primitives';
import { scene } from '../core/scene';
import { world, propMaterial } from '../core/physics';
import { CONFIG } from '../config';
import {
  buildStopSign, buildPedestrianWarningPlate, buildUTurnPermittedPlate, buildSignPost, buildSpeedLimitPlate, buildSign,
  buildLeftTurnOnlyPlate, buildRightTurnOnlyPlate, buildRightTurnOrContinuePlate, buildRoundaboutAheadPlate, buildTwoWayTrafficPlate,
  buildSpeedBumpAheadPlate, buildAcuteMergeRightPlate, buildMandatoryDirectionPlate, buildYieldPlate, buildSpeedBump,
} from '../assets/props';
import { buildGround, scatterBlockBuildings, annulus } from './streetKit';
import { setLaneLayout } from './road';
import { buildOvalo, RB } from './roundabout';
import { addTrafficLight, resetTrafficLights, phaseCycles, HEADING_DIR, type Heading, type LightCycle } from './trafficLights';
import { addCrosswalk, flushZebras, resetCrosswalks } from './crosswalks';
import { paintLetter, targetZone, targetZoneAngled } from './parkingLot';
import type { Pt } from './curves';
import type { Spawn } from '../entities/player';

// The "Examen Oficial MTC" circuit, modelled on the César Vallejo driving-school yard
// (docs/track-mapping/reference/). The reference is a guide to the road NETWORK — which roads
// exist and how they connect — not a shape to trace: every road here is a straight, two-lane,
// two-way road of constant width, joined at T-junctions, two rounded corners and the óvalo.
//
//                 ┌──────── top road (Zona Habilidad) ─────────╮ trocha
//          (óvalo)┤              │                               │
//              │  │   west       │   north island (parallel bays │ east road
//         west │  │   island   inner  1→7 along its south edge)  │ (two-way)
//         road │  │            road ├──────── parking aisle ───────┤
//              │  │              │   south island (diagonal bays │
//              ╰──┴── bottom road ┴──────┬──── road 3 ─(bump)────┤
//                                     salida                  entrada
//                               (one-way out)          (one-way in, two lanes:
//                                                        left turns left, right goes on)
//
// Two routes run through it (docs/track-mapping: Ruta A / Ruta B, see world/examRoutes.ts), and
// every lane carries painted arrows for the way it may be driven.
//
// World axes: x east, z south (north is -Z), right-hand traffic, same as every other course.

// ---- layout ---------------------------------------------------------------------------------
const LANE = CONFIG.LANE_WIDTH;   // 3.5
const OWN = LANE / 2;             // a lane's centre, measured from the road's centreline
const HALF = LANE + 0.5;          // road half-width: one lane each way plus a 0.5 shoulder
const RC = 12;                    // centreline radius of the two rounded corners

const XW = 0, XI = 42, XS = 95, XE = 150;   // west road, inner road, salida chute, east road (x)
const ZT = 0, ZP = 26, ZB = 52, ZEND = 76;  // top road, parking aisle, bottom road, gates (z)

interface Road { id: string; axis: 'x' | 'z'; fixed: number; lo: number; hi: number }
const ROADS: Road[] = [
  { id: 'top', axis: 'x', fixed: ZT, lo: XW, hi: XE - RC },
  { id: 'east', axis: 'z', fixed: XE, lo: ZT + RC, hi: ZEND },
  { id: 'west', axis: 'z', fixed: XW, lo: ZT, hi: ZB - RC },
  { id: 'bottom', axis: 'x', fixed: ZB, lo: XW + RC, hi: XE },
  { id: 'inner', axis: 'z', fixed: XI, lo: ZT, hi: ZB },
  { id: 'aisle', axis: 'x', fixed: ZP, lo: XI, hi: XE },
  { id: 'salida', axis: 'z', fixed: XS, lo: ZB, hi: ZEND },
];

// Rounded corners: quarter rings of centreline radius RC, angles in the usual world atan2(z, x)
// sense (t0 < t1). NE turns the top road into the east road, SW the west road into the bottom one.
interface Bend { id: string; cx: number; cz: number; t0: number; t1: number }
const BENDS: Bend[] = [
  { id: 'ne', cx: XE - RC, cz: ZT + RC, t0: -Math.PI / 2, t1: 0 },
  { id: 'sw', cx: XW + RC, cz: ZB - RC, t0: Math.PI / 2, t1: Math.PI },
];

// Parking, both rows cut into the islands either side of the aisle (reference/parking_zoom.png):
// parallel bays 1→7 (west→east) along the NORTH kerb, where westbound traffic drives; diagonal
// bays 7→1 (west→east) along the SOUTH kerb, raked 45° so eastbound traffic noses straight in.
const PAR = { x0: 75, pitch: 6, count: 7, depth: 2.8 };
const PAR_KERB_Z = ZP - HALF - PAR.depth;
const DIAG = { x0: 72, pitch: 3.8, count: 7, depth: 6 };
const DIAG_Z0 = ZP + HALF;                       // aisle edge = the bays' open end
const DIAG_YAW = -3 * Math.PI / 4;               // a car nosed into a bay faces south-east
const DIAG_DIR = { x: Math.SQRT1_2, z: Math.SQRT1_2 };

// Extra paved areas that aren't roads: the two parking rows. Each overlaps its aisle by 1 so the
// shared edge's lines clip away cleanly. The aisle meets the east road at a plain T-junction.
interface Pad { id: string; x0: number; x1: number; z0: number; z1: number }
const PADS: Pad[] = [
  { id: 'parallel', x0: PAR.x0, x1: PAR.x0 + PAR.count * PAR.pitch, z0: PAR_KERB_Z, z1: ZP - HALF + 1 },
  { id: 'diagonal', x0: DIAG.x0, x1: DIAG.x0 + DIAG.count * DIAG.pitch + DIAG.depth, z0: DIAG_Z0 - 1, z1: DIAG_Z0 + DIAG.depth },
];

// The parallel row's west end is a tapered kerb, not a square corner, so a car pulling out of bay 1
// has somewhere to go: the slanted edge runs from the row's kerb out to the aisle's edge.
const PAR_TAPER_EDGE: [Pt, Pt] = [{ x: PAR.x0, z: ZP - HALF - PAR.depth }, { x: PAR.x0 - 7, z: ZP - HALF }];
const PAR_TAPER: Pt[] = [PAR_TAPER_EDGE[0], { x: PAR.x0 + 0.6, z: PAR_TAPER_EDGE[0].z }, { x: PAR.x0 + 0.6, z: ZP - HALF + 0.6 }, { x: PAR_TAPER_EDGE[1].x, z: ZP - HALF + 0.6 }];

// The two gate chutes are one-way: ENTRADA (the east road south of road 3) northbound, SALIDA southbound.
const CHUTE_Z0 = ZB + HALF;
const ZEBRA_X = 68;
const BUMP_X = 125;

// Semáforos (reference/signs_in_map.png): the two T-junctions on the inner road — where it meets the
// parking aisle and road 3 — run two phases each (the inner road's through traffic, then the road
// joining it), and a pedestrian light guards both approaches of each zebra. Every head is one
// world/trafficLights.ts light, with its stop line painted by buildRoads().
const J1 = phaseCycles(2, 9, 3, 0), J2 = phaseCycles(2, 9, 3, 6);
const zebraCycle = (start: number): LightCycle => ({ period: 24, start, green: 15, yellow: 3 });
interface SemaphoreSpec { heading: Heading; stop: Pt; halfWidth: number; cycle: LightCycle }
const SEMAPHORES: SemaphoreSpec[] = [
  { heading: 'N', stop: { x: XI + OWN, z: ZP + HALF + 5 }, halfWidth: OWN, cycle: J1[0] },
  { heading: 'S', stop: { x: XI - OWN, z: ZP - HALF - 5 }, halfWidth: OWN, cycle: J1[0] },
  { heading: 'W', stop: { x: XI + HALF + 5, z: ZP - OWN }, halfWidth: OWN, cycle: J1[1] },
  { heading: 'E', stop: { x: XI - HALF - 5, z: ZB + OWN }, halfWidth: OWN, cycle: J2[0] },
  { heading: 'W', stop: { x: XI + HALF + 5, z: ZB - OWN }, halfWidth: OWN, cycle: J2[0] },
  { heading: 'S', stop: { x: XI - OWN, z: ZB - HALF - 5 }, halfWidth: OWN, cycle: J2[1] },
  { heading: 'E', stop: { x: ZEBRA_X - 3, z: ZB + OWN }, halfWidth: OWN, cycle: zebraCycle(3) },
  { heading: 'W', stop: { x: ZEBRA_X + 3, z: ZB - OWN }, halfWidth: OWN, cycle: zebraCycle(3) },
  { heading: 'E', stop: { x: ZEBRA_X - 3, z: ZT + OWN }, halfWidth: OWN, cycle: zebraCycle(14) },
  { heading: 'W', stop: { x: ZEBRA_X + 3, z: ZT - OWN }, halfWidth: OWN, cycle: zebraCycle(14) },
];

// centre of diagonal bay k (0 = westmost, labelled 7: bays are numbered 7→1 west→east) and of
// parallel bay n (1 = westmost). Which bays are taken, and which one the player is sent to, is
// decided while the exam runs (entities/examTraffic.ts): every car in a bay is another candidate.
const diagBayCx = (k: number): number => DIAG.x0 + (k + 0.5) * DIAG.pitch + DIAG.depth / 2;
const parBayCx = (n: number): number => PAR.x0 + (n - 0.5) * PAR.pitch;
const diagCz = DIAG_Z0 + DIAG.depth / 2;

export const COURSE = {
  // lane centrelines the grading and autopilot drive along
  lanes: {
    eastNB: XE + OWN, eastSB: XE - OWN,
    topWB: ZT - OWN, topEB: ZT + OWN,
    westSB: XW - OWN, westNB: XW + OWN,
    bottomEB: ZB + OWN, bottomWB: ZB - OWN,
    innerNB: XI + OWN, innerSB: XI - OWN,
    aisleEB: ZP + OWN, aisleWB: ZP - OWN,
    salidaSB: XS - OWN,
  },
  bends: { ne: { cx: XE - RC, cz: ZT + RC, r: RC }, sw: { cx: XW + RC, cz: ZB - RC, r: RC } },
  // the ENTRADA chute's two northbound lanes: Ruta A starts in the right one (straight on), Ruta B
  // in the left one (left onto road 3)
  entrance: { A: { x: XE + OWN, z: ZEND - 6 }, B: { x: XE - OWN, z: ZEND - 6 } },
  stopLineZ: ZB + HALF + 1.5,
  speedGateX: 95,
  ovalo: { cx: XW, cz: ZT },
  roads: { XW, XI, XS, XE, ZT, ZP, ZB, ZEND, HALF, RC },
  bump: { x: BUMP_X, z: ZB },
  parallel: {
    kerbZ: PAR_KERB_Z, pitch: PAR.pitch, count: PAR.count, bayCx: parBayCx,
    bay: (n: number) => ({ frontX: PAR.x0 + (n - 1) * PAR.pitch, rearX: PAR.x0 + n * PAR.pitch }),
    x0: PAR.x0, x1: PAR.x0 + PAR.count * PAR.pitch,
  },
  diagonal: {
    cz: diagCz, yaw: DIAG_YAW, pitch: DIAG.pitch, bayCx: diagBayCx, count: DIAG.count,
    label: (k: number) => DIAG.count - k,
    x0: DIAG.x0, x1: DIAG.x0 + DIAG.count * DIAG.pitch + DIAG.depth,
  },
  salida: { x: XS - OWN, z: ZEND - 6 },
};

// ---- generation log ---------------------------------------------------------------------------
// Every builder records what it placed. In dev it's printed as one collapsed
// "[examCourse] generation log" console group; docs/track-mapping/genlog/ dumps it to log.json
// from a plain-Node run and draws/checks it (genlog_map.png).
export interface GenLogEntry { what: string; [k: string]: unknown }
export const EXAM_GENLOG: GenLogEntry[] = [];
function genLog(what: string, data: Record<string, unknown> = {}): void {
  EXAM_GENLOG.push({ what, ...data });
}

// ---- coverage: which paved piece a point is on (for clipping lines and curbs at junctions) ---
type Region = { id: string; contains: (x: number, z: number) => boolean };
const EPS = 0.02;
const rectOf = (r: Road): Pad => (r.axis === 'x'
  ? { id: r.id, x0: r.lo, x1: r.hi, z0: r.fixed - HALF, z1: r.fixed + HALF }
  : { id: r.id, x0: r.fixed - HALF, x1: r.fixed + HALF, z0: r.lo, z1: r.hi });
const rectRegion = (p: Pad): Region => ({
  id: p.id, contains: (x, z) => x > p.x0 + EPS && x < p.x1 - EPS && z > p.z0 + EPS && z < p.z1 - EPS,
});
const inSector = (b: Bend, x: number, z: number): boolean => {
  const r = Math.hypot(x - b.cx, z - b.cz), t = Math.atan2(z - b.cz, x - b.cx);
  const tn = t < b.t0 - 1e-6 ? t + Math.PI * 2 : t;
  return r > RC - HALF + EPS && r < RC + HALF - EPS && tn > b.t0 + 1e-4 && tn < b.t1 - 1e-4;
};

// Rounded kerbs: the two corners where a road ends on another (every T-junction) get a KERB_R
// radius, like the reference's rounded islands, so a turning car stays on the asphalt. Each fillet
// is the corner square minus a disc; (sx, sz) say which way from the corner the island lies.
const KERB_R = 4;
interface Fillet { id: string; x: number; z: number; sx: number; sz: number }
const FILLETS: Fillet[] = ROADS.flatMap(r => ROADS.filter(st => stemsOf(r).includes(st.id)).flatMap(st => {
  const side = st.lo === r.fixed ? 1 : -1; // which side of r the stem lies on
  return [-1, 1].map(t => (r.axis === 'z'
    ? { id: `fillet-${st.id}-${r.id}${t}`, x: r.fixed + side * HALF, z: st.fixed + t * HALF, sx: side, sz: t }
    : { id: `fillet-${st.id}-${r.id}${t}`, x: st.fixed + t * HALF, z: r.fixed + side * HALF, sx: t, sz: side }));
}));
const filletCentre = (f: Fillet): Pt => ({ x: f.x + f.sx * KERB_R, z: f.z + f.sz * KERB_R });
// covers the paved fillet plus 0.6 back into both roads, so their straight edge lines and kerbs
// stop where the curve takes over
function inFillet(f: Fillet, x: number, z: number): boolean {
  const u = (x - f.x) * f.sx, v = (z - f.z) * f.sz, c = filletCentre(f);
  return u > -0.6 && u < KERB_R - EPS && v > -0.6 && v < KERB_R - EPS && Math.hypot(x - c.x, z - c.z) > KERB_R + EPS;
}
// the kerb arc from the through road's edge round to the stem's, at `r` from the fillet's centre
function filletArc(f: Fillet, r: number): Pt[] {
  const c = filletCentre(f);
  const a0 = Math.atan2(0, -f.sx), a1 = Math.atan2(-f.sz, 0);
  const d = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
  return sampleArc(c.x, c.z, r, a0, a0 + d);
}

// The óvalo's two arms flare out where they meet the ring (a real roundabout's entry and exit
// curves need the room): a quad per side of each arm, from the road's edge 10 m out to where it
// meets the ring 13 m off the arm's axis, and a little past that into the ring.
interface Apron { id: string; pts: Pt[]; flare: [Pt, Pt]; axis: Pt }
const APRONS: Apron[] = [{ id: 'E', u: { x: 1, z: 0 } }, { id: 'S', u: { x: 0, z: 1 } }].flatMap(({ id, u }) => [-1, 1].map(w => {
  const n = { x: -u.z * w, z: u.x * w };
  const at = (d: number, lat: number): Pt => ({ x: XW + u.x * d + n.x * lat, z: ZT + u.z * d + n.z * lat });
  const d1 = RB.outerR + 10, latRing = 13, dRing = Math.sqrt(RB.outerR ** 2 - latRing ** 2), dIn = dRing - 1.8;
  const latIn = HALF + (d1 - dIn) * (latRing - HALF) / (d1 - dRing);
  return { id: `apron-${id}${w}`, pts: [at(d1, HALF - 0.6), at(d1, HALF), at(dIn, latIn), at(dIn, HALF - 0.6)], flare: [at(d1, HALF), at(dIn, latIn)] as [Pt, Pt], axis: at((d1 + dIn) / 2, 0) };
}));
function inConvex(pts: Pt[], x: number, z: number): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const c = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c); else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

const REGIONS: Region[] = [
  ...ROADS.map(r => rectRegion(rectOf(r))),
  ...PADS.map(rectRegion),
  ...BENDS.map(b => ({ id: b.id, contains: (x: number, z: number) => inSector(b, x, z) })),
  { id: 'ovalo', contains: (x, z) => Math.hypot(x - XW, z - ZT) < RB.outerR - EPS },
  ...FILLETS.map(f => ({ id: f.id, contains: (x: number, z: number) => inFillet(f, x, z) })),
  ...APRONS.map(a => ({ id: a.id, contains: (x: number, z: number) => inConvex(a.pts, x, z) })),
  { id: 'taper', contains: (x, z) => inConvex(PAR_TAPER, x, z) },
];

// Is (x, z) on the asphalt? (the óvalo's central island isn't) — for the docs/track-mapping tooling.
export function isPaved(x: number, z: number): boolean {
  if (Math.hypot(x - XW, z - ZT) < RB.islandR + 0.5) return false;
  return REGIONS.some(r => r.contains(x, z));
}

// Keeps the stretches of `pts` (densely sampled) that no region outside `skip` covers.
function clip(pts: Pt[], skip: Set<string>): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  pts.forEach(p => {
    const covered = REGIONS.some(r => !skip.has(r.id) && r.contains(p.x, p.z));
    if (covered) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p);
  });
  if (cur.length > 1) runs.push(cur);
  return runs;
}

const STEP = 0.25;
function sampleLine(a: Pt, b: Pt): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n }));
}
function sampleArc(cx: number, cz: number, r: number, t0: number, t1: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) * r / STEP));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + (t1 - t0) * i / n;
    return { x: cx + r * Math.cos(t), z: cz + r * Math.sin(t) };
  });
}

// A road's line `offset` to the side of its centreline (+ = +z for x-roads, +x for z-roads).
function roadLine(r: Road, offset: number): Pt[] {
  return r.axis === 'x'
    ? sampleLine({ x: r.lo, z: r.fixed + offset }, { x: r.hi, z: r.fixed + offset })
    : sampleLine({ x: r.fixed + offset, z: r.lo }, { x: r.fixed + offset, z: r.hi });
}
// The four sides of a pad, `inset` inwards (negative = outwards).
function padSides(p: Pad, inset: number): Pt[][] {
  const x0 = p.x0 + inset, x1 = p.x1 - inset, z0 = p.z0 + inset, z1 = p.z1 - inset;
  return [
    sampleLine({ x: x0, z: z0 }, { x: x1, z: z0 }), sampleLine({ x: x1, z: z0 }, { x: x1, z: z1 }),
    sampleLine({ x: x1, z: z1 }, { x: x0, z: z1 }), sampleLine({ x: x0, z: z1 }, { x: x0, z: z0 }),
  ];
}
// Roads that END on `r` (the stem of a T) — `r`'s centre line runs straight through them.
function stemsOf(r: Road): string[] {
  return ROADS.filter(s => s.axis !== r.axis && (s.lo === r.fixed || s.hi === r.fixed) && s.fixed > r.lo && s.fixed < r.hi).map(s => s.id);
}

// ---- road paint: every mark is a flat ribbon, batched into one mesh per colour ----------------
const MARK_Y = 0.104;
class MarkBatch {
  private pos: number[] = [];
  private idx: number[] = [];
  constructor(private color: number, private y: number) {}
  ribbon(pts: Pt[], width: number): void {
    if (pts.length < 2) return;
    const base = this.pos.length / 3, h = width / 2;
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l * h, nz = dx / l * h;
      this.pos.push(p.x + nx, this.y, p.z + nz, p.x - nx, this.y, p.z - nz);
    });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  // wound so its face points up, like the ribbons: a face-down triangle on the double-sided
  // material is shaded as if lit from below and comes out dark
  tri(a: Pt, b: Pt, c: Pt): void {
    const base = this.pos.length / 3;
    const up = (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z) > 0;
    (up ? [a, b, c] : [a, c, b]).forEach(p => this.pos.push(p.x, this.y, p.z));
    this.idx.push(base, base + 1, base + 2);
  }
  flush(): number {
    if (!this.idx.length) return 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(this.idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: this.color, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    mesh.receiveShadow = true;
    scene.add(mesh);
    return Math.round(this.idx.length / 6);
  }
}

// ---- kerb colliders: non-blocking, only there so systems/rules.ts's curb penalty fires when a
// wheel leaves the asphalt (same convention as streetKit.ts's curbBody) -----------------------
let curbCount = 0;
function curbRun(pts: Pt[]): void {
  for (let i = 0; i < pts.length - 1;) {
    let j = i + 1;
    while (j < pts.length - 1 && Math.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z) < 3) j++;
    const a = pts[i], b = pts[j];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len > 0.05) {
      const body = new CANNON.Body({ mass: 0, material: propMaterial });
      body.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, 1, 0.3)));
      body.position.set((a.x + b.x) / 2, 0.05, (a.z + b.z) / 2);
      body.quaternion.setFromEuler(0, -Math.atan2(dz, dx), 0);
      body.userData = { isPenalized: false, isStatic: true, isCurb: true };
      body.collisionResponse = false;
      world.addBody(body);
      curbCount++;
    }
    i = j;
  }
}

// ---- lane arrows: every lane carries arrows for the way it may be driven; the one nearest each
// junction shows the turns allowed there (docs/track-mapping/reference/directions_and_areas.png) ---
type Turn = 'S' | 'L' | 'R';
const ARROW_W = 0.26;

// A straight shaft with a head for 'S', a quarter-bend with a sideways head for each of 'L'/'R'.
// Centred on `at`, 5.2 long, pointing along the unit vector `d`.
function arrowGlyph(batch: MarkBatch, at: Pt, d: Pt, turns: Turn[]): void {
  const rx = -d.z, rz = d.x;
  const P = (f: number, r: number): Pt => ({ x: at.x + d.x * f + rx * r, z: at.z + d.z * f + rz * r });
  batch.ribbon([P(-2.6, 0), P(turns.includes('S') ? 1.2 : -0.3, 0)], ARROW_W);
  if (turns.includes('S')) batch.tri(P(2.6, 0), P(1.1, 0.55), P(1.1, -0.55));
  turns.filter(t => t !== 'S').forEach(t => {
    const s = t === 'L' ? -1 : 1, R = 0.9, f0 = -0.4;
    batch.ribbon(Array.from({ length: 7 }, (_, i) => {
      const a = (i / 6) * Math.PI / 2;
      return P(f0 + R * Math.sin(a), s * R * (1 - Math.cos(a)));
    }), ARROW_W);
    batch.tri(P(f0 + R, s * 1.75), P(f0 + R - 0.5, s * (R - 0.05)), P(f0 + R + 0.5, s * (R - 0.05)));
  });
}

function splitRuns(pts: Pt[], blocked: (p: Pt) => boolean): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  pts.forEach(p => {
    if (blocked(p)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(p);
  });
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// Which way a lane runs: right-hand traffic, except on the two one-way gate chutes.
function laneHeading(r: Road, offset: number, mid: Pt): Heading {
  if (r.id === 'salida') return 'S';
  if (r.id === 'east' && mid.z > CHUTE_Z0) return 'N';
  if (r.axis === 'x') return offset > 0 ? 'E' : 'W';
  return offset > 0 ? 'N' : 'S';
}

// The turns allowed from a lane arriving at the junction where its run ends (at `end`).
function approachTurns(id: string, h: Heading, end: Pt, offset: number): Turn[] {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < HALF + 1;
  switch (id) {
    case 'east':
      if (h === 'N' && near(end.z, CHUTE_Z0)) return offset < 0 ? ['L'] : ['S']; // ENTRADA: left lane onto road 3
      if (h === 'S' && near(end.z, ZP - HALF)) return ['S', 'R'];
      if (h === 'S' && near(end.z, ZB - HALF)) return ['R'];
      return ['S'];
    case 'top':
      if (h === 'W' && near(end.x, XI + HALF)) return ['S', 'L'];
      if (h === 'E' && near(end.x, XI - HALF)) return ['S', 'R'];
      return ['S'];
    case 'inner':
      if (h === 'N') return near(end.z, ZP + HALF) ? ['S', 'R'] : ['L', 'R'];
      return near(end.z, ZP - HALF) ? ['S', 'L'] : ['L', 'R'];
    case 'aisle':
      return h === 'W' ? ['L'] : ['L', 'R'];
    case 'bottom':
      if (h === 'E') return near(end.x, XI - HALF) ? ['S', 'L'] : near(end.x, XS - HALF) ? ['S', 'R'] : near(end.x, XE - HALF) ? ['L'] : ['S'];
      return near(end.x, XS + HALF) ? ['S', 'L'] : near(end.x, XI + HALF) ? ['S', 'R'] : ['S'];
    default:
      return ['S'];
  }
}

// Keeps arrows off the zebras, the speed bump and the gravel trocha.
function arrowClear(id: string, c: Pt): boolean {
  if ((id === 'top' || id === 'bottom') && Math.abs(c.x - ZEBRA_X) < 8) return false;
  if (id === 'bottom' && Math.abs(c.x - BUMP_X) < 6) return false;
  if (id === 'top' && c.x > XE - RC - 26) return false;
  return true;
}

function paintArrows(batch: MarkBatch): number {
  let count = 0;
  ROADS.forEach(r => {
    const stems = ROADS.filter(s => stemsOf(r).includes(s.id));
    const along = (p: Pt): number => (r.axis === 'x' ? p.x : p.z);
    [-OWN, OWN].forEach(offset => {
      clip(roadLine(r, offset), new Set([r.id]))
        .flatMap(run => splitRuns(run, p => stems.some(s => Math.abs(along(p) - s.fixed) < HALF + 0.5)))
        .forEach(run => {
          const h = laneHeading(r, offset, run[Math.floor(run.length / 2)]);
          const d = HEADING_DIR[h];
          const proj = (p: Pt): number => p.x * d.x + p.z * d.z;
          const [start, end] = proj(run[0]) < proj(run[run.length - 1]) ? [run[0], run[run.length - 1]] : [run[run.length - 1], run[0]];
          const len = Math.hypot(end.x - start.x, end.z - start.z);
          for (let k = 0, back = 7 + 2.6; back + 2.6 < len - 3; k++, back += 25) {
            const c = { x: end.x - d.x * back, z: end.z - d.z * back };
            if (!arrowClear(r.id, c)) continue;
            arrowGlyph(batch, c, d, k === 0 ? approachTurns(r.id, h, end, offset) : ['S']);
            count++;
          }
        });
    });
  });
  // round the óvalo, counter-clockwise, on the outer lane between the arms
  [Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4, 3 * Math.PI / 4].forEach(t => {
    arrowGlyph(batch, { x: XW + RB.laneR * Math.cos(t), z: ZT + RB.laneR * Math.sin(t) }, { x: Math.sin(t), z: -Math.cos(t) }, ['S']);
    count++;
  });
  return count;
}

// ---- asphalt ----------------------------------------------------------------------------------
const ASPHALT = 0x3a3a3f;
const ASPHALT_TOP = 0.097;
function slab(p: Pad, i: number, color = ASPHALT, top = ASPHALT_TOP): void {
  const h = 0.147;
  const m = box(p.x1 - p.x0, h, p.z1 - p.z0, color, { roughness: 1 });
  // a hair's difference per piece so overlapping junction slabs never z-fight
  m.position.set((p.x0 + p.x1) / 2, top - h / 2 + i * 0.0002, (p.z0 + p.z1) / 2);
  m.receiveShadow = true;
  scene.add(m);
}

// A flat asphalt piece of any outline, top face at `top`.
function flatPoly(pts: Pt[], top = ASPHALT_TOP, color = ASPHALT): void {
  const h = 0.147;
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.z))), { depth: h, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // shape (x, y) -> world (x, -y) on the ground, extruded up
  geo.translate(0, top - h, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  m.receiveShadow = true;
  scene.add(m);
}

function buildRoads(): void {
  ROADS.forEach((r, i) => {
    slab(rectOf(r), i);
    genLog('road', { id: r.id, axis: r.axis, fixed: r.fixed, from: r.lo, to: r.hi, width: HALF * 2 });
  });
  PADS.forEach((p, i) => {
    slab(p, ROADS.length + i);
    genLog('pad', { id: p.id, x: [p.x0, p.x1], z: [p.z0, p.z1] });
  });
  BENDS.forEach(b => {
    annulus(b.cx, b.cz, RC - HALF, RC + HALF, -0.05, ASPHALT_TOP, ASPHALT, b.t0, b.t1);
    genLog('bend', { id: b.id, center: { x: b.cx, z: b.cz }, r: RC, from: b.t0, to: b.t1 });
  });
  // the óvalo's ring (its island + ring markings come from buildOvalo()) and its flared mouths
  annulus(XW, ZT, RB.islandR, RB.outerR, -0.05, ASPHALT_TOP, ASPHALT);
  genLog('ovalo ring', { center: { x: XW, z: ZT }, innerR: RB.islandR, outerR: RB.outerR });
  APRONS.forEach(a => {
    flatPoly(a.pts, ASPHALT_TOP - 0.0006);
    genLog('apron', { id: a.id, pts: a.pts });
  });
  flatPoly(PAR_TAPER, ASPHALT_TOP - 0.0006);
  genLog('pad', { id: 'parallel taper', pts: PAR_TAPER });
  // rounded kerbs at the T-junctions
  FILLETS.forEach(f => {
    flatPoly([{ x: f.x, z: f.z }, { x: f.x + f.sx * KERB_R, z: f.z }, ...filletArc(f, KERB_R).reverse(), { x: f.x, z: f.z + f.sz * KERB_R }], ASPHALT_TOP - 0.0006);
    genLog('kerb radius', { id: f.id, corner: { x: f.x, z: f.z }, r: KERB_R });
  });

  // TROCHA: the gravel stretch over the NE corner and the east end of the top road
  const tan = 0xb98f63;
  annulus(XE - RC, ZT + RC, RC - HALF, RC + HALF, -0.05, ASPHALT_TOP + 0.003, tan, -Math.PI / 2, 0);
  slab({ id: 'trocha', x0: XE - RC - 22, x1: XE - RC, z0: ZT - HALF, z1: ZT + HALF }, 0, tan, ASPHALT_TOP + 0.003);
  genLog('trocha', { x: [XE - RC - 22, XE], z: [ZT - HALF, ZT + RC] });

  // ---- markings: white edge lines 0.45 in from every kerb, double yellow centre lines;
  // everything clipped where another paved piece takes over (junctions, óvalo, pads)
  const white = new MarkBatch(0xf2f2f2, MARK_Y), yellow = new MarkBatch(0xf2c200, MARK_Y + 0.001);
  const INSET = 0.45, EDGE_W = 0.15;
  ROADS.forEach(r => {
    [-1, 1].forEach(s => {
      clip(roadLine(r, s * (HALF - INSET)), new Set([r.id])).forEach(run => white.ribbon(run, EDGE_W));
      clip(roadLine(r, s * (HALF + 0.3)), new Set([r.id])).forEach(curbRun);
      if (r.id === 'salida') return; // one-way
      clip(roadLine(r, s * 0.13), new Set([r.id, ...stemsOf(r)])).forEach(run => {
        yellow.ribbon(r.id === 'east' ? run.filter(p => p.z <= CHUTE_Z0) : run, 0.1); // the ENTRADA chute is one-way
      });
    });
  });
  // lane dividers on the two one-way chutes: white, 3 m dashes
  const dashes = (x: number, z0: number, z1: number): void => {
    for (let z = z0; z + 3 <= z1; z += 6) white.ribbon(sampleLine({ x, z }, { x, z: z + 3 }), 0.12);
  };
  dashes(XE, CHUTE_Z0 + 4, ZEND - 1);
  dashes(XS, CHUTE_Z0 + 1, ZEND - 5);
  PADS.forEach(p => {
    padSides(p, INSET).forEach(side => clip(side, new Set([p.id])).forEach(run => white.ribbon(run, EDGE_W)));
    padSides(p, -0.3).forEach(side => clip(side, new Set([p.id])).forEach(curbRun));
  });
  BENDS.forEach(b => {
    [RC - HALF + INSET, RC + HALF - INSET].forEach(r => clip(sampleArc(b.cx, b.cz, r, b.t0, b.t1), new Set([b.id])).forEach(run => white.ribbon(run, EDGE_W)));
    [RC - HALF - 0.3, RC + HALF + 0.3].forEach(r => clip(sampleArc(b.cx, b.cz, r, b.t0, b.t1), new Set([b.id])).forEach(curbRun));
    [-0.13, 0.13].forEach(o => yellow.ribbon(sampleArc(b.cx, b.cz, RC + o, b.t0, b.t1), 0.1));
  });
  clip(sampleArc(XW, ZT, RB.outerR - INSET, -Math.PI, Math.PI), new Set(['ovalo'])).forEach(run => white.ribbon(run, EDGE_W));
  clip(sampleArc(XW, ZT, RB.outerR + 0.3, -Math.PI, Math.PI), new Set(['ovalo'])).forEach(curbRun);
  // the flared mouths' edges, from the arm's edge line into the ring
  APRONS.forEach(({ flare: [a, b], axis }) => {
    const l = Math.hypot(b.x - a.x, b.z - a.z), nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l;
    const toRoad = (axis.x - a.x) * nx + (axis.z - a.z) * nz > 0 ? 1 : -1; // the paved side, facing the arm's axis
    const off = (d: number): Pt[] => sampleLine({ x: a.x + nx * d, z: a.z + nz * d }, { x: b.x + nx * d, z: b.z + nz * d })
      .filter(p => Math.hypot(p.x - XW, p.z - ZT) > RB.outerR - 0.2);
    white.ribbon(off(toRoad * INSET), EDGE_W);
    curbRun(off(-toRoad * 0.3));
  });
  FILLETS.forEach(f => {
    white.ribbon(filletArc(f, KERB_R + INSET), EDGE_W);
    curbRun(filletArc(f, KERB_R - 0.3));
  });
  // the parallel row's tapered west end: its slanted edge line and kerb
  {
    const [a, b] = PAR_TAPER_EDGE;
    const l = Math.hypot(b.x - a.x, b.z - a.z), nx = (b.z - a.z) / l, nz = -(b.x - a.x) / l; // towards the pavement
    const off = (d: number): Pt[] => sampleLine({ x: a.x + nx * d, z: a.z + nz * d }, { x: b.x + nx * d, z: b.z + nz * d });
    clip(off(INSET), new Set(['taper'])).forEach(run => white.ribbon(run, EDGE_W));
    clip(off(-0.3), new Set(['taper'])).forEach(curbRun);
  }

  // stall lines: parallel = short ticks off the kerb, diagonal = 45° lines into the island
  for (let k = 1; k < PAR.count; k++) {
    const x = PAR.x0 + k * PAR.pitch;
    white.ribbon(sampleLine({ x, z: PAR_KERB_Z + INSET }, { x, z: PAR_KERB_Z + 2.4 }), EDGE_W);
  }
  for (let k = 0; k <= DIAG.count; k++) {
    const x = DIAG.x0 + k * DIAG.pitch;
    white.ribbon(sampleLine({ x, z: DIAG_Z0 }, { x: x + DIAG.depth - INSET, z: DIAG_Z0 + DIAG.depth - INSET }), EDGE_W);
  }

  // stop lines: across both ENTRADA lanes before the road-3 junction, across the SALIDA gate, and
  // one at every semáforo
  white.ribbon(sampleLine({ x: XE - HALF + INSET, z: COURSE.stopLineZ }, { x: XE + HALF - INSET, z: COURSE.stopLineZ }), 0.45);
  white.ribbon(sampleLine({ x: XS - HALF + INSET, z: ZEND - 3 }, { x: XS + HALF - INSET, z: ZEND - 3 }), 0.45);
  SEMAPHORES.forEach(({ heading, stop, halfWidth }) => {
    const d = HEADING_DIR[heading], rx = -d.z, rz = d.x;
    white.ribbon([{ x: stop.x - rx * halfWidth, z: stop.z - rz * halfWidth }, { x: stop.x + rx * halfWidth, z: stop.z + rz * halfWidth }], 0.45);
  });

  const arrows = paintArrows(white);
  // "ceda el paso" dashes across the two lanes entering the óvalo (E arm westbound, S arm northbound)
  for (let i = 0; i < 5; i++) {
    const a = 0.3 + i * 0.75;
    white.ribbon([{ x: RB.outerR + 1.2, z: ZT - a }, { x: RB.outerR + 1.2, z: ZT - a - 0.45 }], 0.4);
    white.ribbon([{ x: XW + a, z: RB.outerR + 1.2 }, { x: XW + a + 0.45, z: RB.outerR + 1.2 }], 0.4);
  }

  const whiteQuads = white.flush(), yellowQuads = yellow.flush();
  genLog('markings', { whiteQuads, yellowQuads, arrows, curbColliders: curbCount });
}

// ---- parking ----------------------------------------------------------------------------------
function buildParking(): void {
  // parallel: bays 1→7 west→east along the kerb; diagonal: 45°, nosed in facing south-east, 7→1
  for (let i = 1; i <= PAR.count; i++) paintLetter(parBayCx(i), PAR_KERB_Z + 0.75, 1.1, String(i));
  genLog('parking.parallel', {
    bays: PAR.count, numbering: '1→7 west→east', kerbZ: PAR_KERB_Z,
    centres: Array.from({ length: PAR.count }, (_, i) => ({ x: parBayCx(i + 1), z: PAR_KERB_Z + 1.25 })),
  });
  for (let k = 0; k < DIAG.count; k++) {
    paintLetter(diagBayCx(k) + DIAG_DIR.x * 1.6, diagCz + DIAG_DIR.z * 1.6, 1.0, String(DIAG.count - k));
  }
  genLog('parking.diagonal', {
    bays: DIAG.count, numbering: '7→1 west→east', rake: '45° SE',
    centres: Array.from({ length: DIAG.count }, (_, k) => ({ x: diagBayCx(k), z: diagCz })),
  });

  // the yard's name boards behind each row, facing the aisle
  const parBoard = buildSign('ESTACIONAMIENTO\nEN PARALELO');
  parBoard.position.set(PAR.x0 + PAR.count * PAR.pitch / 2, 0, PAR_KERB_Z - 2.5);
  scene.add(parBoard);
  const diagBoard = buildSign('ESTACIONAMIENTO\nEN DIAGONAL');
  diagBoard.position.set(diagBayCx(3), 0, DIAG_Z0 + DIAG.depth + 2.5);
  diagBoard.rotation.y = Math.PI;
  scene.add(diagBoard);
}

// The green rectangle on the bay the player has been sent to, shown only while that's their task
// (null clears it).
const targetZones: Partial<Record<'diag' | 'par', THREE.Mesh>> = {};
export function showPlayerBay(kind: 'diag' | 'par', bay: number | null): void {
  const old = targetZones[kind];
  if (old) { scene.remove(old); old.geometry.dispose(); delete targetZones[kind]; }
  if (bay === null) return;
  targetZones[kind] = kind === 'par'
    ? targetZone(PAR.x0 + (bay - 1) * PAR.pitch + 0.15, PAR.x0 + bay * PAR.pitch - 0.15, PAR_KERB_Z + 0.2, PAR_KERB_Z + PAR.depth)
    : targetZoneAngled(diagBayCx(bay), diagCz, DIAG.pitch * Math.SQRT1_2 - 0.2, 5.2, DIAG_YAW);
}

// ---- signs --------------------------------------------------------------------------------------
// Every sign stands on the verge to the RIGHT of the traffic it's for, facing that traffic.
const FACE: Record<Heading, number> = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };
const ROAD = Object.fromEntries(ROADS.map(r => [r.id, r])) as Record<string, Road>;

function verge(roadId: string, along: number, heading: Heading, d = HALF + 1.2): Pt {
  const r = ROAD[roadId];
  if (r.axis === 'z') return { x: r.fixed + (heading === 'N' ? d : -d), z: along };
  return { x: along, z: r.fixed + (heading === 'E' ? d : -d) };
}

// `left`: on the verge to the traffic's left instead (a sign for the left lane of a one-way road).
function sign(code: string, plates: THREE.Object3D[], roadId: string, along: number, heading: Heading, left = false): void {
  const p = verge(roadId, along, heading, left ? -(HALF + 1.2) : HALF + 1.2);
  const post = buildSignPost(plates.map((plate, i) => ({ plate, y: 2.35 - i * 0.9 })), 2.8);
  post.position.set(p.x, 0, p.z);
  post.rotation.y = FACE[heading];
  scene.add(post);
  genLog('sign', { code, road: roadId, x: p.x, z: p.z, facing: heading });
}

function stopSign(roadId: string, along: number, heading: Heading): void {
  const p = verge(roadId, along, heading);
  const s = buildStopSign();
  s.position.set(p.x, 0, p.z);
  s.rotation.y = FACE[heading];
  scene.add(s);
  genLog('sign', { code: 'R-1 PARE', road: roadId, x: p.x, z: p.z, facing: heading });
}

function buildSigns(): void {
  // ENTRADA (one-way, northbound): PARE before the road-3 junction; the right lane carries straight
  // on, the left lane turns left onto road 3
  stopSign('east', COURSE.stopLineZ + 1, 'N');
  sign('R-3', [buildMandatoryDirectionPlate()], 'east', ZEND - 10, 'N');
  sign('R-5', [buildLeftTurnOnlyPlate()], 'east', ZEND - 10, 'N', true);
  sign('R-30 15', [buildSpeedLimitPlate(15)], 'east', ZT + RC + 14, 'N');

  // top road, westbound "Zona Habilidad": 35 km/h, two-way, pedestrians, óvalo ahead, yield
  sign('R-30 35', [buildSpeedLimitPlate(35)], 'top', XE - RC - 14, 'W');
  sign('P-25', [buildTwoWayTrafficPlate()], 'top', 104, 'W');
  sign('P-48', [buildPedestrianWarningPlate()], 'top', 82, 'W');
  sign('P-15', [buildRoundaboutAheadPlate()], 'top', 40, 'W');
  sign('R-2', [buildYieldPlate()], 'top', RB.outerR + 5, 'W');
  // top road, eastbound out of the óvalo: the inner road joins from the right, then the crossing
  sign('P-10-A', [buildAcuteMergeRightPlate()], 'top', 26, 'E');
  sign('P-48', [buildPedestrianWarningPlate()], 'top', 55, 'E');

  // west road: yield entering the óvalo northbound; southbound the road only bends left
  sign('R-2', [buildYieldPlate()], 'west', RB.outerR + 5, 'N');
  sign('R-5', [buildLeftTurnOnlyPlate()], 'west', ZB - RC - 8, 'S');

  // inner road: northbound at the aisle you may turn right into it or carry on
  sign('R-7-2', [buildRightTurnOrContinuePlate()], 'inner', ZP + HALF + 12, 'N');

  // aisle: westbound traffic leaves it turning left (towards SALIDA); U-turns allowed at the east end
  sign('R-5', [buildLeftTurnOnlyPlate()], 'aisle', XI + HALF + 9, 'W');
  sign('R-9', [buildUTurnPermittedPlate()], 'aisle', 128, 'E');

  // bottom road eastbound: crossing, then SALIDA on the right or carry on along road 3
  sign('P-48', [buildPedestrianWarningPlate()], 'bottom', 54, 'E');
  sign('R-7-2', [buildRightTurnOrContinuePlate()], 'bottom', XS - 12, 'E');
  // road 3: speed bump warnings both ways
  sign('P-33', [buildSpeedBumpAheadPlate()], 'bottom', 110, 'E');
  sign('P-33', [buildSpeedBumpAheadPlate()], 'bottom', 140, 'W');
  // connector (east road southbound): at road 3 the only way is right
  sign('R-7', [buildRightTurnOnlyPlate()], 'east', ZB - HALF - 6, 'S');

  // SALIDA: PARE at the gate
  stopSign('salida', ZEND - 2, 'S');

  // semáforos: timed, one head per controlled approach (see SEMAPHORES)
  resetTrafficLights();
  SEMAPHORES.forEach(({ heading, stop, halfWidth, cycle }) => {
    const { pole } = addTrafficLight({ heading, stop, halfWidth, cycle, verge: 1.2 });
    genLog('semaphore', { x: pole.x, z: pole.z, facing: heading, stop, cycle });
  });

  // gate boards
  const entrada = buildSign('ENTRADA');
  entrada.position.set(XE + HALF + 2, 0, ZEND - 1);
  scene.add(entrada);
  const salidaBoard = buildSign('SALIDA');
  salidaBoard.position.set(XS - HALF - 2, 0, ZEND - 1);
  salidaBoard.rotation.y = Math.PI;
  scene.add(salidaBoard);
}

// ---- crossings, speed bump, gates ---------------------------------------------------------------

function buildRoadFurniture(): void {
  resetCrosswalks();
  addCrosswalk({ cx: ZEBRA_X, cz: ZT, axis: 'z', roadHalf: LANE, walkHalf: HALF + 1.5, build: true });
  addCrosswalk({ cx: ZEBRA_X, cz: ZB, axis: 'z', roadHalf: LANE, walkHalf: HALF + 1.5, build: true });
  flushZebras();
  genLog('crosswalks', { at: [{ road: 'top', x: ZEBRA_X }, { road: 'bottom', x: ZEBRA_X }] });

  // ROMPEMUELLES: straight across road 3, kerb to kerb
  const width = HALF * 2 - 0.4;
  const bump = buildSpeedBump(width);
  bump.position.set(BUMP_X, 0, ZB);
  bump.rotation.y = Math.PI / 2; // built running along x; road 3 runs along x, so turn it to span z
  scene.add(bump);
  const body = new CANNON.Body({ mass: 0, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.35, 0.09, width / 2)));
  body.position.set(BUMP_X, 0.05, ZB);
  body.userData = { isPenalized: false };
  world.addBody(body);
  genLog('rompemuelles', { x: BUMP_X, z: ZB, spans: 'z (across road 3)', width });

  // finish gate over the SALIDA chute
  [-1, 1].forEach(s => {
    const post = box(0.3, 3.6, 0.3, 0x444444);
    post.position.set(XS + s * (HALF + 0.6), 1.8, ZEND - 1);
    scene.add(post);
  });
  const banner = box(HALF * 2 + 1.5, 0.8, 0.15, 0x2ecc71);
  banner.position.set(XS, 3.6, ZEND - 1);
  scene.add(banner);
}

function scatterAround(): void {
  const blocks = [
    { x: -40, z: -75 }, { x: 65, z: -75 }, { x: 170, z: -75 },
    { x: -85, z: 26 }, { x: 225, z: 26 },
    { x: -40, z: 135 }, { x: 65, z: 135 }, { x: 170, z: 135 },
  ];
  blocks.forEach(({ x, z }) => scatterBlockBuildings(x, z, 70, 10, [2, 4]));
}

// `route`: which of the two exam routes the player drives, which picks the ENTRADA lane they start in.
export function buildExamCourse(route: 'A' | 'B' = 'A'): Spawn {
  EXAM_GENLOG.length = 0;
  curbCount = 0;
  setLaneLayout(1);

  buildGround(65, 26, 460, 320);
  buildRoads();
  buildOvalo(XW, ZT);
  genLog('ovalo', { center: { x: XW, z: ZT }, islandR: RB.islandR, ringOuterR: RB.outerR, arms: ['E (top road)', 'S (west road)'] });
  buildRoadFurniture();
  buildParking();
  buildSigns();
  scatterAround();

  // in the route's ENTRADA lane, facing north, into the course
  const start = COURSE.entrance[route];
  const spawn: Spawn = { x: start.x, y: 1.2, z: start.z, rotY: 0 };
  genLog('spawn', { ...spawn, route, facing: 'N', lane: route === 'A' ? 'ENTRADA, right lane' : 'ENTRADA, left lane' });
  if (import.meta.env?.DEV) {
    console.groupCollapsed(`[examCourse] generation log (${EXAM_GENLOG.length} entries)`);
    EXAM_GENLOG.forEach(e => console.log(e.what, e));
    console.groupEnd();
  }
  return spawn;
}
