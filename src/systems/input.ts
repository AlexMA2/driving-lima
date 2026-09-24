import * as THREE from 'three';
import { CONFIG } from '../config';
import { vehicle, chassisBody, forwardSpeed, carYaw } from '../entities/player';
import { camera, canvas } from '../core/renderer';
import { WHEEL_LOCAL_POS } from '../entities/cockpit';
import { playHonk, playBrakeScreech } from './audio';
import { logEvent } from './debugLog';
import { actionOf } from '../state/keybindings';
import { isOverlayOpen } from '../ui/overlays';

// Read live (not cached at load) so the global config can change the wheel's lock between games.
const wheelMaxRad = () => THREE.MathUtils.degToRad(CONFIG.WHEEL_MAX_ANGLE_DEG);

export const controlState = {
  // raw press state — set on keydown/keyup or pointerdown/pointerup, never inferred from
  // OS auto-repeat, so the ramps below are the only source of "how much" pedal is applied.
  brakeHeld: false, handbrake: false,

  // The accelerator is the mouse scroll wheel, like a hand-throttle: each notch nudges
  // throttleTarget up/down and it stays there (no key to hold) — `throttle` glides toward it
  // so a big jump still isn't instant. Speed naturally "holds" once the wheel stops moving.
  throttleTarget: 0, throttle: 0, brake: 0, // ramped 0..1 — this is what physics actually reads

  wheelAngle: 0, wheelTarget: 0, wheelDragging: false,
  keyLeft: false, keyRight: false, // steering keys held: the wheel is turned progressively while they are (see updateWheelAndPedals)
  lastScrollTime: -999, // performance.now()/1000 of the latest accelerator scroll (for auto-release)
  lastHonkTime: -999,   // ...and of the latest horn press (the tutorial waits for it)

  signalLeft: false, signalRight: false, lastSignalOnTime: -999,
};

// Letting go of the last steering key hands the wheel back (unless the mouse is holding it).
function releaseKeyboardSteer() {
  if (!controlState.keyLeft && !controlState.keyRight && !controlState.wheelDragging) controlState.wheelTarget = 0;
}

let dragStartMouseAngle = 0;
let dragStartWheelAngle = 0;

// The wheel mesh is a direct child of the camera, so its local position IS its view-space
// position — running it through the camera's own projection matrix gives NDC directly, and it
// stays correct across window resizes since projectionMatrix is updated on resize. Exported so
// the HUD can line up the speedometer/turn-signal cluster with the steering wheel's screen Y.
export function wheelScreenCenter(): { x: number; y: number } {
  const ndc = WHEEL_LOCAL_POS.clone().applyMatrix4(camera.projectionMatrix);
  return {
    x: (ndc.x + 1) / 2 * window.innerWidth,
    y: (1 - ndc.y) / 2 * window.innerHeight,
  };
}

function angleFromCenter(clientX: number, clientY: number): number {
  const c = wheelScreenCenter();
  return Math.atan2(clientY - c.y, clientX - c.x);
}

