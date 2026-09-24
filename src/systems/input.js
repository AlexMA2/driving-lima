import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { gameState } from '../state/gameState.js';
import { vehicle, chassisBody, forwardSpeed } from '../entities/player.js';
import { camera, canvas } from '../core/renderer.js';
import { WHEEL_LOCAL_POS } from '../entities/cockpit.js';
import { playHonk, playBrakeScreech } from './audio.js';
import { logEvent } from './debugLog.js';
import { actionOf } from '../state/keybindings.js';

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
  lastScrollTime: -999, // performance.now()/1000 of the latest accelerator scroll (for auto-release)
  lastHonkTime: -999,   // ...and of the latest horn press (the tutorial waits for it)

  signalLeft: false, signalRight: false, lastSignalOnTime: -999,
};

let dragStartMouseAngle = 0;
let dragStartWheelAngle = 0;

// The wheel mesh is a direct child of the camera, so its local position IS its view-space
// position — running it through the camera's own projection matrix gives NDC directly, and it
// stays correct across window resizes since projectionMatrix is updated on resize. Exported so
// the HUD can line up the speedometer/turn-signal cluster with the steering wheel's screen Y.
export function wheelScreenCenter() {
  const ndc = WHEEL_LOCAL_POS.clone().applyMatrix4(camera.projectionMatrix);
  return {
    x: (ndc.x + 1) / 2 * window.innerWidth,
    y: (1 - ndc.y) / 2 * window.innerHeight,
  };
}

function angleFromCenter(clientX, clientY) {
  const c = wheelScreenCenter();
  return Math.atan2(clientY - c.y, clientX - c.x);
}

function normalizeDelta(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// The scroll-wheel accelerator would otherwise fight normal page scrolling inside the
// start/results screens and dialogs (e.g. a long infractions list) — only steal the wheel
// once the driving HUD is actually the thing on screen.
function isOverlayOpen() {
  return document.body.dataset.screen !== 'game'
    || document.getElementById('gameOverScreen').style.display === 'flex'
    || document.getElementById('instructionsDialog').classList.contains('show')
    || document.getElementById('logDialog').classList.contains('show');
}

export function initInput() {
  // Keys come from the remappable bindings (state/keybindings.js). Chords with Ctrl/Alt/Meta
  // belong to the browser or to shortcuts like Ctrl+L (debug log), never to the car.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (actionOf(e.key)) {
      case 'brake': controlState.brakeHeld = true; logEvent('BRAKE_DOWN'); break;
      case 'steerLeft': controlState.wheelTarget = -wheelMaxRad() * CONFIG.KEYBOARD_STEER_FRACTION; break;
      case 'steerRight': controlState.wheelTarget = wheelMaxRad() * CONFIG.KEYBOARD_STEER_FRACTION; break;
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
      case 'steerLeft': if (controlState.wheelTarget < 0) controlState.wheelTarget = 0; break;
      case 'steerRight': if (controlState.wheelTarget > 0) controlState.wheelTarget = 0; break;
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
function approach(current, target, rate, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function updateWheelAndPedals(dt) {
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

let wasHardBraking = false;

// A wrecked car (systems/rules.js wreckPlayer) is dead weight: no engine, every brake locked, and
// whatever motion is left over from the impact is wiped out each frame so it never creeps off.
function immobilize() {
  controlState.throttleTarget = 0; controlState.throttle = 0; controlState.brake = 0;
  for (let i = 0; i < 4; i++) vehicle.setBrake(CONFIG.HANDBRAKE_FORCE * 3, i);
  vehicle.applyEngineForce(0, 2);
  vehicle.applyEngineForce(0, 3);
  chassisBody.velocity.x = 0;
  chassisBody.velocity.z = 0;
  chassisBody.angularVelocity.set(0, 0, 0);
}

export function applyVehicleControls(dt) {
  updateWheelAndPedals(dt);
  if (gameState.wrecked) { immobilize(); return; }

  const speedKmh = chassisBody.velocity.length() * 3.6;

  // The chassis' angular damping is what keeps it from spinning out at speed, but at a crawl it just
  // fights the tyres: the car would swing much wider than its steering angle says, which makes
  // parking impossible. So it fades out as the car slows down.
  chassisBody.angularDamping = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(speedKmh, 8, 25, 0.05, 0.6), 0.05, 0.6);

  // Screech once on the press edge of a hard brake/handbrake at real speed, not every frame.
  const hardBraking = speedKmh > 25 && (controlState.handbrake || controlState.brake > 0.6);
  if (hardBraking && !wasHardBraking) playBrakeScreech();
  wasHardBraking = hardBraking;
  let steerScale = CONFIG.MAX_STEER;
  if (CONFIG.STEER_SPEED_FALLOFF) steerScale = CONFIG.MAX_STEER * THREE.MathUtils.clamp(1 - speedKmh / 180, 0.35, 1);

  // Wheel convention: positive wheelAngle = turned clockwise (right). CANNON's
  // setSteeringValue here uses positive = left (see original vehicle wiring), hence the
  // negation.
  const steerNorm = THREE.MathUtils.clamp(controlState.wheelAngle / wheelMaxRad(), -1, 1);
  const steerVal = -steerNorm * steerScale;
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
