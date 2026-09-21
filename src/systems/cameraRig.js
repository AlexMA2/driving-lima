import * as THREE from 'three';
import { renderer, camera, mirrorCamera } from '../core/renderer.js';
import { scene } from '../core/scene.js';
import { chassisBody } from '../entities/player.js';
import { controlState } from './input.js';

const chaseOffset = new THREE.Vector3(0, 4.2, 9.5);
const hoodOffset = new THREE.Vector3(0, 1.25, -1.6);

export function updateCameraRig() {
  const carPos = new THREE.Vector3().copy(chassisBody.position);
  const carQuat = new THREE.Quaternion().copy(chassisBody.quaternion);

  if (controlState.cameraMode === 'chase') {
    const desired = chaseOffset.clone().applyQuaternion(carQuat).add(carPos);
    camera.position.lerp(desired, 0.12);
    const lookAt = carPos.clone().add(new THREE.Vector3(0, 1, 0));
    camera.lookAt(lookAt);
  } else {
    const desired = hoodOffset.clone().applyQuaternion(carQuat).add(carPos);
    camera.position.copy(desired);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(carQuat).add(desired);
    camera.lookAt(fwd);
  }

  // rear mirror: looks backward from the car
  const mirrorPos = new THREE.Vector3(0, 1.6, 0.6).applyQuaternion(carQuat).add(carPos);
  mirrorCamera.position.copy(mirrorPos);
  const mirrorLook = new THREE.Vector3(0, 0, 1).applyQuaternion(carQuat).add(mirrorPos);
  mirrorCamera.up.set(0, 1, 0);
  mirrorCamera.lookAt(mirrorLook);
}

// Renders the rear-view mirror into the small #mirrorViewport DOM rectangle via scissor.
// NOTE: the #mirrorViewport CSS must keep a transparent background, otherwise it paints
// over this render since it sits in front of the canvas in the DOM stacking order.
export function renderMirrorViewport() {
  const mv = document.getElementById('mirrorViewport').getBoundingClientRect();
  const dpr = renderer.getPixelRatio();
  const mx = mv.left * dpr, my = (window.innerHeight - mv.bottom) * dpr, mw = mv.width * dpr, mh = mv.height * dpr;
  renderer.setScissorTest(true);
  renderer.setScissor(mx, my, mw, mh);
  renderer.setViewport(mx, my, mw, mh);
  mirrorCamera.aspect = mv.width / mv.height;
  mirrorCamera.updateProjectionMatrix();
  renderer.render(scene, mirrorCamera);
  renderer.setScissorTest(false);
}
