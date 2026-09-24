import { CONFIG, PENALTIES } from '../config.js';
import { gameState } from '../state/gameState.js';
import { chassisBody } from '../entities/player.js';
import { LANE_X, ROAD_HALF_WIDTH } from '../world/road.js';
import { INTERSECTIONS } from '../world/intersections.js';
import { RB, ringInfo } from '../world/roundabout.js';
import { aiCirclingTowards } from '../entities/roundaboutAi.js';
import { inSchoolZone } from '../world/schoolZone.js';
import { SPEED_BUMPS } from '../world/speedBumps.js';
import { controlState } from './input.js';
import { showToast } from '../ui/hud.js';
import { playCrash } from './audio.js';
import { logEvent } from './debugLog.js';

const lastInfractionTime = {};

// Each broken rule is tallied (not scored) — the end-of-run results dialog turns the tally
// into an itemized fine per rule plus a total (see ui/hud.js's showResults()). Running up
// fines no longer ends the match; only the timer (or the finish button) does.
export function triggerInfraction(code) {
  const now = performance.now() / 1000;
  if (lastInfractionTime[code] !== undefined && now - lastInfractionTime[code] < CONFIG.INFRACTION_COOLDOWN) {
    logEvent('INFRACTION_SKIPPED_COOLDOWN', { code, sinceLast: now - lastInfractionTime[code] });
    return;
  }
  lastInfractionTime[code] = now;

  const p = PENALTIES[code];
  gameState.infractionCounts[code] = (gameState.infractionCounts[code] || 0) + 1;
  logEvent('INFRACTION', { code, fine: p.fine, count: gameState.infractionCounts[code] });
  showToast(p.label, `Multa: S/ ${p.fine}`);
}

// ---- Lane-change (G10) tracking ----
function nearestLaneIndex(x) {
  let best = -1, bestD = Infinity;
  LANE_X.forEach((lx, i) => { const d = Math.abs(x - lx); if (d < bestD) { bestD = d; best = i; } });
  return bestD < CONFIG.LANE_WIDTH * 0.55 ? best : -1;
}

let prevLaneIndex = -1;
let prevPlayerZ = 0;
let urbanSpeedLimit = CONFIG.URBAN_SPEED_LIMIT;
let scenarioLayout = 'line';

// Must run once after the player body exists (main.js calls this right after createPlayer()).
export function initRules(scenario) {
  prevLaneIndex = nearestLaneIndex(chassisBody.position.x);
  prevPlayerZ = chassisBody.position.z;
  urbanSpeedLimit = scenario?.speedLimit ?? CONFIG.URBAN_SPEED_LIMIT;
  scenarioLayout = scenario?.layout ?? 'line';
  onRing = false;
}

export function checkLaneChangeRule() {
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
// oncoming direction (see world/road.js). The grid scenario's streets carry both directions
// side-by-side per block rather than a fixed left/right split, so it's skipped there.
export function checkWrongWayRule() {
  if (scenarioLayout !== 'line') return;
  const x = chassisBody.position.x;
  const speedKmh = chassisBody.velocity.length() * 3.6;
  if (x < -0.5 && x > -ROAD_HALF_WIDTH && speedKmh > CONFIG.WRONG_WAY_SPEED_THRESHOLD) {
    triggerInfraction('M12');
  }
}

// ---- Roundabout (rotonda) rules ----
// Yield when stepping onto the ring while a circling car is about to reach the entry point,
// signal right when leaving it, and never circulate against the flow (clockwise).
let onRing = false;

export function checkRoundaboutRules() {
  const p = chassisBody.position, v = chassisBody.velocity;
  const { r, theta } = ringInfo(p.x, p.z);
  const speedKmh = v.length() * 3.6;
  const inside = r < RB.outerR - 0.3 && r > RB.innerR - 1;

  if (inside !== onRing) {
    if (inside) {
      if (speedKmh > 5 && aiCirclingTowards(theta)) triggerInfraction('RB_YIELD');
    } else if (r >= RB.outerR - 0.3 && speedKmh > 5 && !controlState.signalRight) {
      triggerInfraction('RB_SIGNAL');
    }
    onRing = inside;
  }

  if (inside && speedKmh > 8) {
    const alongFlow = v.x * Math.sin(theta) - v.z * Math.cos(theta); // counter-clockwise tangent
    if (alongFlow < -2) triggerInfraction('M12');
  }
}

// ---- Speed limit (M20) ----
export function checkSpeedRule() {
  const speedKmh = chassisBody.velocity.length() * 3.6;
  const limit = inSchoolZone(chassisBody.position.z) ? CONFIG.SCHOOL_SPEED_LIMIT : urbanSpeedLimit;
  if (speedKmh > limit + 6) triggerInfraction('M20');
}

// ---- Red light crossing (G28) ----
export function checkRedLightRule() {
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
export function checkSpeedBumpRule() {
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
//  - a curb / sidewalk: a real crash (speed straight into it above CONFIG.CURB_CRASH_SPEED_KMH)
//    wrecks the car for good — it stops and can't move again this run. Slower touches are
//    harmless while driving, but in the parking scenarios even a scrape is a fault.
//  - a parked car (parking scenarios): any touch is a fault, however gentle.
//  - other traffic and pedestrians: a fine above a small impact speed.
export function wreckPlayer() {
  if (gameState.wrecked) return;
  gameState.wrecked = true;
  controlState.throttleTarget = 0;
  controlState.brakeHeld = false;
  document.body.classList.add('wrecked');
  logEvent('WRECKED', { speedKmh: chassisBody.velocity.length() * 3.6 });
  triggerInfraction('CURB_CRASH');
}

export function setupCollisionListener() {
  chassisBody.addEventListener('collide', (e) => {
    const other = e.body;
    const data = other.userData;
    if (!data) return;
    const impact = e.contact.getImpactVelocityAlongNormal ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 1;

    if (data.isCurb) {
      if (impact * 3.6 > CONFIG.CURB_CRASH_SPEED_KMH) { playCrash(impact); wreckPlayer(); }
      else if (scenarioLayout === 'parking' && !data.touchOk && impact > 0.1) triggerInfraction('PARK_CURB');
    } else if (data.isParked) {
      if (impact > 0.1) { playCrash(impact); triggerInfraction('PARK_CAR'); }
    } else if (data.isPenalized) {
      if (impact > 0.8) { triggerInfraction('COLLISION'); playCrash(impact); }
    }
  });
}
