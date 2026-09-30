import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config';
import { rng, rand, choice } from '../utils/rng';
import { pickDriverProfile, PROFILE_SPEED, PROFILE_GAP, type DriverProfile } from '../entities/drivers';
import type { TrafficType } from '../entities/aiVehicles';
import type { ResolvedScenario } from '../state/settings';
import { addTrafficLight, resetTrafficLights, phaseCycles, trafficLightAhead, mustStopFor, HEADING_DIR, type Heading } from './trafficLights';
import { resetCrosswalks, addCrosswalk, includeCandidate, flushZebras, occupiedCrosswalkGap } from './crosswalks';
import { scene } from '../core/scene';
import { world, propMaterial } from '../core/physics';
import { box } from '../assets/primitives';
import { buildGround, buildStreet, barrier, scatterBlockBuildings, type Street } from './streetKit';
import { buildSedan, buildCombi, buildMototaxi, type VehicleGroup } from '../assets/vehicles';
import { chassisBody } from '../entities/player';
import { distanceBetween } from '../utils/cannonThree';

// "Ciudad con Giros" scenario: a real, physically-drivable street grid (unlike the decorative
// cross streets on the single-avenue scenarios) — curbs are segmented with gaps at every
// intersection so the player can actually turn onto a cross street, each intersection runs
// its own 4-way light cycle, and traffic/AI use both axes.
let ROAD_HALF_WIDTH_GRID = 0;

interface GridIntersection { x: number; z: number }
interface GridAi {
  mesh: VehicleGroup;
  body: CANNON.Body;
  type: TrafficType;
  street: Street;
  dir: number;
  speed: number;
  baseSpeed: number;
  profile: DriverProfile;
  isBadDriver: boolean;
  half: CANNON.Vec3;
  prevPos: THREE.Vector3;
}

let AVENUE_XS: number[] = [];
let STREET_ZS: number[] = [];
const STREETS: Street[] = [];
export const GRID_INTERSECTIONS: GridIntersection[] = [];
const gridAiPool: GridAi[] = [];
let aiTargetCount = 10;
let scenarioRef: { badDrivers?: number; goodDrivers?: number } = {};

function buildIntersection(x: number, z: number): void {
  const gapHalf = ROAD_HALF_WIDTH_GRID + CONFIG.SIDEWALK_WIDTH;

  // Stop lines, one per approach (0.115 sits just above the lane markings at markY≈0.105/0.11
  // so they don't z-fight where a stop line crosses a dashed divider or edge line)
  const stopY = 0.115;
  const nsStop1 = box(ROAD_HALF_WIDTH_GRID, 0.02, 0.3, 0xffffff); nsStop1.position.set(x + ROAD_HALF_WIDTH_GRID / 2, stopY, z + gapHalf - 0.5); scene.add(nsStop1);
  const nsStop2 = box(ROAD_HALF_WIDTH_GRID, 0.02, 0.3, 0xffffff); nsStop2.position.set(x - ROAD_HALF_WIDTH_GRID / 2, stopY, z - gapHalf + 0.5); scene.add(nsStop2);
  const ewStop1 = box(0.3, 0.02, ROAD_HALF_WIDTH_GRID, 0xffffff); ewStop1.position.set(x - gapHalf + 0.5, stopY, z + ROAD_HALF_WIDTH_GRID / 2); scene.add(ewStop1);
  const ewStop2 = box(0.3, 0.02, ROAD_HALF_WIDTH_GRID, 0xffffff); ewStop2.position.set(x + gapHalf - 0.5, stopY, z - ROAD_HALF_WIDTH_GRID / 2); scene.add(ewStop2);

  // one light per approach, on the right-hand verge before its stop line; N/S share a phase, E/W the other
  const cycles = phaseCycles(2, 7, 2, -rand(0, 9));
  (['N', 'S', 'E', 'W'] as Heading[]).forEach(h => {
    const d = HEADING_DIR[h], rx = -d.z, rz = d.x;
    const back = gapHalf - 0.5, side = ROAD_HALF_WIDTH_GRID / 2;
    addTrafficLight({
      heading: h, halfWidth: ROAD_HALF_WIDTH_GRID / 2, cycle: cycles[h === 'N' || h === 'S' ? 0 : 1],
      stop: { x: x - d.x * back + rx * side, z: z - d.z * back + rz * side },
      pole: { x: x - d.x * (gapHalf - 0.3) + rx * (gapHalf - 0.3), z: z - d.z * (gapHalf - 0.3) + rz * (gapHalf - 0.3) },
    });
  });

  GRID_INTERSECTIONS.push({ x, z });
}

