import * as THREE from 'three';
import { CONFIG } from '../config';
import { chassisBody, carYaw } from '../entities/player';
import { controlState, pressAction, releaseAction, nudgeThrottle, resetHeldInputs } from './input';
import { scriptedCars, type ScriptedCar } from '../entities/scriptedCars';
import { CROSSWALKS } from '../world/crosswalks';
import { COURSE } from '../world/tutorialCourse';
import { getRoute, sampleRoute } from '../world/roundabout';
import { currentTutorialStepId, currentWaypoint } from './tutorial';
import { setInputLocked } from '../state/inputLock';
import { showAutoplayBar, hideAutoplayBar, setAutoplayPressed } from '../ui/autoplayBar';
import type { ActionId } from '../state/keybindings';

// The Tutorial scenario's "AI" button: an autopilot that drives the guided course by pressing and
// holding the very same actions a human would (systems/input.ts's pressAction/releaseAction/
// nudgeThrottle — the same functions the real keyboard/mouse handlers call), one step at a time,
// well enough to satisfy each step's own completion test in systems/tutorial.ts. It never reads or
// changes that module's private grading state — it only drives, and the grading (already running
// every frame regardless of who is at the wheel) advances the step on its own once satisfied.

const LEFT = COURSE.lanes.left, RIGHT = COURSE.lanes.right;
const wheelLock = (): number => THREE.MathUtils.degToRad(CONFIG.WHEEL_MAX_ANGLE_DEG);

interface Vec2 { x: number; z: number }

let on = false;
export function isAutoplayOn(): boolean { return on; }

const held = new Set<ActionId>();
function setHeld(action: ActionId, want: boolean): void {
  const has = held.has(action);
  if (want && !has) { pressAction(action); held.add(action); }
  else if (!want && has) { releaseAction(action); held.delete(action); }
}
function tap(action: ActionId): void { pressAction(action); }

let throttleDir: 1 | 0 | -1 = 0;
let throttleTimer = 0;

// Holds/releases the brake and "scrolls" the accelerator toward a target speed the same way a
// human alternating the mouse wheel would (a step at a time, not an instant snap to value).
function driveSpeed(targetKmh: number, kmh: number, dt: number): void {
  throttleTimer -= dt;
  const err = targetKmh - kmh;
  setHeld('brake', targetKmh <= 0.05 ? true : err < -4);
  if (err > 1.5) {
    if (throttleTimer <= 0) { nudgeThrottle(1); throttleTimer = 0.1; }
    throttleDir = 1;
  } else if (err < -1.5) {
    if (throttleTimer <= 0) { nudgeThrottle(-1); throttleTimer = 0.1; }
    throttleDir = -1;
  } else {
    throttleDir = 0;
  }
}

// Plain pure-pursuit steering: hold left/right depending on which side of the nose a target point
// falls on. General enough for the straight avenue, the turns and the roundabout's curve alike.
function steerToward(targetX: number, targetZ: number, p: Vec2): void {
  const yaw = carYaw();
  const dx = targetX - p.x, dz = targetZ - p.z;
  const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const DEAD = 0.5;
  setHeld('steerLeft', localX < -DEAD);
  setHeld('steerRight', localX > DEAD);
}

function driveToward(targetX: number, targetZ: number, targetKmh: number, p: Vec2, kmh: number, dt: number): void {
  // Holding the brake at a near-standstill engages reverse (systems/input.ts), same as a real key
  // hold would — wanting to move forward again means tapping "drive" first, exactly as the lesson
  // itself teaches the player to do.
  if (targetKmh > 0.05 && controlState.gear === 'R') tap('drive');
  steerToward(targetX, targetZ, p);
  driveSpeed(targetKmh, kmh, dt);
}

function nearestArcLength(route: ReturnType<typeof getRoute>, x: number, z: number): number {
  let bestS = 0, bestD = Infinity;
  for (let i = 0; i < route.pts.length; i++) {
    const d = (route.pts[i].x - x) ** 2 + (route.pts[i].z - z) ** 2;
    if (d < bestD) { bestD = d; bestS = route.cum[i]; }
  }
  return bestS;
}

// Per-step scratch state (a wait timer, a "tapped the signal yet" flag...), thrown away and
// rebuilt whenever the step changes.
let lastStepId: string | null = null;
let scratch: Record<string, number | boolean> = {};

function findCar(laneX: number): ScriptedCar | undefined {
  return scriptedCars.find(c => Math.abs(c.x - laneX) < 1.5);
}

// True once a scripted car that was behind the player (in the given lane) has moved far enough
// ahead to safely change into that lane — the same threshold the step's own on-screen hint uses.
function gapIsClear(laneX: number, playerZ: number): boolean {
  const car = findCar(laneX);
  return !car || car.z <= playerZ - 6;
}

