import { scene } from '../core/scene';
import { buildTrafficLightPole, type TrafficLightLamps } from '../assets/props';

// The one semáforo every layout uses (the avenue's intersections, the grid's crossings, the
// tutorial's T-junction, the exam circuit): a pole standing on the right-hand verge of the lanes
// it controls, its arm reaching over them and its lamps facing the drivers, a stop line it guards,
// and either a timed cycle or a state set by hand. The same object answers "what does the light
// ahead of me show?" for AI traffic and "did someone just cross on red?" for the rules, so a light
// behaves the same everywhere it appears.
//
// World axes: x east, z south (north is -Z), right-hand traffic.

export type LightState = 'GREEN' | 'YELLOW' | 'RED';
export type Heading = 'N' | 'S' | 'E' | 'W';

export const HEADING_DIR: Record<Heading, { x: number; z: number }> = {
  N: { x: 0, z: -1 }, S: { x: 0, z: 1 }, E: { x: 1, z: 0 }, W: { x: -1, z: 0 },
};
// The pole is built for northbound traffic (see buildTrafficLightPole); this turns it to face the others.
const HEADING_ROT: Record<Heading, number> = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };

// A repeating cycle: green from `start` for `green` seconds, then `yellow`, then red until the
// period wraps. Lights sharing a period and staggered starts make up one junction's phases.
export interface LightCycle { period: number; start: number; green: number; yellow: number }

export interface TrafficLight {
  heading: Heading;
  dx: number; dz: number;       // direction of the traffic it controls
  stopX: number; stopZ: number; // centre of its stop line, across the lanes it controls
  halfWidth: number;            // half the width of those lanes
  pole: { x: number; z: number };
  cycle: LightCycle | null;     // null: set by hand with setTrafficLight()
  state: LightState;
  lamps: TrafficLightLamps;
  fired: boolean;               // red-light run already ticketed for the current approach
}

export const TRAFFIC_LIGHTS: TrafficLight[] = [];
let clock = 0;

// Every layout that builds lights calls this first, so a new session never inherits the last one's.
export function resetTrafficLights(): void {
  TRAFFIC_LIGHTS.length = 0;
  clock = 0;
}

// `n` phases that take turns: each gets `green` then `yellow`, while all the others are red.
export function phaseCycles(n: number, green: number, yellow: number, start = 0): LightCycle[] {
  const period = n * (green + yellow);
  return Array.from({ length: n }, (_, i) => ({ period, start: start + i * (green + yellow), green, yellow }));
}

function cycleState(c: LightCycle, t: number): LightState {
  const u = (((t - c.start) % c.period) + c.period) % c.period;
  return u < c.green ? 'GREEN' : u < c.green + c.yellow ? 'YELLOW' : 'RED';
}

function paint(L: TrafficLightLamps, state: LightState): void {
  L.red.material.emissive.set(state === 'RED' ? 0xff0000 : 0x000000);
  L.red.material.color.set(state === 'RED' ? 0xff2222 : 0x550000);
  L.yellow.material.emissive.set(state === 'YELLOW' ? 0xffaa00 : 0x000000);
  L.yellow.material.color.set(state === 'YELLOW' ? 0xffcc33 : 0x554400);
  L.green.material.emissive.set(state === 'GREEN' ? 0x00ff00 : 0x000000);
  L.green.material.color.set(state === 'GREEN' ? 0x33ff33 : 0x004d00);
}

export interface TrafficLightSpec {
  heading: Heading;
  stop: { x: number; z: number };   // centre of the stop line across the controlled lanes
  halfWidth: number;                // half the width of those lanes
  verge?: number;                   // pole distance beyond the lanes' right edge (default 0.8)
  pole?: { x: number; z: number };  // explicit pole position, when the verge rule doesn't fit
  cycle?: LightCycle | null;        // omitted/null: manual
  state?: LightState;               // starting state of a manual light (default GREEN)
}

export function addTrafficLight(spec: TrafficLightSpec): TrafficLight {
  const d = HEADING_DIR[spec.heading];
  const rx = -d.z, rz = d.x; // the driver's right-hand side
  const side = spec.halfWidth + (spec.verge ?? 0.8);
  const pole = spec.pole ?? { x: spec.stop.x + rx * side - d.x * 0.5, z: spec.stop.z + rz * side - d.z * 0.5 };

  const g = buildTrafficLightPole();
  g.position.set(pole.x, 0, pole.z);
  g.rotation.y = HEADING_ROT[spec.heading];
  scene.add(g);

  const cycle = spec.cycle ?? null;
  const light: TrafficLight = {
    heading: spec.heading, dx: d.x, dz: d.z, stopX: spec.stop.x, stopZ: spec.stop.z, halfWidth: spec.halfWidth, pole,
    cycle, state: cycle ? cycleState(cycle, clock) : spec.state ?? 'GREEN',
    lamps: g.userData.lights as TrafficLightLamps, fired: false,
  };
  paint(light.lamps, light.state);
  TRAFFIC_LIGHTS.push(light);
  return light;
}

export function setTrafficLight(light: TrafficLight, state: LightState): void {
  if (light.state === state) return;
  light.state = state;
  paint(light.lamps, state);
}

// Advances every timed light. Call once per frame from the layout's update.
export function updateTrafficLights(dt: number): void {
  clock += dt;
  TRAFFIC_LIGHTS.forEach(l => { if (l.cycle) setTrafficLight(l, cycleState(l.cycle, clock)); });
}

// Signed distance past the stop line along the light's direction, and offset across its lanes.
function frame(l: TrafficLight, x: number, z: number): { along: number; lateral: number } {
  const px = x - l.stopX, pz = z - l.stopZ;
  return { along: px * l.dx + pz * l.dz, lateral: px * -l.dz + pz * l.dx };
}

// The nearest light controlling traffic heading (hx, hz) from (x, z), and the distance left to its
// stop line — for AI drivers deciding whether to stop.
export function trafficLightAhead(x: number, z: number, hx: number, hz: number, range = 40): { light: TrafficLight; dist: number } | null {
  let best: { light: TrafficLight; dist: number } | null = null;
  for (const l of TRAFFIC_LIGHTS) {
    if (l.dx * hx + l.dz * hz < 0.7) continue;
    const { along, lateral } = frame(l, x, z);
    const dist = -along;
    if (dist <= 0 || dist > range || Math.abs(lateral) > l.halfWidth + 0.5) continue;
    if (!best || dist < best.dist) best = { light: l, dist };
  }
  return best;
}

// Should a driver `dist` metres short of this light's line stop? Yellow only when there's room to.
export function mustStopFor(light: TrafficLight, dist: number): boolean {
  return light.state === 'RED' || (light.state === 'YELLOW' && dist > 4);
}

// A vehicle moved from (px, pz) to (x, z): the light it just crossed on red, if any (each light
// reports a given approach once, until the vehicle is well clear of it again).
export function redLightCrossed(px: number, pz: number, x: number, z: number): TrafficLight | null {
  let hit: TrafficLight | null = null;
  for (const l of TRAFFIC_LIGHTS) {
    const a = frame(l, px, pz), b = frame(l, x, z);
    if (Math.abs(b.along) > 20 || Math.abs(b.lateral) > l.halfWidth + 6) { l.fired = false; continue; }
    if (a.along < 0 && b.along >= 0 && Math.abs(b.lateral) < l.halfWidth + 0.5 && l.state === 'RED' && !l.fired) {
      l.fired = true;
      hit = l;
    }
  }
  return hit;
}