function normalizeDelta(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export function initInput(): void {
  // Keys come from the remappable bindings (state/keybindings.ts). Chords with Ctrl/Alt/Meta
  // belong to the browser or to shortcuts like Ctrl+L (debug log), never to the car.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (actionOf(e.key)) {
      case 'brake': controlState.brakeHeld = true; logEvent('BRAKE_DOWN'); break;
      case 'steerLeft': controlState.keyLeft = true; break;
      case 'steerRight': controlState.keyRight = true; break;
      case 'handbrake': controlState.handbrake = true; e.preventDefault(); logEvent('HANDBRAKE_DOWN'); break;
      case 'horn': playHonk(); controlState.lastHonkTime = performance.now() / 1000; break;
      case 'signalLeft':
        controlState.signalLeft = !controlState.signalLeft; controlState.signalRight = false;
        controlState.lastSignalOnTime = performance.now() / 1000;
        logEvent('SIGNAL', { side: 'left', on: controlState.signalLeft });
        break;
      case 'signalRight':
        controlState.signalRight = !controlState.signalRight; controlState.signalLeft = false;
        controlState.lastSignalOnTime = performance.now() / 1000;
        logEvent('SIGNAL', { side: 'right', on: controlState.signalRight });
        break;
      case 'signalOff':
        controlState.signalLeft = false; controlState.signalRight = false;
        logEvent('SIGNAL', { side: 'both', on: false });
        break;
    }
  });

  // No modifier check on release: a key pressed alone must still be released if Ctrl was
  // pressed in the meantime, or the pedal would stay stuck down.
  window.addEventListener('keyup', (e) => {
    switch (actionOf(e.key)) {
      case 'brake': controlState.brakeHeld = false; logEvent('BRAKE_UP'); break;
      case 'steerLeft': controlState.keyLeft = false; releaseKeyboardSteer(); break;
      case 'steerRight': controlState.keyRight = false; releaseKeyboardSteer(); break;
      case 'handbrake': controlState.handbrake = false; logEvent('HANDBRAKE_UP'); break;
    }
  });

  // If the window/tab loses focus while a key is physically held down (alt-tab, a browser
  // dialog stealing focus, clicking a dev tool, etc.) the OS never sends us its keyup, so
  // brakeHeld/handbrake/wheelTarget could otherwise get stuck "on" forever — silently fighting
  // the throttle so the car never picks up speed again until the player happens to retap the
  // same key. Dropping all held inputs on blur is the only reliable place to catch that.
  window.addEventListener('blur', () => {
    if (controlState.brakeHeld || controlState.handbrake || controlState.wheelDragging || controlState.wheelTarget !== 0) {
      logEvent('WINDOW_BLUR_RESET', {
        brakeHeld: controlState.brakeHeld, handbrake: controlState.handbrake,
        wheelDragging: controlState.wheelDragging, wheelTarget: controlState.wheelTarget,
      });
    }
    controlState.brakeHeld = false;
    controlState.handbrake = false;
    controlState.wheelDragging = false;
    controlState.keyLeft = false;
    controlState.keyRight = false;
    controlState.wheelTarget = 0;
  });

  // Accelerator: scroll up nudges the throttle position up, scroll down nudges it down, and
  // it just sits there between scrolls — like a hand-throttle, not a spring-loaded pedal.
  // Skipped while a menu/dialog is on screen so those can still be scrolled normally.
  window.addEventListener('wheel', (e) => {
    if (isOverlayOpen()) {
      logEvent('THROTTLE_SCROLL_IGNORED', { reason: 'overlay_open', deltaY: e.deltaY });
      return;
    }
    const up = CONFIG.THROTTLE_INVERT_SCROLL ? e.deltaY > 0 : e.deltaY < 0;
    const delta = up ? CONFIG.THROTTLE_WHEEL_STEP : -CONFIG.THROTTLE_WHEEL_STEP;
    controlState.lastScrollTime = performance.now() / 1000;
    const before = controlState.throttleTarget;
    controlState.throttleTarget = THREE.MathUtils.clamp(controlState.throttleTarget + delta, 0, 1);
    logEvent('THROTTLE_SCROLL', {
      deltaY: e.deltaY, before, after: controlState.throttleTarget,
      speedKmh: chassisBody.velocity.length() * 3.6,
      brakeHeld: controlState.brakeHeld, handbrake: controlState.handbrake,
    });
    e.preventDefault();
  }, { passive: false });

  // Mouse-drag steering wheel: grab anywhere, rotate around the wheel's on-screen center —
  // a real hydraulic wheel doesn't snap, so the actual angle is smoothed toward this target
  // in updateWheelAndPedals() rather than applied instantly here.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    controlState.wheelDragging = true;
    dragStartMouseAngle = angleFromCenter(e.clientX, e.clientY);
    dragStartWheelAngle = controlState.wheelTarget;
    canvas.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', (e) => {
    if (!controlState.wheelDragging) return;
    const now = angleFromCenter(e.clientX, e.clientY);
    const delta = normalizeDelta(now - dragStartMouseAngle);
    const lock = wheelMaxRad();
    controlState.wheelTarget = THREE.MathUtils.clamp(dragStartWheelAngle + delta, -lock, lock);
  });
  window.addEventListener('pointerup', () => {
    if (!controlState.wheelDragging) return;
    controlState.wheelDragging = false;
    controlState.wheelTarget = 0; // let go of the wheel -> hydraulic self-centering
  });
}

