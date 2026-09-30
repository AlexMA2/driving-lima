import { COURSE } from './examCourse';
import { RB, getRoute, type ArmId } from './roundabout';
import { bezier, buildPathFromPoints, type Path, type Pt } from './curves';

// The two routes of the "Examen Oficial MTC" circuit (docs/track-mapping, "Ruta A" / "Ruta B"),
// as lane-centre polylines shared by the player's step list (systems/examCourse.ts), its "AI"
// button (systems/examAutopilot.ts) and the other candidates driving the course
// (entities/examTraffic.ts), so all three agree on where the route goes.
//
//   Ruta A: ENTRADA right lane, PARE, straight on up the east road, left along the top road
//           (the speed run) into the óvalo, first exit (south) down the west road.
//   Ruta B: ENTRADA left lane, PARE, left onto road 3 in its right-hand lane, over the speed
//           bump, round the SW corner and up the west road into the óvalo, all the way round
//           and back out the way it came in (south).
//   Then both: down the west road, left up the inner road, right into the parking aisle, nose
//   into diagonal bay 4 and back out; on east along the aisle, left up the east road and along
//   the top road to the óvalo again, all the way round and out the way it came in (east); along
//   the top road eastbound, down the east road, right into the aisle, parallel bay 4; then left
//   down the inner road, left along road 3 and right out through SALIDA.
//
// A route is made of chunks (plain drives from one landmark to the next) with the two parking
// manoeuvres in between, which traffic expands into bay-specific legs when it gets there.

export type ExamRouteId = 'A' | 'B';
export type ChunkId = 'entry' | 'toOvalo' | 'toDiag' | 'toOvalo2' | 'toParallel' | 'finish';
export type Segment = ChunkId | 'diag' | 'par';
export const ROUTE_SEGMENTS: Segment[] = ['entry', 'toOvalo', 'toDiag', 'diag', 'toOvalo2', 'toParallel', 'par', 'finish'];

// A path plus the speed (m/s) it can be driven at, point by point: slower through corners and
// over the bump, braking to a stop at the end when the path ends in a stop.
export interface RoutePath extends Path { vmax: number[] }

const L = COURSE.lanes;
const R = COURSE.roads;
const OWN = L.eastNB - R.XE;
const STOP_Z = COURSE.stopLineZ + 2.6;             // car centre with its nose at the PARE line
const DIAG_Z = COURSE.diagonal.cz;
const DIAG_DIR = { x: Math.SQRT1_2, z: Math.SQRT1_2 }; // into a diagonal bay (south-east)
const P_AISLE = { x: COURSE.diagonal.x0 - 12, z: L.aisleEB };  // eastbound, short of the diagonal row
const P_AFTER = { x: COURSE.diagonal.x1 + 6, z: L.aisleEB };   // eastbound, past it
const P_PAR = { x: COURSE.parallel.bayCx(7) + 11, z: L.aisleWB }; // westbound, short of the parallel row
const P_PAR_END = { x: 60, z: L.aisleWB };                      // westbound, past it
const PAR_BAY_Z = COURSE.parallel.kerbZ + 1.25;

// ---- geometry helpers ---------------------------------------------------------------------------
interface Key extends Pt { r?: number } // r: fillet radius at this corner

function norm(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}
function line(a: Pt, b: Pt, step = 1.5): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
  return Array.from({ length: n }, (_, i) => ({ x: a.x + (b.x - a.x) * (i + 1) / n, z: a.z + (b.z - a.z) * (i + 1) / n }));
}

