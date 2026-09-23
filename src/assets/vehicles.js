import * as THREE from 'three';
import { box, cyl } from './primitives.js';

// Mesh.clone() shares the material, which would make a left lamp light up together with its
// right-hand twin. Every indicator lamp gets its own material so each side blinks independently.
function cloneLamp(lamp) {
  const copy = lamp.clone();
  copy.material = lamp.material.clone();
  return copy;
}

export function buildWheelMesh() {
  const g = new THREE.Group();
  const tire = cyl(0.4, 0.4, 0.28, 0x151515, 14);
  tire.rotation.z = Math.PI / 2;
  const hub = cyl(0.18, 0.18, 0.30, 0x999999, 8);
  hub.rotation.z = Math.PI / 2;
  g.add(tire, hub);
  return g;
}

// ---- Sedan (player + generic AI car) ----
export function buildSedan(color = 0xcc2b2b) {
  const g = new THREE.Group();
  const body = box(1.9, 0.55, 4.3, color);
  body.position.y = 0.55;
  const cabin = box(1.55, 0.5, 2.1, color, { roughness: 0.4 });
  cabin.position.set(0, 1.0, -0.15);
  const glass = box(1.6, 0.42, 2.15, 0x9fd6e8, { transparent: true, opacity: 0.55, metalness: 0.3, roughness: 0.1 });
  glass.position.set(0, 1.02, -0.15);
  const bumperF = box(1.95, 0.25, 0.3, 0x222222);
  bumperF.position.set(0, 0.32, -2.15);
  const bumperR = bumperF.clone(); bumperR.position.z = 2.15;
  const headlightL = box(0.3, 0.18, 0.08, 0xfff7cc, { emissive: 0xfff7cc, emissiveIntensity: 0.6 });
  headlightL.position.set(-0.7, 0.55, -2.16);
  const headlightR = headlightL.clone(); headlightR.position.x = 0.7;
  const tailL = box(0.3, 0.18, 0.08, 0xff2b2b, { emissive: 0xff0000, emissiveIntensity: 0.3 });
  tailL.position.set(-0.75, 0.55, 2.16);
  const tailR = tailL.clone(); tailR.position.x = 0.75;
  g.add(body, cabin, glass, bumperF, bumperR, headlightL, headlightR, tailL, tailR);

  // Indicator lamps (used for lane-change signaling + hazard blinking)
  const indL = box(0.12, 0.12, 0.12, 0xffa000, { emissive: 0xffa000, emissiveIntensity: 0 });
  indL.position.set(-0.95, 0.55, -2.1);
  const indR = cloneLamp(indL); indR.position.x = 0.95;
  const indLR = cloneLamp(indL); indLR.position.z = 2.1;
  const indRR = cloneLamp(indR); indRR.position.z = 2.1;
  g.add(indL, indR, indLR, indRR);
  g.userData.indicators = { left: [indL, indLR], right: [indR, indRR] };
  g.userData.tailLights = [tailL, tailR];

  const wheels = [];
  const wp = [[-0.95, 0.4, -1.4], [0.95, 0.4, -1.4], [-0.95, 0.4, 1.35], [0.95, 0.4, 1.35]];
  wp.forEach(p => { const w = buildWheelMesh(); w.position.set(...p); g.add(w); wheels.push(w); });
  g.userData.wheels = wheels;
  return g;
}

