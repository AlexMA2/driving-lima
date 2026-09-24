import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config';
import { rng, rand, choice } from '../utils/rng';
import { pickDriverProfile, PROFILE_SPEED, PROFILE_GAP, type DriverProfile } from '../entities/drivers';
import type { TrafficType } from '../entities/aiVehicles';
import type { ResolvedScenario } from '../state/settings';
import type { LightState } from './intersections';
import { resetCrosswalks, addCrosswalk, includeCandidate, flushZebras, occupiedCrosswalkGap } from './crosswalks';
import { scene } from '../core/scene';
import { world, propMaterial } from '../core/physics';
import { box } from '../assets/primitives';
import { buildGround, buildStreet, updateLightMesh, scatterBlockBuildings, type Street } from './streetKit';
import { buildTrafficLightPole, type TrafficLightLamps } from '../assets/props';
import { buildSedan, buildCombi, buildMototaxi, type VehicleGroup } from '../assets/vehicles';
import { chassisBody } from '../entities/player';
import { triggerInfraction } from '../systems/rules';
import { distanceBetween } from '../utils/cannonThree';

// "Ciudad con Giros" scenario: a real, physically-drivable street grid (unlike the decorative
// cross streets on the single-avenue scenarios) — curbs are segmented with gaps at every
// intersection so the player can actually turn onto a cross street, each intersection runs
// its own 4-way light cycle, and traffic/AI use both axes.
let ROAD_HALF_WIDTH_GRID = 0;
type GridPhase = 'NS_GREEN' | 'NS_YELLOW' | 'EW_GREEN' | 'EW_YELLOW';

interface GridIntersection {
  x: number;
  z: number;
  phase: GridPhase;
  timer: number;
  nsLights: TrafficLightLamps;
  ewLights: TrafficLightLamps;
  firedNS: boolean;
  firedEW: boolean;
}

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
let prevPlayerPos: CANNON.Vec3 | null = null;

function buildIntersection(x: number, z: number): void {
  const gapHalf = ROAD_HALF_WIDTH_GRID + CONFIG.SIDEWALK_WIDTH;

  // Stop lines, one per approach (0.115 sits just above the lane markings at markY≈0.105/0.11
  // so they don't z-fight where a stop line crosses a dashed divider or edge line)
  const stopY = 0.115;
  const nsStop1 = box(ROAD_HALF_WIDTH_GRID, 0.02, 0.3, 0xffffff); nsStop1.position.set(x + ROAD_HALF_WIDTH_GRID / 2, stopY, z + gapHalf - 0.5); scene.add(nsStop1);
  const nsStop2 = box(ROAD_HALF_WIDTH_GRID, 0.02, 0.3, 0xffffff); nsStop2.position.set(x - ROAD_HALF_WIDTH_GRID / 2, stopY, z - gapHalf + 0.5); scene.add(nsStop2);
  const ewStop1 = box(0.3, 0.02, ROAD_HALF_WIDTH_GRID, 0xffffff); ewStop1.position.set(x - gapHalf + 0.5, stopY, z + ROAD_HALF_WIDTH_GRID / 2); scene.add(ewStop1);
  const ewStop2 = box(0.3, 0.02, ROAD_HALF_WIDTH_GRID, 0xffffff); ewStop2.position.set(x + gapHalf - 0.5, stopY, z - ROAD_HALF_WIDTH_GRID / 2); scene.add(ewStop2);

  const poleNS = buildTrafficLightPole(true);
  poleNS.position.set(x + gapHalf - 0.3, 0, z + gapHalf - 0.3);
  poleNS.rotation.y = Math.PI;
  scene.add(poleNS);

  const poleEW = buildTrafficLightPole();
  poleEW.position.set(x - gapHalf + 0.3, 0, z + gapHalf - 0.3);
  poleEW.rotation.y = -Math.PI / 2;
  scene.add(poleEW);

  GRID_INTERSECTIONS.push({
    x, z, phase: 'NS_GREEN', timer: rand(0, 4),
    nsLights: poleNS.userData.lights as TrafficLightLamps, ewLights: poleEW.userData.lights as TrafficLightLamps,
    firedNS: false, firedEW: false,
  });
}

const PHASE_DURATION: Record<GridPhase, number> = { NS_GREEN: 7, NS_YELLOW: 2, EW_GREEN: 7, EW_YELLOW: 2 };
function nextPhase(p: GridPhase): GridPhase { return p === 'NS_GREEN' ? 'NS_YELLOW' : p === 'NS_YELLOW' ? 'EW_GREEN' : p === 'EW_GREEN' ? 'EW_YELLOW' : 'NS_GREEN'; }

export function updateGridTrafficLights(dt: number): void {
  GRID_INTERSECTIONS.forEach(inter => {
    inter.timer += dt;
    if (inter.timer >= PHASE_DURATION[inter.phase]) { inter.timer = 0; inter.phase = nextPhase(inter.phase); }
    const nsState: LightState = inter.phase === 'NS_GREEN' ? 'GREEN' : inter.phase === 'NS_YELLOW' ? 'YELLOW' : 'RED';
    const ewState: LightState = inter.phase === 'EW_GREEN' ? 'GREEN' : inter.phase === 'EW_YELLOW' ? 'YELLOW' : 'RED';
    updateLightMesh(inter.nsLights, nsState);
    updateLightMesh(inter.ewLights, ewState);
  });
}