// Straight lane runs between the keys, each corner rounded into a circular-looking arc of radius r.
function lanePath(keys: Key[]): Pt[] {
  const pts: Pt[] = [{ x: keys[0].x, z: keys[0].z }];
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i], prev = pts[pts.length - 1];
    if (i === keys.length - 1 || !k.r) { pts.push(...line(prev, k)); continue; }
    const d1 = norm(keys[i - 1], k), d2 = norm(k, keys[i + 1]);
    const theta = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.z * d2.z)));
    const t = k.r * Math.tan(theta / 2), h = (4 / 3) * Math.tan(theta / 4) * k.r;
    const A = { x: k.x - d1.x * t, z: k.z - d1.z * t }, B = { x: k.x + d2.x * t, z: k.z + d2.z * t };
    pts.push(...line(prev, A));
    pts.push(...bezier(A, { x: A.x + d1.x * h, z: A.z + d1.z * h }, { x: B.x - d2.x * h, z: B.z - d2.z * h }, B, Math.max(6, Math.ceil(theta * k.r))));
  }
  return pts;
}

// The óvalo part of a roundabout route (world/roundabout.ts), from the approach lane ~38 m out to
// the exit lane ~38 m out.
function ovalo(entry: ArmId, exit: ArmId): Pt[] {
  const route = getRoute(entry, exit);
  return route.pts.filter(p => Math.hypot(p.x - RB.cx, p.z - RB.cz) < 40);
}

function join(...parts: Pt[][]): Pt[] {
  const out: Pt[] = [];
  parts.flat().forEach(p => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.05) out.push(p);
  });
  return out;
}

const A_LAT = 2.0, BRAKE = 1.8;
// `cruise` m/s on the straights, eased for curvature and the bump, braking to 0 at the end if `stopAtEnd`.
function toRoutePath(pts: Pt[], cruise: number, stopAtEnd = false): RoutePath {
  const path = buildPathFromPoints(pts);
  const n = pts.length;
  const vmax = pts.map((p, i) => {
    let j = i;
    while (j < n - 1 && path.cum[j] - path.cum[i] < 6) j++;
    const a = norm(pts[Math.max(0, i - 1)], pts[Math.min(n - 1, i + 1)] ?? p);
    const b = norm(pts[Math.max(0, j - 1)], pts[j]);
    const turn = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z)));
    const dist = Math.max(1, path.cum[j] - path.cum[i]);
    let v = turn > 0.05 ? Math.min(cruise, Math.sqrt(A_LAT * dist / turn)) : cruise;
    if (Math.abs(p.x - COURSE.bump.x) < 5 && Math.abs(p.z - COURSE.bump.z) < 5) v = Math.min(v, 2.2);
    return v;
  });
  if (stopAtEnd) vmax[n - 1] = 0;
  for (let i = n - 2; i >= 0; i--) {
    const ds = path.cum[i + 1] - path.cum[i];
    vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] ** 2 + 2 * BRAKE * ds));
  }
  return { ...path, vmax };
}

// ---- chunks -------------------------------------------------------------------------------------
function buildChunk(route: ExamRouteId, id: ChunkId): RoutePath {
  switch (id) {
    case 'entry': {
      const x = route === 'A' ? L.eastNB : L.eastSB;
      return toRoutePath(lanePath([{ x, z: COURSE.entrance[route].z + 2 }, { x, z: STOP_Z }]), 4, true);
    }
    case 'toOvalo':
      if (route === 'A') {
        return toRoutePath(join(
          lanePath([{ x: L.eastNB, z: STOP_Z }, { x: L.eastNB, z: L.topWB, r: R.RC + OWN }, { x: 46, z: L.topWB }]),
          ovalo('E', 'S'),
        ), 9);
      }
      return toRoutePath(join(
        lanePath([
          { x: L.eastSB, z: STOP_Z }, { x: L.eastSB, z: L.bottomWB, r: 7 },
          { x: L.westNB, z: L.bottomWB, r: R.RC - OWN }, { x: L.westNB, z: R.ZB - R.RC },
        ]),
        ovalo('S', 'S'),
      ), 8);
    case 'toDiag':
      return toRoutePath(lanePath([
        { x: L.westSB, z: 38 }, { x: L.westSB, z: L.bottomEB, r: R.RC + OWN },
        { x: L.innerNB, z: L.bottomEB, r: 7 }, { x: L.innerNB, z: L.aisleEB, r: 5 }, P_AISLE,
      ]), 8);
    case 'toOvalo2':
      return toRoutePath(join(
        lanePath([P_AFTER, { x: L.eastNB, z: L.aisleEB, r: 8 }, { x: L.eastNB, z: L.topWB, r: R.RC + OWN }, { x: 46, z: L.topWB }]),
        ovalo('E', 'E'),
      ), 8);
    case 'toParallel':
      return toRoutePath(lanePath([
        { x: 38, z: L.topEB }, { x: L.eastSB, z: L.topEB, r: R.RC - OWN }, { x: L.eastSB, z: L.aisleWB, r: 5 }, P_PAR,
      ]), 8);
    case 'finish':
      return toRoutePath(lanePath([
        P_PAR_END, { x: L.innerSB, z: L.aisleWB, r: 7 }, { x: L.innerSB, z: L.bottomEB, r: 7 },
        { x: L.salidaSB, z: L.bottomEB, r: 5 }, { x: L.salidaSB, z: R.ZEND - 1 },
      ]), 7, true);
  }
}