// ---- Mototaxi (3-wheeled) ----
export function buildMototaxi(color = 0xffcc00) {
  const g = new THREE.Group();
  const rearCabin = box(1.35, 1.1, 1.5, color);
  rearCabin.position.set(0, 0.85, 0.55);
  const canvasRoof = box(1.4, 0.06, 1.6, 0x2a4d6e);
  canvasRoof.position.set(0, 1.45, 0.55);
  const frontFairing = cyl(0.35, 0.42, 0.9, color, 10);
  frontFairing.rotation.z = Math.PI / 2;
  frontFairing.position.set(0, 0.75, -0.85);
  const seat = box(0.35, 0.5, 0.4, 0x333333);
  seat.position.set(0, 0.85, -0.55);
  const headlight = box(0.22, 0.15, 0.06, 0xfff7cc, { emissive: 0xfff7cc, emissiveIntensity: 0.6 });
  headlight.position.set(0, 0.8, -1.28);
  g.add(rearCabin, canvasRoof, frontFairing, seat, headlight);

  const indL = box(0.1, 0.1, 0.1, 0xffa000, { emissive: 0xffa000, emissiveIntensity: 0 });
  indL.position.set(-0.55, 0.7, 1.25);
  const indR = cloneLamp(indL); indR.position.x = 0.55;
  g.add(indL, indR);
  g.userData.indicators = { left: [indL], right: [indR] };
  g.userData.tailLights = [];

  const wheels = [];
  const frontWheel = buildWheelMesh(); frontWheel.scale.set(0.85, 0.85, 0.85); frontWheel.position.set(0, 0.35, -1.25);
  const rl = buildWheelMesh(); rl.position.set(-0.72, 0.35, 0.95);
  const rr = buildWheelMesh(); rr.position.set(0.72, 0.35, 0.95);
  g.add(frontWheel, rl, rr);
  wheels.push(frontWheel, rl, rr);
  g.userData.wheels = wheels;
  return g;
}

// ---- Combi van (public transit) ----
export function buildCombi(color = 0x2266aa) {
  const g = new THREE.Group();
  const body = box(2.1, 1.7, 5.6, color);
  body.position.y = 1.05;
  const windshield = box(2.05, 0.6, 0.1, 0x9fd6e8, { transparent: true, opacity: 0.5 });
  windshield.position.set(0, 1.5, -2.7);
  const stripe = box(2.12, 0.25, 5.62, 0xffffff);
  stripe.position.y = 0.75;
  const bumperF = box(2.15, 0.3, 0.3, 0x222222); bumperF.position.set(0, 0.35, -2.8);
  const bumperR = bumperF.clone(); bumperR.position.z = 2.8;
  const headlightL = box(0.3, 0.2, 0.08, 0xfff7cc, { emissive: 0xfff7cc, emissiveIntensity: 0.6 });
  headlightL.position.set(-0.75, 0.9, -2.81);
  const headlightR = headlightL.clone(); headlightR.position.x = 0.75;
  const tailL = box(0.3, 0.2, 0.08, 0xff2b2b, { emissive: 0xff0000, emissiveIntensity: 0.3 });
  tailL.position.set(-0.8, 0.9, 2.81);
  const tailR = tailL.clone(); tailR.position.x = 0.8;
  g.add(body, windshield, stripe, bumperF, bumperR, headlightL, headlightR, tailL, tailR);

  const indL = box(0.14, 0.14, 0.14, 0xffa000, { emissive: 0xffa000, emissiveIntensity: 0 });
  indL.position.set(-1.05, 0.9, -2.75);
  const indR = cloneLamp(indL); indR.position.x = 1.05;
  const indLR = cloneLamp(indL); indLR.position.z = 2.75;
  const indRR = cloneLamp(indR); indRR.position.z = 2.75;
  g.add(indL, indR, indLR, indRR);
  g.userData.indicators = { left: [indL, indLR], right: [indR, indRR] };
  g.userData.tailLights = [tailL, tailR];

  const wheels = [];
  const wp = [[-1.05, 0.42, -1.8], [1.05, 0.42, -1.8], [-1.05, 0.42, 1.9], [1.05, 0.42, 1.9]];
  wp.forEach(p => { const w = buildWheelMesh(); w.scale.set(1.1, 1.1, 1.1); w.position.set(...p); g.add(w); wheels.push(w); });
  g.userData.wheels = wheels;
  return g;
}
