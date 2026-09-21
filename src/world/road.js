import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config.js';
import { scene } from '../core/scene.js';
import { world, groundMaterial, propMaterial } from '../core/physics.js';
import { box } from '../assets/primitives.js';

export const LANE_X = [-1.5 * CONFIG.LANE_WIDTH, -0.5 * CONFIG.LANE_WIDTH, 0.5 * CONFIG.LANE_WIDTH, 1.5 * CONFIG.LANE_WIDTH];
export const ROAD_HALF_WIDTH = CONFIG.LANE_WIDTH * 2;
export const WORLD_Z_START = 0;
export const WORLD_Z_END = -CONFIG.ROAD_LENGTH;

// Negative-x lanes travel -Z (player's direction), positive-x lanes travel +Z (oncoming).
export function laneDir(x) { return x < 0 ? -1 : 1; }

export function buildRoad() {
  // Large static ground plane (also what RaycastVehicle wheels raycast against)
  const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(0, 0, -CONFIG.ROAD_LENGTH / 2);
  world.addBody(groundBody);

  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(400, CONFIG.ROAD_LENGTH + 400),
    new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 1 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(0, -0.01, -CONFIG.ROAD_LENGTH / 2);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Asphalt strip. Kept a healthy ~10cm above the ground plane (not just a millimeter or two)
  // so the two coplanar-ish surfaces don't z-fight at the long view distances the chase
  // camera sees down a 3km straight road.
  const asphalt = box(ROAD_HALF_WIDTH * 2, 0.3, CONFIG.ROAD_LENGTH, 0x3a3a3f, { roughness: 1 });
  asphalt.position.set(0, -0.05, -CONFIG.ROAD_LENGTH / 2);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  // Sidewalks (+ curb collision so the player can't drive onto them, but isn't penalized for it)
  [-1, 1].forEach(side => {
    const sw = box(CONFIG.SIDEWALK_WIDTH, 0.18, CONFIG.ROAD_LENGTH, 0xb9b6ad);
    sw.position.set(side * (ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH / 2), 0.05, -CONFIG.ROAD_LENGTH / 2);
    sw.receiveShadow = true;
    scene.add(sw);

    const curbBody = new CANNON.Body({ mass: 0, material: propMaterial });
    curbBody.addShape(new CANNON.Box(new CANNON.Vec3(CONFIG.SIDEWALK_WIDTH / 2, 0.2, CONFIG.ROAD_LENGTH / 2)));
    curbBody.position.set(side * (ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH / 2), 0.05, -CONFIG.ROAD_LENGTH / 2);
    curbBody.userData = { isPenalized: false, isStatic: true };
    world.addBody(curbBody);
  });

  // Center double-yellow line
  [-0.15, 0.15].forEach(ox => {
    const line = box(0.12, 0.02, CONFIG.ROAD_LENGTH, 0xffcc00, { emissive: 0x554400, emissiveIntensity: 0.2 });
    line.position.set(ox, 0.005, -CONFIG.ROAD_LENGTH / 2);
    scene.add(line);
  });

  // Dashed white lane dividers (instanced for the ~500 dashes per side)
  const dashGeo = new THREE.BoxGeometry(0.14, 0.02, 3);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  [-CONFIG.LANE_WIDTH, CONFIG.LANE_WIDTH].forEach(x => {
    const count = Math.floor(CONFIG.ROAD_LENGTH / 6);
    const inst = new THREE.InstancedMesh(dashGeo, dashMat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(x, 0.005, -i * 6 - 2);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    scene.add(inst);
  });
}
