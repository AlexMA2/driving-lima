import * as THREE from 'three';
import { camera } from '../core/renderer.js';

// All cockpit geometry is parented to the camera itself, so it rides perfectly rigid with
// the first-person view with zero extra sync code — no chase/hood toggle to keep consistent.
export let steeringWheelSpin; // rotate .rotation.z each frame to match the wheel angle
let leftIndicatorLamp, rightIndicatorLamp;

// Wheel's position in camera-local space — camera-space IS view-space for a direct camera
// child, so systems/input.js reuses this exact point to project the wheel's on-screen
// center (via camera.projectionMatrix) for mouse-drag angle tracking.
export const WHEEL_LOCAL_POS = new THREE.Vector3(-0.4, -0.4, -0.6);

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.7, metalness: opts.metalness ?? 0.15, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0 });
}
function part(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  return m;
}

export function buildCockpit() {
  const g = new THREE.Group();
  g.name = 'cockpit';
  const trim = mat(0x181818, { roughness: 0.85 });

  // Dashboard
  const dash = part(new THREE.BoxGeometry(1.7, 0.38, 0.55), mat(0x1c1c1c, { roughness: 0.75 }));
  dash.position.set(0, -0.56, -0.78);
  g.add(dash);

  // A-pillars + windshield header + door sills frame the glass area
  const pillarL = part(new THREE.BoxGeometry(0.1, 0.95, 0.1), trim);
  pillarL.position.set(-0.88, -0.1, -0.92); pillarL.rotation.z = 0.14;
  const pillarR = part(new THREE.BoxGeometry(0.1, 0.95, 0.1), trim);
  pillarR.position.set(0.88, -0.1, -0.92); pillarR.rotation.z = -0.14;
  const visor = part(new THREE.BoxGeometry(1.75, 0.08, 0.22), trim);
  visor.position.set(0, 0.42, -0.9);
  const doorL = part(new THREE.BoxGeometry(0.07, 0.7, 1.5), trim);
  doorL.position.set(-0.98, -0.28, 0.15);
  const doorR = part(new THREE.BoxGeometry(0.07, 0.7, 1.5), trim);
  doorR.position.set(0.98, -0.28, 0.15);
  g.add(pillarL, pillarR, visor, doorL, doorR);

  // Steering wheel: tilt lives on the mount, spin lives on the child so it rotates on its own axis
  const wheelMount = new THREE.Group();
  wheelMount.position.copy(WHEEL_LOCAL_POS);
  wheelMount.rotation.x = -0.6;
  const wheelSpin = new THREE.Group();
  const rimMat = mat(0x161616, { roughness: 0.55 });
  const rim = part(new THREE.TorusGeometry(0.19, 0.026, 10, 24), rimMat);
  const spokeMat = mat(0x2b2b2b, { roughness: 0.55, metalness: 0.3 });
  const spokeH = part(new THREE.BoxGeometry(0.37, 0.032, 0.022), spokeMat);
  const spokeV = part(new THREE.BoxGeometry(0.032, 0.19, 0.022), spokeMat);
  const hub = part(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12), spokeMat);
  hub.rotation.x = Math.PI / 2;
  wheelSpin.add(rim, spokeH, spokeV, hub);
  wheelMount.add(wheelSpin);
  const column = part(new THREE.CylinderGeometry(0.035, 0.045, 0.32, 8), spokeMat);
  column.rotation.x = Math.PI / 2;
  column.position.set(0, -0.08, 0.16);
  wheelMount.add(column);
  g.add(wheelMount);
  steeringWheelSpin = wheelSpin;

  // Instrument binnacle + turn-signal indicator lamps (blink in sync with the HUD dots)
  const cluster = part(new THREE.BoxGeometry(0.32, 0.15, 0.08), mat(0x101010));
  cluster.position.set(-0.4, -0.32, -0.68);
  g.add(cluster);
  leftIndicatorLamp = part(new THREE.BoxGeometry(0.035, 0.035, 0.01), mat(0x332b00));
  leftIndicatorLamp.position.set(-0.49, -0.29, -0.635);
  rightIndicatorLamp = part(new THREE.BoxGeometry(0.035, 0.035, 0.01), mat(0x332b00));
  rightIndicatorLamp.position.set(-0.31, -0.29, -0.635);
  g.add(leftIndicatorLamp, rightIndicatorLamp);

  // Rearview mirror housing (the reflection itself is rendered into #mirrorViewport)
  const mirrorArm = part(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), trim);
  mirrorArm.rotation.x = Math.PI / 2; mirrorArm.position.set(0, 0.35, -0.68);
  const mirrorHousing = part(new THREE.BoxGeometry(0.34, 0.09, 0.03), trim);
  mirrorHousing.position.set(0, 0.41, -0.7);
  g.add(mirrorArm, mirrorHousing);

  // Side mirror housings, just inside the door frame at each window
  const sideMirrorL = part(new THREE.BoxGeometry(0.1, 0.09, 0.06), trim);
  sideMirrorL.position.set(-1.0, 0.06, -0.5);
  const sideMirrorR = part(new THREE.BoxGeometry(0.1, 0.09, 0.06), trim);
  sideMirrorR.position.set(1.0, 0.06, -0.5);
  g.add(sideMirrorL, sideMirrorR);

  camera.add(g);
  return g;
}

export function updateCockpit(wheelAngleRad, signalLeft, signalRight, blinkOn) {
  if (steeringWheelSpin) steeringWheelSpin.rotation.z = wheelAngleRad;
  leftIndicatorLamp.material.emissive.set(signalLeft && blinkOn ? 0xffa000 : 0x000000);
  leftIndicatorLamp.material.emissiveIntensity = signalLeft && blinkOn ? 1.2 : 0;
  rightIndicatorLamp.material.emissive.set(signalRight && blinkOn ? 0xffa000 : 0x000000);
  rightIndicatorLamp.material.emissiveIntensity = signalRight && blinkOn ? 1.2 : 0;
}
