import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { vehicle, chassisBody } from '../entities/player.js';

export const controlState = {
  forward: false, backward: false, left: false, right: false, handbrake: false,
  cameraToggling: false, cameraMode: 'chase', // 'chase' | 'hood'
  signalLeft: false, signalRight: false, lastSignalOnTime: -999,
};

export function initInput() {
  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w': case 'arrowup': controlState.forward = true; break;
      case 's': case 'arrowdown': controlState.backward = true; break;
      case 'a': case 'arrowleft': controlState.left = true; break;
      case 'd': case 'arrowright': controlState.right = true; break;
      case ' ': controlState.handbrake = true; e.preventDefault(); break;
      case 'q': controlState.signalLeft = !controlState.signalLeft; controlState.signalRight = false; controlState.lastSignalOnTime = performance.now() / 1000; break;
      case 'e': controlState.signalRight = !controlState.signalRight; controlState.signalLeft = false; controlState.lastSignalOnTime = performance.now() / 1000; break;
      case 'l': controlState.signalLeft = false; controlState.signalRight = false; break; // 'L' also doubles as an all-off "lights" key
      case 'c':
        if (!controlState.cameraToggling) {
          controlState.cameraMode = controlState.cameraMode === 'chase' ? 'hood' : 'chase';
          controlState.cameraToggling = true;
        }
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch (e.key.toLowerCase()) {
      case 'w': case 'arrowup': controlState.forward = false; break;
      case 's': case 'arrowdown': controlState.backward = false; break;
      case 'a': case 'arrowleft': controlState.left = false; break;
      case 'd': case 'arrowright': controlState.right = false; break;
      case ' ': controlState.handbrake = false; break;
      case 'c': controlState.cameraToggling = false; break;
    }
  });
}

export function applyVehicleControls(dt) {
  const speedKmh = chassisBody.velocity.length() * 3.6;
  let steerVal = CONFIG.MAX_STEER;
  if (CONFIG.STEER_SPEED_FALLOFF) steerVal = CONFIG.MAX_STEER * THREE.MathUtils.clamp(1 - speedKmh / 180, 0.35, 1);

  vehicle.setSteeringValue(controlState.left ? steerVal : controlState.right ? -steerVal : 0, 0);
  vehicle.setSteeringValue(controlState.left ? steerVal : controlState.right ? -steerVal : 0, 1);

  // NOTE: positive engine force drives the chassis toward -Z (the direction the whole
  // city/road is generated in) given our wheel connection layout — verified empirically.
  const forceCap = speedKmh < CONFIG.MAX_SPEED_KMH ? CONFIG.ENGINE_FORCE : 0;
  vehicle.applyEngineForce(controlState.forward ? forceCap : controlState.backward ? -forceCap * 0.6 : 0, 2);
  vehicle.applyEngineForce(controlState.forward ? forceCap : controlState.backward ? -forceCap * 0.6 : 0, 3);

  const brake = controlState.handbrake ? CONFIG.HANDBRAKE_FORCE : (!controlState.forward && !controlState.backward ? CONFIG.BRAKE_FORCE * 0.15 : 0);
  vehicle.setBrake(brake, 0); vehicle.setBrake(brake, 1);
  vehicle.setBrake(controlState.handbrake ? CONFIG.HANDBRAKE_FORCE : 0, 2);
  vehicle.setBrake(controlState.handbrake ? CONFIG.HANDBRAKE_FORCE : 0, 3);
}
