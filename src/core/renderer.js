import * as THREE from 'three';

export const canvas = document.getElementById('canvas');

// powerPreference: on a laptop with both an integrated and a dedicated GPU the browser otherwise tends to run WebGL
// on the integrated one to save power; this asks for the dedicated GPU. No stencil buffer is used anywhere.
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The scene is drawn up to four times a frame (main view + three mirrors). By default every one
// of those draws would redo the sun's shadow map; instead main.js requests it once per frame.
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// far=500 (not 1000) buys noticeably better depth-buffer precision over the visible range;
// scene.fog already fades everything to sky color well before that anyway — and applyPerformance()
// (core/performance.js) then pulls the far plane in to where the fog is total, so nothing
// invisible is drawn.
export const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);

// Mirror cameras (rendered into their small DOM-rect viewports, see systems/cameraRig.js).
// Layer 1 holds the player's own car, hidden from the main FPV camera (it sits inside the
// cabin geometry) but shown here so the car is actually visible in its own mirrors. The cockpit
// lives on layer 2, which only the main camera draws (see entities/cabin.js).
export const mirrorCamera = new THREE.PerspectiveCamera(36, 240 / 84, 0.1, 300);       // rearview
export const leftMirrorCamera = new THREE.PerspectiveCamera(50, 190 / 120, 0.1, 300);  // driver-side wing mirror
export const rightMirrorCamera = new THREE.PerspectiveCamera(50, 190 / 120, 0.1, 300); // passenger-side wing mirror
[mirrorCamera, leftMirrorCamera, rightMirrorCamera].forEach(c => c.layers.enable(1));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