export function buildGridCity(scenario: ResolvedScenario): { x: number; y: number; z: number; rotY: number } {
  const N = scenario.blocks ?? 3;
  const spacing = scenario.blockSize ?? 150;
  ROAD_HALF_WIDTH_GRID = scenario.laneCountPerSide * CONFIG.LANE_WIDTH;
  const half = (N - 1) / 2 * spacing;
  AVENUE_XS = Array.from({ length: N }, (_, i) => -half + i * spacing);
  STREET_ZS = Array.from({ length: N }, (_, i) => -60 - i * spacing);
  STREETS.length = 0; GRID_INTERSECTIONS.length = 0;

  const margin = 70;
  const avenueLo = STREET_ZS[N - 1] - margin, avenueHi = STREET_ZS[0] + margin;
  const streetLo = AVENUE_XS[0] - margin, streetHi = AVENUE_XS[N - 1] + margin;

  buildGround((streetLo + streetHi) / 2, (avenueLo + avenueHi) / 2, streetHi - streetLo + 200, avenueHi - avenueLo + 200);

  AVENUE_XS.forEach(ax => STREETS.push(buildStreet('z', ax, avenueLo, avenueHi, scenario.laneCountPerSide, STREET_ZS)));
  STREET_ZS.forEach(sz => STREETS.push(buildStreet('x', sz, streetLo, streetHi, scenario.laneCountPerSide, AVENUE_XS)));
  AVENUE_XS.forEach(ax => STREET_ZS.forEach(sz => buildIntersection(ax, sz)));

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
  prevPlayerPos = null;

  const spawnX = AVENUE_XS[Math.floor(N / 2)] + 0.5 * CONFIG.LANE_WIDTH;
  const spawnZ = avenueHi - 25;
  return { x: spawnX, y: 1.2, z: spawnZ, rotY: 0 };
}

// ---- Grid AI traffic: spawns on random avenue/street segments, respects red lights ----
const AI_TYPES: TrafficType[] = ['car', 'car', 'combi', 'mototaxi', 'mototaxi'];
const CAR_COLORS = [0xcc2b2b, 0x2e7d32, 0x455a64, 0xf9a825, 0x6a1b9a];

function nearestIntersectionAhead(x: number, z: number, orientation: 'z' | 'x', dir: number): { inter: GridIntersection; dist: number } | null {
  let best = null as GridIntersection | null, bestD = Infinity;
  GRID_INTERSECTIONS.forEach(inter => {
    const d = orientation === 'z' ? dir * (inter.z - z) : dir * (inter.x - x);
    const lateral = orientation === 'z' ? Math.abs(inter.x - x) : Math.abs(inter.z - z);
    if (d > 0 && d < 60 && lateral < 3) { if (d < bestD) { bestD = d; best = inter; } }
  });
  return best ? { inter: best, dist: bestD } : null;
}

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

    const ahead = nearestIntersectionAhead(pos.x, pos.z, s.orientation, ai.dir);
    let targetSpeed = ai.baseSpeed;
    if (ahead) {
      const relevantState = s.orientation === 'z'
        ? (ahead.inter.phase.startsWith('NS') ? ahead.inter.phase.split('_')[1] : 'RED')
        : (ahead.inter.phase.startsWith('EW') ? ahead.inter.phase.split('_')[1] : 'RED');
      if (relevantState !== 'GREEN' && ahead.dist < 22 && !(ai.isBadDriver && rng() < 0.15)) {
        targetSpeed = THREE.MathUtils.clamp((ahead.dist - 8) / 14, 0, 1) * ai.baseSpeed;
      }
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

// Approximate red-light check: fires if the player crosses an intersection's stop threshold
// while that axis is red. Uses straight-line crossing detection, so it's most reliable when
// approaching along one axis (the common case) rather than mid-turn.
export function checkGridRedLight(speedKmh: number): void {
  const pos = chassisBody.position;
  if (!prevPlayerPos) { prevPlayerPos = pos.clone(); return; }
  const prev = prevPlayerPos;
  GRID_INTERSECTIONS.forEach(inter => {
    const nearX = Math.abs(pos.x - inter.x) < ROAD_HALF_WIDTH_GRID + 1;
    const nearZ = Math.abs(pos.z - inter.z) < ROAD_HALF_WIDTH_GRID + 1;

    if (nearX && prev.z > inter.z && pos.z <= inter.z) {
      if (!inter.phase.startsWith('NS') && speedKmh > 8 && !inter.firedNS) { triggerInfraction('G28'); inter.firedNS = true; }
    }
    if (nearZ && ((prev.x < inter.x && pos.x >= inter.x) || (prev.x > inter.x && pos.x <= inter.x))) {
      if (!inter.phase.startsWith('EW') && speedKmh > 8 && !inter.firedEW) { triggerInfraction('G28'); inter.firedEW = true; }
    }
    if (!nearX) inter.firedNS = false;
    if (!nearZ) inter.firedEW = false;
  });
  prevPlayerPos.copy(pos);
}
