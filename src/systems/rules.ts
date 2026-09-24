import type * as CANNON from 'cannon-es';
import { CONFIG, PENALTIES, type Layout, type PenaltyCode } from '../config';
import { gameState } from '../state/gameState';
import { chassisBody } from '../entities/player';
import { LANE_X, ROAD_HALF_WIDTH } from '../world/road';
import { INTERSECTIONS } from '../world/intersections';
import { inSchoolZone } from '../world/schoolZone';
import { SPEED_BUMPS } from '../world/speedBumps';
import { controlState } from './input';
import { showToast } from '../game/hud';
import { playCrash } from './audio';
import { logEvent } from './debugLog';

const lastInfractionTime: Partial<Record<PenaltyCode, number>> = {};

// Each broken rule is tallied (not scored) — the end-of-run results dialog turns the tally
// into an itemized fine per rule plus a total (see screens/results.ts). Running up
// fines no longer ends the match; only the timer (or the finish button) does.
export function triggerInfraction(code: PenaltyCode): void {
  const now = performance.now() / 1000;
  const last = lastInfractionTime[code];
  if (last !== undefined && now - last < CONFIG.INFRACTION_COOLDOWN) {
    logEvent('INFRACTION_SKIPPED_COOLDOWN', { code, sinceLast: now - last });
    return;
  }
  lastInfractionTime[code] = now;

  const p = PENALTIES[code];
  const count = (gameState.infractionCounts[code] || 0) + 1;
  gameState.infractionCounts[code] = count;
  logEvent('INFRACTION', { code, fine: p.fine, count });
  showToast(p.label, `Multa: S/ ${p.fine}`);
}

// ---- Lane-change (G10) tracking ----
function nearestLaneIndex(x: number): number {
  let best = -1, bestD = Infinity;
  LANE_X.forEach((lx, i) => { const d = Math.abs(x - lx); if (d < bestD) { bestD = d; best = i; } });
  return bestD < CONFIG.LANE_WIDTH * 0.55 ? best : -1;
}

let prevLaneIndex = -1;
let prevPlayerZ = 0;
let urbanSpeedLimit = CONFIG.URBAN_SPEED_LIMIT;
let scenarioLayout: Layout = 'line';

// Must run once after the player body exists (game/session.ts calls this right after createPlayer()).
export function initRules(scenario?: { speedLimit?: number; layout?: Layout } | null): void {
  prevLaneIndex = nearestLaneIndex(chassisBody.position.x);
  prevPlayerZ = chassisBody.position.z;
  urbanSpeedLimit = scenario?.speedLimit ?? CONFIG.URBAN_SPEED_LIMIT;
  scenarioLayout = scenario?.layout ?? 'line';
}

export function checkLaneChangeRule(): void {
  const curLane = nearestLaneIndex(chassisBody.position.x);
  if (curLane !== -1 && prevLaneIndex !== -1 && curLane !== prevLaneIndex) {
    // Bug fix: this used to also require the signal to have been switched on within the last
    // 4s (`now - lastSignalOnTime < 4`), so a signal turned on early — e.g. while waiting a
    // few seconds for a gap in traffic before actually merging, which is the *correct* way to
    // signal — read as "not signaled" the moment that window elapsed, even though the blinker
    // was still visibly on. What actually matters is whether the signal is on *at the moment
    // of the lane change*, regardless of when it was switched on.
    const signaled = controlState.signalLeft || controlState.signalRight;
    logEvent('LANE_CHANGE_CHECK', {
      fromLane: prevLaneIndex, toLane: curLane,
      signalLeft: controlState.signalLeft, signalRight: controlState.signalRight,
      signaledSinceSec: (performance.now() / 1000 - controlState.lastSignalOnTime),
      signaled, ticketed: !signaled,
    });
    if (!signaled) triggerInfraction('G10');
  }
  if (curLane !== -1) prevLaneIndex = curLane;
}

