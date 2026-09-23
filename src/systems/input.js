import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { vehicle, chassisBody } from '../entities/player.js';
import { camera, canvas } from '../core/renderer.js';
import { WHEEL_LOCAL_POS } from '../entities/cockpit.js';
import { playHonk, playBrakeScreech } from './audio.js';
import { logEvent } from './debugLog.js';

const WHEEL_MAX_RAD = THREE.MathUtils.degToRad(CONFIG.WHEEL_MAX_ANGLE_DEG);

export const controlState = {
  // raw press state — set on keydown/keyup or pointerdown/pointerup, never inferred from
  // OS auto-repeat, so the ramps below are the only source of "how much" pedal is applied.
  brakeHeld: false, handbrake: false,

  // The accelerator is the mouse scroll wheel, like a hand-throttle: each notch nudges
  // throttleTarget up/down and it stays there (no key to hold) — `throttle` glides toward it
  // so a big jump still isn't instant. Speed naturally "holds" once the wheel stops moving.
  throttleTarget: 0, throttle: 0, brake: 0, // ramped 0..1 — this is what physics actually reads

  wheelAngle: 0, wheelTarget: 0, wheelDragging: false,

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
  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 's': case 'arrowdown': controlState.brakeHeld = true; logEvent('BRAKE_DOWN'); break;
      case 'a': case 'arrowleft': controlState.wheelTarget = -WHEEL_MAX_RAD; break;
      case 'd': case 'arrowright': controlState.wheelTarget = WHEEL_MAX_RAD; break;
      case ' ': controlState.handbrake = true; e.preventDefault(); logEvent('HANDBRAKE_DOWN'); break;
      case 'h': playHonk(); break;
      case 'q':
        controlState.signalLeft = !controlState.signalLeft; controlState.signalRight = false;
        controlState.lastSignalOnTime = performance.now() / 1000;
        logEvent('SIGNAL', { side: 'left', on: controlState.signalLeft });
        break;
      case 'e':
        controlState.signalRight = !controlState.signalRight; controlState.signalLeft = false;
        controlState.lastSignalOnTime = performance.now() / 1000;
        logEvent('SIGNAL', { side: 'right', on: controlState.signalRight });
        break;
      case 'l': // 'L' also doubles as an all-off "lights" key
        controlState.signalLeft = false; controlState.signalRight = false;
        logEvent('SIGNAL', { side: 'both', on: false });
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
      case 's': case 'arrowdown': controlState.brakeHeld = false; logEvent('BRAKE_UP'); break;
      case 'a': case 'arrowleft': if (controlState.wheelTarget < 0) controlState.wheelTarget = 0; break;
      case 'd': case 'arrowright': if (controlState.wheelTarget > 0) controlState.wheelTarget = 0; break;
      case ' ': controlState.handbrake = false; logEvent('HANDBRAKE_UP'); break;
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
    const delta = e.deltaY < 0 ? CONFIG.THROTTLE_WHEEL_STEP : -CONFIG.THROTTLE_WHEEL_STEP;
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
    controlState.wheelTarget = THREE.MathUtils.clamp(dragStartWheelAngle + delta, -WHEEL_MAX_RAD, WHEEL_MAX_RAD);
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

  controlState.throttle = controlState.throttle < controlState.throttleTarget
    ? Math.min(controlState.throttleTarget, controlState.throttle + dt / CONFIG.THROTTLE_RAMP_UP)
    : Math.max(controlState.throttleTarget, controlState.throttle - dt / CONFIG.THROTTLE_RAMP_DOWN);

  controlState.brake = controlState.brakeHeld
    ? Math.min(1, controlState.brake + dt / CONFIG.BRAKE_RAMP_UP)
    : Math.max(0, controlState.brake - dt / CONFIG.BRAKE_RAMP_DOWN);
}

let wasHardBraking = false;

export function applyVehicleControls(dt) {
  updateWheelAndPedals(dt);

  const speedKmh = chassisBody.velocity.length() * 3.6;

  // Screech once on the press edge of a hard brake/handbrake at real speed, not every frame.
  const hardBraking = speedKmh > 25 && (controlState.handbrake || controlState.brake > 0.6);
  if (hardBraking && !wasHardBraking) playBrakeScreech();
  wasHardBraking = hardBraking;
  let steerScale = CONFIG.MAX_STEER;
  if (CONFIG.STEER_SPEED_FALLOFF) steerScale = CONFIG.MAX_STEER * THREE.MathUtils.clamp(1 - speedKmh / 180, 0.35, 1);

  // Wheel convention: positive wheelAngle = turned clockwise (right). CANNON's
  // setSteeringValue here uses positive = left (see original vehicle wiring), hence the
  // negation.
  const steerNorm = THREE.MathUtils.clamp(controlState.wheelAngle / WHEEL_MAX_RAD, -1, 1);
  const steerVal = -steerNorm * steerScale;
  vehicle.setSteeringValue(steerVal, 0);
  vehicle.setSteeringValue(steerVal, 1);

  // NOTE: positive engine force drives the chassis toward -Z (the direction the whole
  // city/road is generated in) given our wheel connection layout — verified empirically.
  const forceCap = speedKmh < CONFIG.MAX_SPEED_KMH ? CONFIG.ENGINE_FORCE : 0;

  // Brake pedal: real braking while rolling at speed; once nearly stopped, holding it
  // smoothly eases into reverse instead (same pedal, like an automatic).
  const nearlyStopped = speedKmh < CONFIG.REVERSE_SPEED_THRESHOLD_KMH;
  let brakeForce = 0, reverseForce = 0;
  if (controlState.brake > 0) {
    if (nearlyStopped) reverseForce = -forceCap * 0.55 * controlState.brake;
    else brakeForce = CONFIG.BRAKE_FORCE * controlState.brake;
  }
  const engineForce = controlState.throttle > 0 ? forceCap * controlState.throttle : reverseForce;
  vehicle.applyEngineForce(engineForce, 2);
  vehicle.applyEngineForce(engineForce, 3);

  if (controlState.throttleTarget <= 0 && !controlState.brakeHeld && !controlState.handbrake) brakeForce = Math.max(brakeForce, CONFIG.BRAKE_FORCE * 0.15);

  const handbrakeForce = controlState.handbrake ? CONFIG.HANDBRAKE_FORCE : 0;
  vehicle.setBrake(brakeForce, 0);
  vehicle.setBrake(brakeForce, 1);
  vehicle.setBrake(handbrakeForce, 2);
  vehicle.setBrake(handbrakeForce, 3);
}
