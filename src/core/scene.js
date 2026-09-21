import * as THREE from 'three';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc6e8);
scene.fog = new THREE.Fog(0x8fc6e8, 60, 260);

// ---- Lighting: warm daylight with dynamic shadows ----
export const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a3226, 0.65);
scene.add(hemi);

export const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.0015;
scene.add(sun);
scene.add(sun.target);

// Keeps the sun + shadow frustum centered on the player so shadows stay sharp over a long road.
export function updateSun(playerPos) {
  sun.position.set(playerPos.x + 25, playerPos.y + 40, playerPos.z + 20);
  sun.target.position.set(playerPos.x, playerPos.y, playerPos.z);
  sun.target.updateMatrixWorld();
}