// Frame-rate independent exponential smoothing toward `target` at `rate` (higher = snappier).
function approach(current: number, target: number, rate: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function updateWheelAndPedals(dt: number): void {
  // Keyboard steering is progressive: holding A/D winds the wheel on at KEYBOARD_STEER_RATE, so a tap is a
  // small correction and a longer press a bigger one (jumping straight to full lock made every tap a swerve).
  const keyDir = (controlState.keyRight ? 1 : 0) - (controlState.keyLeft ? 1 : 0);
  if (keyDir !== 0 && !controlState.wheelDragging) {
    const lock = wheelMaxRad();
    const goal = keyDir * lock * CONFIG.KEYBOARD_STEER_FRACTION;
    const stepRad = lock * CONFIG.KEYBOARD_STEER_RATE * dt;
    const t = controlState.wheelTarget;
    controlState.wheelTarget = t < goal ? Math.min(goal, t + stepRad) : Math.max(goal, t - stepRad);
  }

  // Keyboard steering (A/D) sets a nonzero target without ever setting wheelDragging, so it
  // needs the snappier follow rate too — only an actually-centered, released wheel should
  // ease back at the slower hydraulic self-centering rate.
  const isSteering = controlState.wheelDragging || controlState.wheelTarget !== 0;
  const followRate = isSteering ? CONFIG.WHEEL_FOLLOW_RATE : CONFIG.WHEEL_RETURN_RATE;
  controlState.wheelAngle = approach(controlState.wheelAngle, controlState.wheelTarget, followRate, dt);

  // Optional auto-release: once the wheel has been left alone for a moment, the accelerator
  // position eases back toward 0 (0 = the hand-throttle simply holds, the default).
  if (CONFIG.THROTTLE_AUTO_RELEASE > 0 && performance.now() / 1000 - controlState.lastScrollTime > 0.4) {
    controlState.throttleTarget = Math.max(0, controlState.throttleTarget - CONFIG.THROTTLE_AUTO_RELEASE * dt);
  }

  controlState.throttle = controlState.throttle < controlState.throttleTarget
    ? Math.min(controlState.throttleTarget, controlState.throttle + dt / CONFIG.THROTTLE_RAMP_UP)
    : Math.max(controlState.throttleTarget, controlState.throttle - dt / CONFIG.THROTTLE_RAMP_DOWN);

  controlState.brake = controlState.brakeHeld
    ? Math.min(1, controlState.brake + dt / CONFIG.BRAKE_RAMP_UP)
    : Math.max(0, controlState.brake - dt / CONFIG.BRAKE_RAMP_DOWN);
}

// ---- Steering assist -------------------------------------------------------------------------------
// A car does not straighten itself: after a lane change it keeps the heading it was left with, and the driver
// has to counter-steer by exactly the right amount. Once the wheel is let go, this nudges the front wheels so the
// heading settles parallel to the road (the roads are laid along the world axes). It never fights the driver: it
// is off while the wheel is held, fades in as the wheel comes back to centre, and ignores errors big enough to be
// an intended turn.
const WHEELBASE = 2.9;
const QUARTER_TURN = Math.PI / 2;
let assistZone: (position: { x: number; z: number }) => boolean = () => false;

// `zone(chassisPosition)` says where the assist applies; the layouts whose roads are not straight and axis-aligned
// (roundabout, parking) leave it off.
export function initSteerAssist(zone: (position: { x: number; z: number }) => boolean): void { assistZone = zone; }

function steerAssist(): number {
  if (!CONFIG.STEER_ASSIST || !assistZone(chassisBody.position)) return 0;
  const v = forwardSpeed();
  if (v < 3) return 0; // only rolling forward; not while parking or reversing

  const lock = wheelMaxRad();
  const handsOff = 1 - THREE.MathUtils.clamp(Math.abs(controlState.wheelTarget) / (0.05 * lock), 0, 1);
  const wheelCentred = 1 - THREE.MathUtils.clamp(Math.abs(controlState.wheelAngle) / (0.25 * lock), 0, 1);

  const yaw = carYaw();
  const error = yaw - Math.round(yaw / QUARTER_TURN) * QUARTER_TURN; // heading relative to the nearest road axis
  const capture = THREE.MathUtils.degToRad(CONFIG.STEER_ASSIST_CAPTURE_DEG);
  const inCapture = 1 - THREE.MathUtils.smoothstep(Math.abs(error), capture * 0.7, capture);

  const weight = handsOff * wheelCentred * inCapture;
  if (weight <= 0) return 0;

  // Yaw rate that would remove the error in TAU seconds, and the front-wheel angle that produces it
  // (bicycle model: rate = v * tan(angle) / wheelbase), corrected by how the car is actually turning.
  const wanted = THREE.MathUtils.clamp(-error / CONFIG.STEER_ASSIST_TAU, -0.3, 0.3);
  const actual = chassisBody.angularVelocity.y;
  const angle = (WHEELBASE / Math.max(v, 2)) * (1.6 * wanted - 0.6 * actual);
  return weight * THREE.MathUtils.clamp(angle, -0.1, 0.1);
}

let wasHardBraking = false;

export function applyVehicleControls(dt: number): void {
  updateWheelAndPedals(dt);

  const speedKmh = chassisBody.velocity.length() * 3.6;

  // The chassis' angular damping is what keeps it from spinning out at speed, but at a crawl it just
  // fights the tyres: the car would swing much wider than its steering angle says, which makes
  // parking impossible. So it fades out as the car slows down.
  chassisBody.angularDamping = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(speedKmh, 8, 25, 0.05, 0.6), 0.05, 0.6);

  // Screech once on the press edge of a hard brake/handbrake at real speed, not every frame.
  const hardBraking = speedKmh > 25 && (controlState.handbrake || controlState.brake > 0.6);
  if (hardBraking && !wasHardBraking) playBrakeScreech();
  wasHardBraking = hardBraking;
  // At speed the wheels turn far less than at a crawl (real steering ratios do the same): a lane change
  // needs a couple of degrees of heading, which a full lock at 50 km/h overshoots ten times over.
  let steerScale = CONFIG.MAX_STEER;
  if (CONFIG.STEER_SPEED_FALLOFF) {
    const r = speedKmh / CONFIG.STEER_SPEED_REF_KMH;
    steerScale = CONFIG.MAX_STEER * THREE.MathUtils.clamp(1 / (1 + r * r), 0.08, 1);
  }

  // Wheel convention: positive wheelAngle = turned clockwise (right). CANNON's
  // setSteeringValue here uses positive = left (see original vehicle wiring), hence the
  // negation.
  const steerNorm = THREE.MathUtils.clamp(controlState.wheelAngle / wheelMaxRad(), -1, 1);
  const steerVal = -steerNorm * steerScale + steerAssist();
  vehicle.setSteeringValue(steerVal, 0);
  vehicle.setSteeringValue(steerVal, 1);

  // NOTE: positive engine force drives the chassis toward -Z (the direction the whole
  // city/road is generated in) given our wheel connection layout — verified empirically.
  const forceCap = speedKmh < CONFIG.MAX_SPEED_KMH ? CONFIG.ENGINE_FORCE : 0;

  // Brake pedal: real braking while rolling forward at speed; once nearly stopped (or already
  // backing up), holding it smoothly eases into reverse instead (same pedal, like an automatic).
  // Reverse gear tops out at a crawl and never brakes the car it is driving: braking the front
  // wheels while backing up would kill the steering, which is what parking is all about.
  const nearlyStopped = speedKmh < CONFIG.REVERSE_SPEED_THRESHOLD_KMH;
  const backingUp = forwardSpeed() < -0.3;
  let brakeForce = 0, reverseForce = 0;
  if (controlState.brake > 0) {
    if (nearlyStopped || backingUp) {
      const room = THREE.MathUtils.clamp(1 - speedKmh / CONFIG.REVERSE_MAX_KMH, 0, 1);
      reverseForce = -forceCap * 0.55 * controlState.brake * room;
    } else brakeForce = CONFIG.BRAKE_FORCE * controlState.brake;
  }
  const engineForce = controlState.throttle > 0 ? forceCap * controlState.throttle : reverseForce;
  vehicle.applyEngineForce(engineForce, 2);
  vehicle.applyEngineForce(engineForce, 3);

  if (controlState.throttleTarget <= 0 && !controlState.brakeHeld && !controlState.handbrake) {
    const settle = speedKmh < CONFIG.CRAWL_HOLD_KMH ? 0.5 : CONFIG.ENGINE_BRAKE;
    brakeForce = Math.max(brakeForce, CONFIG.BRAKE_FORCE * settle);
  }

  const handbrakeForce = controlState.handbrake ? CONFIG.HANDBRAKE_FORCE : 0;
  vehicle.setBrake(brakeForce, 0);
  vehicle.setBrake(brakeForce, 1);
  vehicle.setBrake(handbrakeForce, 2);
  vehicle.setBrake(handbrakeForce, 3);
}