export function buildGridCity(scenario: ResolvedScenario): { x: number; y: number; z: number; rotY: number } {
  const N = scenario.blocks ?? 3;
  const spacing = scenario.blockSize ?? 150;
  ROAD_HALF_WIDTH_GRID = scenario.laneCountPerSide * CONFIG.LANE_WIDTH;
  const half = (N - 1) / 2 * spacing;
  AVENUE_XS = Array.from({ length: N }, (_, i) => -half + i * spacing);
  STREET_ZS = Array.from({ length: N }, (_, i) => -60 - i * spacing);
  STREETS.length = 0; GRID_INTERSECTIONS.length = 0;
  resetTrafficLights();

  const margin = 70;
  const avenueLo = STREET_ZS[N - 1] - margin, avenueHi = STREET_ZS[0] + margin;
  const streetLo = AVENUE_XS[0] - margin, streetHi = AVENUE_XS[N - 1] + margin;

  buildGround((streetLo + streetHi) / 2, (avenueLo + avenueHi) / 2, streetHi - streetLo + 200, avenueHi - avenueLo + 200);

  AVENUE_XS.forEach(ax => STREETS.push(buildStreet('z', ax, avenueLo, avenueHi, scenario.laneCountPerSide, STREET_ZS)));
  STREET_ZS.forEach(sz => STREETS.push(buildStreet('x', sz, streetLo, streetHi, scenario.laneCountPerSide, AVENUE_XS)));
  AVENUE_XS.forEach(ax => STREET_ZS.forEach(sz => buildIntersection(ax, sz)));

  // Every street inside the grid connects through to another (no internal dead ends): only the
  // outermost perimeter stubs actually end. Cap them with a barrier, same as every other course
  // (tutorialCourse.ts, parkingLot.ts), so the grid's edge reads as an intentional boundary
  // instead of asphalt trailing off into open ground.
  const barrierWidth = ROAD_HALF_WIDTH_GRID * 2 + 4;
  AVENUE_XS.forEach(ax => { barrier(ax, avenueLo - 1, barrierWidth, 2); barrier(ax, avenueHi + 1, barrierWidth, 2); });
  STREET_ZS.forEach(sz => { barrier(streetLo - 1, sz, 2, barrierWidth); barrier(streetHi + 1, sz, 2, barrierWidth); });

  // pedestrian crossings on the approaches to each intersection, beyond the stop lines
  resetCrosswalks();
  const walkHalf = ROAD_HALF_WIDTH_GRID + CONFIG.SIDEWALK_WIDTH - 0.3;
  GRID_INTERSECTIONS.forEach((inter, ii) => {
    const spots: Array<{ cx: number; cz: number; axis: 'x' | 'z' }> = [
      { cx: inter.x, cz: inter.z + 14, axis: 'x' }, { cx: inter.x, cz: inter.z - 14, axis: 'x' },
      { cx: inter.x + 14, cz: inter.z, axis: 'z' }, { cx: inter.x - 14, cz: inter.z, axis: 'z' },
    ];
    spots.forEach((s, si) => {
      if (includeCandidate(200 + ii * 4 + si, scenario.zebras)) addCrosswalk({ ...s, roadHalf: ROAD_HALF_WIDTH_GRID, walkHalf });
    });
  });
  flushZebras();

  // Simple low-poly filler buildings inside each block cell (between streets)
  for (let bi = -1; bi < N; bi++) {
    for (let bj = -1; bj < N; bj++) {
      const cx = bi === -1 ? AVENUE_XS[0] - spacing / 2 : bi === N - 1 ? AVENUE_XS[N - 1] + spacing / 2 : (AVENUE_XS[bi] + AVENUE_XS[bi + 1]) / 2;
      const cz = bj === -1 ? STREET_ZS[0] + spacing / 2 : bj === N - 1 ? STREET_ZS[N - 1] - spacing / 2 : (STREET_ZS[bj] + STREET_ZS[bj + 1]) / 2;
      scatterBlockBuildings(cx, cz, spacing, ROAD_HALF_WIDTH_GRID + CONFIG.SIDEWALK_WIDTH + 3);
    }
  }

  aiTargetCount = Math.round(scenario.aiTargetCount ?? 10);
  scenarioRef = scenario;
  gridAiPool.forEach(ai => { scene.remove(ai.mesh); world.removeBody(ai.body); });
  gridAiPool.length = 0;

  const spawnX = AVENUE_XS[Math.floor(N / 2)] + 0.5 * CONFIG.LANE_WIDTH;
  const spawnZ = avenueHi - 25;
  return { x: spawnX, y: 1.2, z: spawnZ, rotY: 0 };
}