let cache: Record<string, RoutePath> = {};

// Drops the cached paths; call after (re)building the course, since the óvalo parts depend on RB.
export function resetExamRoutes(): void { cache = {}; }

export function examChunk(route: ExamRouteId, id: ChunkId): RoutePath {
  const key = `${route}:${id}`;
  return cache[key] ?? (cache[key] = buildChunk(route, id));
}

// ---- parking manoeuvres -------------------------------------------------------------------------
// `bay`: the leg is part of parking in that bay; `parked`: it ends with the car parked in it;
// `startsInBay`: it pulls out of the bay, which waits for a gap in the traffic first;
// `clearance`: don't start the leg while the player is within that many metres (backing out).
export interface Leg {
  path: RoutePath; reverse: boolean; dwell: number;
  bay?: string; parked?: boolean; startsInBay?: boolean; clearance?: number;
}

// Diagonal bay k: along the aisle, nose in (south-east), wait, back out onto the lane and carry on.
export function diagInPath(k: number, from: Pt = P_AISLE): Pt[] {
  const cx = COURSE.diagonal.bayCx(k);
  const onLane = { x: cx - (DIAG_Z - L.aisleEB), z: L.aisleEB, r: 5 }; // where the bay's axis crosses the lane
  const B = { x: cx + DIAG_DIR.x * 0.3, z: DIAG_Z + DIAG_DIR.z * 0.3 };
  return lanePath([from, onLane, B]);
}

// `dwell`: how long the car stays parked.
export function diagLegs(k: number | null, dwell = 12): Leg[] {
  if (k === null) return [{ path: toRoutePath(join([P_AISLE], line(P_AISLE, P_AFTER)), 8), reverse: false, dwell: 0 }];
  const cx = COURSE.diagonal.bayCx(k);
  const A = { x: cx - (DIAG_Z - L.aisleEB) - 2.1, z: L.aisleEB }; // back on the lane where the curve meets it
  const inPts = diagInPath(k);
  const outPts = inPts.slice(inPts.findIndex(p => p.x >= A.x - 0.01)).reverse();
  outPts.push(A);
  const bay = `diag${k}`;
  return [
    { path: toRoutePath(inPts, 6, true), reverse: false, dwell, bay, parked: true },
    { path: toRoutePath(outPts, 1.6, true), reverse: true, dwell: 0.6, bay, startsInBay: true, clearance: 14 },
    { path: toRoutePath(join([A], line(A, P_AFTER)), 8), reverse: false, dwell: 0 },
  ];
}

