import * as THREE from 'three';

export const canvas = document.getElementById('canvas');

export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// far=500 (not 1000) buys noticeably better depth-buffer precision over the visible range;
// scene.fog already fades everything to sky color well before that anyway.
export const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

// Rear mirror camera (rendered into the small #mirrorViewport via scissor, see systems/cameraRig.js)
export const mirrorCamera = new THREE.PerspectiveCamera(55, 260 / 90, 0.1, 300);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