// ---- Grid AI traffic: spawns on random avenue/street segments, respects red lights ----
const AI_TYPES: TrafficType[] = ['car', 'car', 'combi', 'mototaxi', 'mototaxi'];
const CAR_COLORS = [0xcc2b2b, 0x2e7d32, 0x455a64, 0xf9a825, 0x6a1b9a];

function spawnGridAi(): void {
  if (STREETS.length === 0) return;
  const street = choice(STREETS);
  const dir = choice([-1, 1]);
  const laneOffset = -0.5 * CONFIG.LANE_WIDTH * dir; // z-street: dir=-1 (south) sits on +X, see road.ts laneDir
  const type = choice(AI_TYPES);
  const profile = pickDriverProfile(scenarioRef);
  const isBadDriver = profile === 'bad';

  let mesh: VehicleGroup, speed: number, half: CANNON.Vec3;
  const opts = { bakeWheels: true }; // traffic never spins its wheels (see assets/vehicles.ts)
  if (type === 'combi') { mesh = buildCombi(0x2266aa, opts); speed = rand(5, 8); half = new CANNON.Vec3(1.05, 0.85, 2.8); }
  else if (type === 'mototaxi') { mesh = buildMototaxi(choice([0xffcc00, 0x43a047, 0x1e88e5]), opts); speed = rand(4, 6); half = new CANNON.Vec3(0.65, 0.6, 1.1); }
  else { mesh = buildSedan(choice(CAR_COLORS), opts); speed = rand(6, 10); half = new CANNON.Vec3(0.95, 0.55, 2.2); }

  const along = rand(street.lo + 15, street.hi - 15);
  // Right-hand-traffic convention: on a Z-street the -Z (south-bound) lane sits on +X; on an
  // X-street the +X (east-bound) lane sits on +Z (see buildStreet / road.ts laneDir notes).
  let x: number, z: number, rotY: number;
  if (street.orientation === 'z') { x = street.fixed + laneOffset; z = along; rotY = dir < 0 ? 0 : Math.PI; }
  else { x = along; z = street.fixed + 0.5 * CONFIG.LANE_WIDTH * dir; rotY = dir > 0 ? -Math.PI / 2 : Math.PI / 2; }

  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY;
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: propMaterial });
  body.addShape(new CANNON.Box(half));
  body.position.set(x, half.y, z);
  body.userData = { isPenalized: true, type: 'ai-' + type };
  world.addBody(body);

  speed *= PROFILE_SPEED[profile];
  gridAiPool.push({ mesh, body, type, street, dir, speed, baseSpeed: speed, profile, isBadDriver, half, prevPos: new THREE.Vector3(x, 0, z) });
}

