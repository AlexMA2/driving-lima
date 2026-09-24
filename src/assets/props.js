import * as THREE from 'three';
import { box, cyl } from './primitives.js';

export function buildCone() {
  const g = new THREE.Group();
  const base = cyl(0.35, 0.4, 0.06, 0xff6a00, 12); base.position.y = 0.03;
  const body = cyl(0.03, 0.22, 0.55, 0xff6a00, 12); body.position.y = 0.31;
  const stripe = cyl(0.16, 0.2, 0.08, 0xffffff, 12); stripe.position.y = 0.45;
  g.add(base, body, stripe);
  return g;
}

export function buildSpeedBump(width) {
  const g = new THREE.Group();
  const bump = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, width, 10, 1, false, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xffd54a, roughness: 0.9 })
  );
  bump.rotation.z = Math.PI / 2;
  bump.rotation.y = Math.PI / 2;
  bump.position.y = 0.02;
  bump.castShadow = true; bump.receiveShadow = true;
  g.add(bump);
  return g;
}

// flipFacing: callers that swing the arm to the road's other side with `rotation.y = Math.PI`
// also flip which world direction the lamp housing's open face ends up pointing (a 180° turn
// negates both the arm's and the lamps' local offsets), which turns the lamps to face away from
// the approaching driver — invisible, hidden behind the opaque housing. Pass true in that case so
// the lamps are built on the housing's other local side and come out facing the right way after
// the rotation. Callers that reorient with a different angle (e.g. -90°) don't need it.
export function buildTrafficLightPole(flipFacing = false) {
  const g = new THREE.Group();
  const pole = cyl(0.09, 0.09, 4.2, 0x333333, 8); pole.position.y = 2.1;
  const arm = box(2.6, 0.1, 0.1, 0x333333); arm.position.set(1.3, 4.1, 0);
  const housing = box(0.4, 1.05, 0.4, 0x151515); housing.position.set(2.5, 3.6, 0);
  const faceZ = flipFacing ? -0.21 : 0.21;
  const red = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0x000000 }));
  red.position.set(2.5, 3.95, faceZ);
  const yellow = red.clone(); yellow.material = yellow.material.clone(); yellow.material.color.set(0x554400); yellow.position.set(2.5, 3.6, faceZ);
  const green = red.clone(); green.material = green.material.clone(); green.material.color.set(0x004d00); green.position.set(2.5, 3.25, faceZ);
  g.add(pole, arm, housing, red, yellow, green);
  g.userData.lights = { red, yellow, green };
  return g;
}

export function buildSign(text, bg = 0xffcc00, shape = 'rect') {
  const g = new THREE.Group();
  const pole = cyl(0.06, 0.06, 2.2, 0x777777, 6); pole.position.y = 1.1;
  let plate;
  if (shape === 'octagon') {
    plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xcc1111 }));
    plate.rotation.x = Math.PI / 2;
  } else {
    plate = box(1.15, 0.65, 0.05, bg);
  }
  plate.position.y = 2.25;
  plate.rotation.y = Math.PI / 2 - 0.001;

  // simple canvas texture with the sign text
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 160;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 248, 152);
  ctx.fillStyle = '#111'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((l, i) => ctx.fillText(l, 128, 80 + (i - (lines.length - 1) / 2) * 38));
  const tex = new THREE.CanvasTexture(cvs);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), faceMat);
  face.position.set(0, 2.25, 0.03);

  g.add(plate, pole, face);
  return g;
}

// Octagonal red PARE sign on a pole; the face is a canvas texture on an 8-sided disc.
export function buildStopSign() {
  const g = new THREE.Group();
  const pole = cyl(0.06, 0.06, 2.4, 0x777777, 6); pole.position.y = 1.2;

  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 256;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#c62828'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 10; ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    const x = 128 + 112 * Math.cos(a), y = 128 - 112 * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 74px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PARE', 128, 132);

  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 8, Math.PI / 8),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cvs), side: THREE.DoubleSide })
  );
  face.position.set(0, 2.3, 0.04);
  g.add(pole, face);
  return g;
}

export function buildPedestrian(shirtColor) {
  const g = new THREE.Group();
  const legs = box(0.28, 0.7, 0.2, 0x2b2b3a); legs.position.y = 0.35;
  const torso = box(0.32, 0.5, 0.22, shirtColor); torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), new THREE.MeshStandardMaterial({ color: 0xe0b088 }));
  head.position.y = 1.32;
  g.add(legs, torso, head);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}