// ---- Wrong-way driving (M12) ----
// Only meaningful on the single-corridor scenarios, where negative-x lanes are always the
// oncoming direction (see world/road.ts). The grid scenario's streets carry both directions
// side-by-side per block rather than a fixed left/right split, so it's skipped there.
export function checkWrongWayRule(): void {
  if (scenarioLayout !== 'line') return;
  const x = chassisBody.position.x;
  const speedKmh = chassisBody.velocity.length() * 3.6;
  if (x < -0.5 && x > -ROAD_HALF_WIDTH && speedKmh > CONFIG.WRONG_WAY_SPEED_THRESHOLD) {
    triggerInfraction('M12');
  }
}

// ---- Speed limit (M20) ----
export function checkSpeedRule(): void {
  const speedKmh = chassisBody.velocity.length() * 3.6;
  const limit = inSchoolZone(chassisBody.position.z) ? CONFIG.SCHOOL_SPEED_LIMIT : urbanSpeedLimit;
  if (speedKmh > limit + 6) triggerInfraction('M20');
}

// ---- Red light crossing (G28) ----
export function checkRedLightRule(): void {
  const z = chassisBody.position.z;
  const speedKmh = chassisBody.velocity.length() * 3.6;
  INTERSECTIONS.forEach(inter => {
    if (!inter.triggeredRedCross && prevPlayerZ > inter.z && z <= inter.z && inter.state === 'RED' && speedKmh > 8) {
      triggerInfraction('G28');
      inter.triggeredRedCross = true;
    }
  });
  prevPlayerZ = z;
}

// ---- Speed bump damage (custom BUMP code) ----
export function checkSpeedBumpRule(): void {
  const z = chassisBody.position.z;
  const speedKmh = chassisBody.velocity.length() * 3.6;
  SPEED_BUMPS.forEach(b => {
    if (!b.triggered && Math.abs(z - b.z) < 1.2 && speedKmh > 20) {
      triggerInfraction('BUMP');
      b.triggered = true;
    }
    if (Math.abs(z - b.z) > 6) b.triggered = false; // allow re-trigger on a later pass
  });
}

// ---- Collision detection ----
// What the chassis ran into decides what it costs:
//  - a curb / sidewalk: the curb collider doesn't push back (see world/road.ts), so the car just
//    drives up and over it — a real crash (speed straight into it above CONFIG.CURB_CRASH_SPEED_KMH)
//    is only a ticket. Slower touches are harmless while driving, but in the parking scenarios
//    even a scrape is a fault.
//  - a parked car (parking scenarios): any touch is a fault, however gentle.
//  - a pedestrian: a fine only if the car itself is moving (they can't push it, and walking into a stopped car isn't a crash).
//  - other traffic: a fine above a small impact speed.
export function setupCollisionListener(): void {
  chassisBody.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
    const other = e.body;
    const data = other.userData;
    if (!data) return;
    const impact = e.contact.getImpactVelocityAlongNormal ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 1;

    if (data.isCurb) {
      if (impact * 3.6 > CONFIG.CURB_CRASH_SPEED_KMH) { playCrash(impact); triggerInfraction('CURB_CRASH'); }
      else if (scenarioLayout === 'parking' && !data.touchOk && impact > 0.1) triggerInfraction('PARK_CURB');
    } else if (data.isParked) {
      if (impact > 0.1) { playCrash(impact); triggerInfraction('PARK_CAR'); }
    } else if (data.type === 'pedestrian') {
      // Pedestrians never push a car (see entities/pedestrians.ts), and one that walks into a stopped or crawling car
      // is not the driver's crash: only a car that is really moving runs somebody over.
      const speed = chassisBody.velocity.length();
      if (speed > 1) { data.onHit?.(); triggerInfraction('COLLISION'); playCrash(Math.max(impact, speed)); }
    } else if (data.isPenalized) {
      if (impact > 0.8) { triggerInfraction('COLLISION'); playCrash(impact); }
    }
  });
}