// Parallel bay n: pass it, stop, reverse in against the kerb, wait, pull out and carry on. The
// curves straighten out early so the car slips in (and out) past whoever is parked either side.
export function parLegs(n: number | null, dwell = 12): Leg[] {
  if (n === null) return [{ path: toRoutePath(join([P_PAR], line(P_PAR, P_PAR_END)), 8), reverse: false, dwell: 0 }];
  const cx = COURSE.parallel.bayCx(n);
  const pre = { x: cx - 7, z: L.aisleWB };
  const bayPt = { x: cx, z: PAR_BAY_Z };
  const out = { x: cx - 11, z: L.aisleWB };
  const bay = `par${n}`;
  return [
    { path: toRoutePath(join([P_PAR], line(P_PAR, pre)), 6, true), reverse: false, dwell: 0.8, bay },
    { path: toRoutePath(join([pre], bezier(pre, { x: pre.x + 3.5, z: pre.z }, { x: cx - 1.5, z: bayPt.z }, bayPt, 16)), 1.5, true), reverse: true, dwell, bay, parked: true },
    { path: toRoutePath(join([bayPt], bezier(bayPt, { x: cx - 2.5, z: bayPt.z + 0.7 }, { x: out.x + 3.5, z: out.z }, out, 16)), 4), reverse: false, dwell: 0, bay, startsInBay: true },
    { path: toRoutePath(join([out], line(out, P_PAR_END)), 7), reverse: false, dwell: 0 },
  ];
}

// Which way the path turns within `window` metres after arc length `s`: -1 left, 1 right, 0 straight.
export function turnAhead(path: Path, s: number, window = 22): -1 | 0 | 1 {
  const { pts, cum } = path;
  let i = 0;
  while (i < pts.length - 1 && cum[i] < s) i++;
  for (; i < pts.length - 1 && cum[i] < s + window; i++) {
    let j = i + 1;
    while (j < pts.length - 1 && cum[j] - cum[i] < 3) j++;
    const a = norm(pts[i], pts[i + 1]), b = norm(pts[j - 1], pts[j]);
    const cross = a.x * b.z - a.z * b.x;
    if (Math.abs(cross) > 0.08) return cross < 0 ? -1 : 1;
  }
  return 0;
}

// Arc length of the point on `path` nearest (x, z) whose direction agrees with heading (hx, hz),
// searched from `from` onwards (a route that passes the same place twice keeps its place). Past
// either end it clamps to that end.
export function progressOn(path: Path, x: number, z: number, hx: number, hz: number, from = 0, span = Infinity): number {
  const { pts, cum } = path;
  let best = from, bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    if (cum[i + 1] < from - 2 || cum[i] > from + span) continue;
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
    if (dx * hx + dz * hz < 0) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const d = (a.x + dx * t - x) ** 2 + (a.z + dz * t - z) ** 2;
    if (d < bestD) { bestD = d; best = cum[i] + (cum[i + 1] - cum[i]) * t; }
  }
  return best;
}

export function vmaxAt(path: RoutePath, s: number): number {
  const { cum, vmax } = path;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return vmax[lo] + (vmax[hi] - vmax[lo]) * Math.max(0, Math.min(1, t));
}

// ---- the player's own paths (systems/examAutopilot.ts), for the bay they were sent to ----------
// Into diagonal bay k, from the óvalo's south exit.
export function playerDiagPath(k: number): RoutePath {
  const key = `playerDiag${k}`;
  return cache[key] ?? (cache[key] = toRoutePath(join(examChunk('A', 'toDiag').pts, diagInPath(k)), 8, true));
}
// Backed out of diagonal bay k onto the aisle, then on to the óvalo.
export function playerOvalo2Path(k: number): RoutePath {
  const key = `playerOvalo2${k}`;
  const A = { x: COURSE.diagonal.bayCx(k) - 12, z: L.aisleEB };
  return cache[key] ?? (cache[key] = toRoutePath(join([A], line(A, P_AFTER), examChunk('A', 'toOvalo2').pts), 8));
}
// Pulled out of parallel bay n onto the aisle, then out through SALIDA.
export function playerFinishPath(n: number): RoutePath {
  const key = `playerFinish${n}`;
  const A = { x: COURSE.parallel.bay(n).rearX + 4, z: L.aisleWB };
  return cache[key] ?? (cache[key] = toRoutePath(join([A], line(A, P_PAR_END), examChunk('A', 'finish').pts), 7, true));
}
