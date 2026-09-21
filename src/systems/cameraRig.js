import * as THREE from 'three';
import { renderer, camera, mirrorCamera, leftMirrorCamera, rightMirrorCamera } from '../core/renderer.js';
import { scene } from '../core/scene.js';
import { chassisBody } from '../entities/player.js';

// Cockpit (first-person, driver's seat) is the only view. Eye sits toward the car's left
// side (LHD, matches real Peruvian cars) at head height, just behind the wheel.
const eyeOffset = new THREE.Vector3(-0.38, 1.18, -0.25);
const eyePitch = -0.035; // a hair downward so the dashboard/road read naturally

const rearMirrorOffset = new THREE.Vector3(0, 1.62, -0.55);
const leftMirrorOffset = new THREE.Vector3(-0.98, 1.05, -0.5);
const rightMirrorOffset = new THREE.Vector3(0.98, 1.05, -0.5);
const backwardLocal = new THREE.Vector3(0, 0, 1);
const backLeftLocal = new THREE.Vector3(-0.6, -0.05, 0.8).normalize();
const backRightLocal = new THREE.Vector3(0.6, -0.05, 0.8).normalize();

const smoothPos = new THREE.Vector3();
const smoothQuat = new THREE.Quaternion();
let initialized = false;

export function updateCameraRig() {
  const carPos = new THREE.Vector3().copy(chassisBody.position);
  const carQuat = new THREE.Quaternion().copy(chassisBody.quaternion);

  const desiredPos = eyeOffset.clone().applyQuaternion(carQuat).add(carPos);
  const desiredQuat = carQuat.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(eyePitch, 0, 0)));

  if (!initialized) { smoothPos.copy(desiredPos); smoothQuat.copy(desiredQuat); initialized = true; }
  // Light damping takes the edge off suspension jitter without decoupling the view from the car.
  smoothPos.lerp(desiredPos, 0.55);
  smoothQuat.slerp(desiredQuat, 0.55);
  camera.position.copy(smoothPos);
  camera.quaternion.copy(smoothQuat);

  // rear mirror: looks backward from the car
  const mirrorPos = rearMirrorOffset.clone().applyQuaternion(carQuat).add(carPos);
  mirrorCamera.position.copy(mirrorPos);
  const mirrorLook = backwardLocal.clone().applyQuaternion(carQuat).add(mirrorPos);
  mirrorCamera.up.set(0, 1, 0);
  mirrorCamera.lookAt(mirrorLook);

  // left wing mirror
  const lPos = leftMirrorOffset.clone().applyQuaternion(carQuat).add(carPos);
  leftMirrorCamera.position.copy(lPos);
  leftMirrorCamera.up.set(0, 1, 0);
  leftMirrorCamera.lookAt(backLeftLocal.clone().applyQuaternion(carQuat).add(lPos));

  // right wing mirror
  const rPos = rightMirrorOffset.clone().applyQuaternion(carQuat).add(carPos);
  rightMirrorCamera.position.copy(rPos);
  rightMirrorCamera.up.set(0, 1, 0);
  rightMirrorCamera.lookAt(backRightLocal.clone().applyQuaternion(carQuat).add(rPos));
}

function renderScissorViewport(elId, cam) {
  const el = document.getElementById(elId);
  const mv = el.getBoundingClientRect();
  if (mv.width <= 0 || mv.height <= 0) return;
  const dpr = renderer.getPixelRatio();
  const mx = mv.left * dpr, my = (window.innerHeight - mv.bottom) * dpr, mw = mv.width * dpr, mh = mv.height * dpr;
  renderer.setScissorTest(true);
  renderer.setScissor(mx, my, mw, mh);
  renderer.setViewport(mx, my, mw, mh);
  cam.aspect = mv.width / mv.height;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  renderer.setScissorTest(false);
}

// Renders the rearview + both wing mirrors into their small DOM-rect viewports via scissor.
// NOTE: each viewport's CSS must keep a transparent background, otherwise it paints over
// this render since it sits in front of the canvas in the DOM stacking order.
export function renderMirrorViewports() {
  renderScissorViewport('mirrorViewport', mirrorCamera);
  renderScissorViewport('leftMirrorViewport', leftMirrorCamera);
  renderScissorViewport('rightMirrorViewport', rightMirrorCamera);
}
