import * as THREE from 'three';
import { CONFIG, PENALTIES } from '../config.js';
import { gameState } from '../state/gameState.js';
import { chassisBody } from '../entities/player.js';
import { LANE_X } from '../world/road.js';
import { INTERSECTIONS } from '../world/intersections.js';
import { inSchoolZone } from '../world/schoolZone.js';
import { SPEED_BUMPS } from '../world/speedBumps.js';
import { controlState } from './input.js';
import { showToast, refreshHud, showGameOver } from '../ui/hud.js';

const lastInfractionTime = {};

export function triggerInfraction(code, customDamage) {
  const now = performance.now() / 1000;
  if (lastInfractionTime[code] !== undefined && now - lastInfractionTime[code] < CONFIG.INFRACTION_COOLDOWN) return;
  lastInfractionTime[code] = now;

  const p = PENALTIES[code];
  gameState.score = THREE.MathUtils.clamp(gameState.score + p.score, 0, 100);
  if (p.damage || customDamage) gameState.damage = THREE.MathUtils.clamp(gameState.damage + (customDamage ?? p.damage), 0, 100);
  showToast(p.label, `${p.score} pts${p.damage ? `, +${p.damage}% daño` : ''}`);
  refreshHud();

  if (gameState.score <= 0 && !gameState.gameOver) {
    gameState.gameOver = true;
    showGameOver();
  }
}

// ---- Lane-change (G10) tracking ----
function nearestLaneIndex(x) {
  let best = -1, bestD = Infinity;
  LANE_X.forEach((lx, i) => { const d = Math.abs(x - lx); if (d < bestD) { bestD = d; best = i; } });
  return bestD < CONFIG.LANE_WIDTH * 0.55 ? best : -1;
}

let prevLaneIndex = -1;
let prevPlayerZ = 0;

// Must run once after the player body exists (main.js calls this right after createPlayer()).
export function initRules() {
  prevLaneIndex = nearestLaneIndex(chassisBody.position.x);
  prevPlayerZ = chassisBody.position.z;
}

export function checkLaneChangeRule() {
  const curLane = nearestLaneIndex(chassisBody.position.x);
  if (curLane !== -1 && prevLaneIndex !== -1 && curLane !== prevLaneIndex) {
    const now = performance.now() / 1000;
    const signaled = (controlState.signalLeft || controlState.signalRight) && (now - controlState.lastSignalOnTime) < 4;
    if (!signaled) triggerInfraction('G10');
  }
  if (curLane !== -1) prevLaneIndex = curLane;
}

// ---- Speed limit (M20) ----
export function checkSpeedRule() {
  const speedKmh = chassisBody.velocity.length() * 3.6;
  const limit = inSchoolZone(chassisBody.position.z) ? CONFIG.SCHOOL_SPEED_LIMIT : CONFIG.URBAN_SPEED_LIMIT;
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

// ---- Collision detection (Collision code) ----
export function setupCollisionListener() {
  chassisBody.addEventListener('collide', (e) => {
    const other = e.body;
    if (other.userData && other.userData.isPenalized) {
      const relSpeed = e.contact.getImpactVelocityAlongNormal ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 1;
      if (relSpeed > 0.8) triggerInfraction('COLLISION');
    }
  });
}
