import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rand, choice } from '../utils/rng.js';
import { scene } from '../core/scene.js';
import { ROAD_HALF_WIDTH } from './road.js';

// Low-poly colored-box skyline lining both sidewalks, drawn as one InstancedMesh per side pair.
export function buildBuildings(scenario) {
  const buildingPalette = [0xd9c79e, 0xc8896b, 0xdfe3e6, 0x9fb6c9, 0xe8d5a0, 0xb98d6f, 0xcbb4d1];
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const spacing = 14;
  const perSide = Math.floor(scenario.roadLength / spacing);
  const inst = new THREE.InstancedMesh(geo, mat, perSide * 2);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let idx = 0;

  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const w = rand(6, 11), h = rand(4, 26), d = rand(6, 11);
      const x = side * (ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH + w / 2 + rand(0.5, 3));
      const z = -i * spacing - rand(-2, 2) - 8;
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);
      inst.setColorAt(idx, color.setHex(choice(buildingPalette)));
      idx++;
    }
  }

  inst.castShadow = true; inst.receiveShadow = true;
  scene.add(inst);
}