function tick(stepId: string, p: Vec2, kmh: number, dt: number): void {
  const wp = currentWaypoint();
  switch (stepId) {
    case 'accelerate':
      driveToward(RIGHT, p.z - 20, 14, p, kmh, dt);
      break;

    case 'steer': {
      const lock = wheelLock();
      if (!scratch.leftDone) {
        if (controlState.wheelAngle > -lock * 0.32) setHeld('steerLeft', true);
        else { scratch.leftDone = true; setHeld('steerLeft', false); }
      } else if (!scratch.rightDone) {
        if (controlState.wheelAngle < lock * 0.32) setHeld('steerRight', true);
        else { scratch.rightDone = true; setHeld('steerRight', false); }
      } else {
        setHeld('steerLeft', false);
        setHeld('steerRight', false);
      }
      driveSpeed(10, kmh, dt);
      break;
    }

    case 'brake':
      driveToward(RIGHT, p.z - 20, 0, p, kmh, dt);
      break;

    case 'signals':
      scratch.t = (scratch.t as number ?? 0) + dt;
      if (!scratch.tapLeft && (scratch.t as number) > 0.15) { tap('signalLeft'); scratch.tapLeft = true; }
      if (!scratch.tapRight && (scratch.t as number) > 0.7) { tap('signalRight'); scratch.tapRight = true; }
      driveToward(RIGHT, p.z - 20, 0, p, kmh, dt);
      break;

    case 'signalsOff':
      if (!scratch.tapped) { tap('signalOff'); scratch.tapped = true; }
      driveToward(RIGHT, p.z - 20, 0, p, kmh, dt);
      break;

    case 'horn':
      if (!scratch.tapped) { tap('horn'); scratch.tapped = true; }
      driveToward(RIGHT, p.z - 20, 0, p, kmh, dt);
      break;

    case 'drive':
      driveToward(wp?.x ?? RIGHT, wp?.z ?? p.z - 30, 28, p, kmh, dt);
      break;

    case 'laneLeft': {
      if (!scratch.tapped) { tap('signalLeft'); scratch.tapped = true; }
      const safe = gapIsClear(LEFT, p.z);
      driveToward(safe ? LEFT : RIGHT, p.z - 25, safe ? 20 : 17, p, kmh, dt);
      break;
    }

    case 'laneRight':
    case 'laneBack':
      if (!scratch.tapped) { tap('signalRight'); scratch.tapped = true; }
      driveToward(RIGHT, p.z - 25, 20, p, kmh, dt);
      break;

    case 'bump':
      driveToward(wp?.x ?? RIGHT, wp?.z ?? p.z - 20, 15, p, kmh, dt);
      break;

    case 'zebra': {
      const cw = CROSSWALKS.find(c => c.cz === COURSE.zebraZ);
      const blocked = !!cw && cw.pedsOnRoad > 0;
      const near = wp !== undefined && Math.abs(p.z - wp.z) < 45;
      driveToward(wp?.x ?? RIGHT, wp?.z ?? p.z - 20, blocked ? 0 : near ? 10 : 15, p, kmh, dt);
      break;
    }

    case 'hazard': {
      if (!scratch.tapped) { tap('signalLeft'); scratch.tapped = true; }
      const safe = gapIsClear(LEFT, p.z);
      driveToward(safe ? LEFT : RIGHT, wp?.z ?? p.z - 20, safe ? 16 : 14, p, kmh, dt);
      break;
    }

    case 'redLight':
      // The step completes as soon as it's read as stopped for long enough (systems/tutorial.ts) —
      // no need to know the light's actual colour, holding position here is all that's needed.
      driveToward(wp?.x ?? RIGHT, wp?.z ?? p.z, 0, p, kmh, dt);
      break;

    case 'greenLight':
      driveToward(wp?.x ?? RIGHT, wp?.z ?? p.z - 20, 18, p, kmh, dt);
      break;

    case 'turnRight':
      if (!scratch.tapped && p.x > 3) { tap('signalRight'); scratch.tapped = true; }
      driveToward(wp?.x ?? 20, wp?.z ?? p.z, 14, p, kmh, dt);
      break;

    case 'stopSign': {
      // Unlike the traffic light, this step only completes once the car has actually crossed the
      // line, so the autopilot has to hold, then explicitly resume.
      const target = wp ?? { x: p.x, z: p.z };
      if (!scratch.resume) {
        const close = Math.hypot(p.x - target.x, p.z - target.z) < 20;
        if (close && kmh < 2) scratch.stopT = (scratch.stopT as number ?? 0) + dt;
        if ((scratch.stopT as number ?? 0) > 1.8) scratch.resume = true;
        driveToward(target.x, target.z, 0, p, kmh, dt);
      } else {
        driveToward(target.x + 25, target.z, 12, p, kmh, dt);
      }
      break;
    }

    case 'turnLeft':
      if (!scratch.tapped && p.x > COURSE.ring.cx - 24) { tap('signalLeft'); scratch.tapped = true; }
      driveToward(wp?.x ?? COURSE.ring.cx + 1.75, wp?.z ?? p.z, 14, p, kmh, dt);
      break;

    case 'roundabout': {
      const route = getRoute('S', 'N');
      if (scratch.s === undefined) scratch.s = nearestArcLength(route, p.x, p.z);
      scratch.s = Math.min(route.length, (scratch.s as number) + (16 / 3.6) * dt);
      const sample = sampleRoute(route, Math.min(route.length - 0.1, (scratch.s as number) + 14));
      driveToward(sample.x, sample.z, 16, p, kmh, dt);
      break;
    }

    default:
      setHeld('steerLeft', false);
      setHeld('steerRight', false);
      throttleDir = 0;
      break;
  }
}

export function updateAutoplay(dt: number): void {
  if (!on) return;
  const stepId = currentTutorialStepId();
  if (stepId !== lastStepId) { scratch = {}; lastStepId = stepId; }
  if (stepId) {
    const p = chassisBody.position, v = chassisBody.velocity;
    tick(stepId, p, v.length() * 3.6, dt);
  }
  setAutoplayPressed(held, throttleDir);
}

function releaseAll(): void {
  held.forEach(a => releaseAction(a));
  held.clear();
  throttleDir = 0;
}

export function stopAutoplay(): void {
  if (!on) return;
  on = false;
  releaseAll();
  setInputLocked(false);
  hideAutoplayBar();
}

function startAutoplay(): void {
  if (on) return;
  on = true;
  lastStepId = null;
  scratch = {};
  resetHeldInputs(); // no stray real key-hold should fight the autopilot
  setInputLocked(true);
  showAutoplayBar();
}

export function toggleAutoplay(): void {
  if (on) stopAutoplay();
  else startAutoplay();
}