// Nearest vehicle ahead of `ai` in its own lane on its street (cars travelling the same way, or
// the player), as { gap, speed }.
function leaderAhead(ai: GridAi): { gap: number; speed: number } | null {
  const s = ai.street, pos = ai.mesh.position;
  const alongAxis = (p: { x: number; z: number }): number => (s.orientation === 'z' ? p.z : p.x);
  const lateral = (p: { x: number; z: number }): number => Math.abs(s.orientation === 'z' ? p.x - pos.x : p.z - pos.z);
  let best = null as { gap: number; speed: number } | null;
  const consider = (p: { x: number; z: number }, halfLen: number, speed: number): void => {
    if (lateral(p) > 1.9) return;
    const along = (alongAxis(p) - alongAxis(pos)) * ai.dir;
    if (along <= 0 || along > 40) return;
    const gap = along - ai.half.z - halfLen;
    if (!best || gap < best.gap) best = { gap, speed };
  };
  gridAiPool.forEach(o => { if (o !== ai && o.street === s && o.dir === ai.dir) consider(o.mesh.position, o.half.z, o.speed); });
  consider(chassisBody.position, 2.2, chassisBody.velocity.length());
  return best;
}

export function updateGridAi(dt: number): void {
  for (let i = gridAiPool.length - 1; i >= 0; i--) {
    const ai = gridAiPool[i];
    const s = ai.street;
    const pos = ai.mesh.position;

    const ahead = s.orientation === 'z' ? trafficLightAhead(pos.x, pos.z, 0, ai.dir) : trafficLightAhead(pos.x, pos.z, ai.dir, 0);
    let targetSpeed = ai.baseSpeed;
    if (ahead && mustStopFor(ahead.light, ahead.dist) && ahead.dist < 16 && !(ai.isBadDriver && rng() < 0.15)) {
      targetSpeed = THREE.MathUtils.clamp((ahead.dist - 1.5) / 14, 0, 1) * ai.baseSpeed;
    }
    // stop short of a zebra with pedestrians on it (bad drivers don't)
    if (ai.profile !== 'bad') {
      const zgap = occupiedCrosswalkGap(pos.x, pos.z, s.orientation === 'z' ? 0 : ai.dir, s.orientation === 'z' ? ai.dir : 0, ai.half.z);
      if (zgap < Infinity) targetSpeed = Math.min(targetSpeed, THREE.MathUtils.clamp(zgap / 8, 0, 1) * ai.baseSpeed);
    }
    // keep a gap to the vehicle ahead in the same lane: another car, or the player
    const lead = leaderAhead(ai);
    if (lead) {
      const [standing, headway] = PROFILE_GAP[ai.profile];
      const safe = standing + ai.speed * headway;
      if (lead.gap < safe) targetSpeed = Math.min(targetSpeed, lead.speed * THREE.MathUtils.clamp((lead.gap - 2) / (safe - 2), 0, 1));
    }
    ai.speed = THREE.MathUtils.lerp(ai.speed, Math.max(0, targetSpeed), 0.06);
    if (lead && lead.gap < 1.5) ai.speed = Math.min(ai.speed, lead.speed);

    if (s.orientation === 'z') pos.z += ai.dir * ai.speed * dt;
    else pos.x += ai.dir * ai.speed * dt;

    ai.body.position.set(pos.x, ai.body.position.y, pos.z);
    ai.body.velocity.set((pos.x - ai.prevPos.x) / dt, 0, (pos.z - ai.prevPos.z) / dt);
    ai.prevPos.copy(pos);

    const outOfBounds = s.orientation === 'z' ? (pos.z < s.lo - 5 || pos.z > s.hi + 5) : (pos.x < s.lo - 5 || pos.x > s.hi + 5);
    const farFromPlayer = distanceBetween(chassisBody.position, pos) > 260;
    if (outOfBounds || farFromPlayer) {
      scene.remove(ai.mesh);
      world.removeBody(ai.body);
      gridAiPool.splice(i, 1);
    }
  }
  while (gridAiPool.length < aiTargetCount) spawnGridAi();
}
