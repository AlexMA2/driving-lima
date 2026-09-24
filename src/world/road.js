import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config.js';
import { scene } from '../core/scene.js';
import { world, groundMaterial, propMaterial } from '../core/physics.js';
import { box } from '../assets/primitives.js';

// Peru drives on the right-hand side of the road: your own lanes sit on the side that
// keeps the curb/sidewalk next to the car's right (passenger) side, oncoming traffic
// passes on your left across the centerline. Positive-x lanes are "your" lanes (moving -Z);
// negative-x lanes are oncoming (moving +Z). See laneDir() below.
export let ROAD_HALF_WIDTH = CONFIG.LANE_WIDTH * 2;
export let LANE_X = [];          // all lane centers, sorted ascending (oncoming first, own last)
export let PLAYER_LANES = [];    // own-direction lane centers (positive x), inner-most first
export let ONCOMING_LANES = [];  // oncoming lane centers (negative x), inner-most first
export let WORLD_Z_START = 0;
export let WORLD_Z_END = 0;

export function laneDir(x) { return x > 0 ? -1 : 1; }

// Builds the shared lane-marking set (dashed dividers + solid edge lines) for a straight
// stretch of road between [zStart, zEnd] with `laneCountPerSide` lanes each direction.
// Reused by the single-corridor scenarios and, per-street, by the grid city.
// Markings sit just above the asphalt's actual top face (asphalt is a 0.3-tall box centered
// 0.05 below y=0, so its top face is at y=0.10) — anything drawn below that is buried inside
// the opaque asphalt block and never rendered.
const MARK_Y = 0.105;

export function buildLaneMarkings(centerX, laneCountPerSide, zStart, zEnd, laneWidth = CONFIG.LANE_WIDTH) {
  const halfWidth = laneCountPerSide * laneWidth;
  const length = Math.abs(zStart - zEnd);
  const zMid = (zStart + zEnd) / 2;

  // Center double-yellow line
  [-0.15, 0.15].forEach(ox => {
    const line = box(0.12, 0.02, length, 0xffcc00, { emissive: 0x554400, emissiveIntensity: 0.2 });
    line.position.set(centerX + ox, MARK_Y, zMid);
    scene.add(line);
  });

  // Solid white edge lines at the outer curb of each side
  [-halfWidth, halfWidth].forEach(ox => {
    const line = box(0.14, 0.02, length, 0xf2f2f2);
    line.position.set(centerX + ox, MARK_Y, zMid);
    scene.add(line);
  });

  // Dashed white dividers between same-direction lanes
  const dashGeo = new THREE.BoxGeometry(0.14, 0.02, 3);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  for (let i = 1; i < laneCountPerSide; i++) {
    [1, -1].forEach(sign => {
      const x = centerX + sign * i * laneWidth;
      const count = Math.max(1, Math.floor(length / 6));
      const inst = new THREE.InstancedMesh(dashGeo, dashMat, count);
      const dummy = new THREE.Object3D();
      const zTop = Math.max(zStart, zEnd);
      for (let d = 0; d < count; d++) {
        dummy.position.set(x, MARK_Y, zTop - d * 6 - 2);
        dummy.updateMatrix();
        inst.setMatrixAt(d, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
    });
  }
}

// Computes the lane centres (and half road width) for a road with `laneCountPerSide` lanes each
// way, centred on x=0. Scenarios that lay their own asphalt (the tutorial course) call this
// directly so the lane-change rule and AI still know where the lanes are.
export function setLaneLayout(laneCountPerSide) {
  ROAD_HALF_WIDTH = laneCountPerSide * CONFIG.LANE_WIDTH;
  LANE_X = []; PLAYER_LANES = []; ONCOMING_LANES = [];
  for (let i = 0; i < laneCountPerSide; i++) {
    const own = (i + 0.5) * CONFIG.LANE_WIDTH;
    const onc = -(i + 0.5) * CONFIG.LANE_WIDTH;
    PLAYER_LANES.push(own);
    ONCOMING_LANES.push(onc);
  }
  LANE_X = [...ONCOMING_LANES].reverse().concat(PLAYER_LANES).sort((a, b) => a - b);
}

export function buildRoad(scenario) {
  const laneCountPerSide = scenario.laneCountPerSide;
  const roadLength = scenario.roadLength;
  WORLD_Z_START = 0;
  WORLD_Z_END = -roadLength;
  setLaneLayout(laneCountPerSide);

  // Large static ground plane (also what RaycastVehicle wheels raycast against)
  const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(0, 0, -roadLength / 2);
  world.addBody(groundBody);

  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(400, roadLength + 400),
    new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 1 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(0, -0.01, -roadLength / 2);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Asphalt strip. Kept a healthy ~10cm above the ground plane (not just a millimeter or two)
  // so the two coplanar-ish surfaces don't z-fight at the long view distances the cockpit
  // camera sees down a long straight road.
  const asphalt = box(ROAD_HALF_WIDTH * 2, 0.3, roadLength, 0x3a3a3f, { roughness: 1 });
  asphalt.position.set(0, -0.05, -roadLength / 2);
  asphalt.receiveShadow = true;
  scene.add(asphalt);

  // Sidewalks (+ a curb collider to detect driving onto them — see the ticket logic below)
  [-1, 1].forEach(side => {
    const sw = box(CONFIG.SIDEWALK_WIDTH, 0.18, roadLength, 0xb9b6ad);
    sw.position.set(side * (ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH / 2), 0.05, -roadLength / 2);
    sw.receiveShadow = true;
    scene.add(sw);

    // The collision box exists only to detect the hit for systems/rules.js's ticket, not to
    // block movement: collisionResponse is off, so the chassis just drives up and over the curb
    // (a real wall here used to either stop the car dead or, with a curb-height collider, tip
    // and "high-center" it with its wheels off the ground and no traction).
    const curbBody = new CANNON.Body({ mass: 0, material: propMaterial });
    curbBody.addShape(new CANNON.Box(new CANNON.Vec3(CONFIG.SIDEWALK_WIDTH / 2, 1, roadLength / 2)));
    curbBody.position.set(side * (ROAD_HALF_WIDTH + CONFIG.SIDEWALK_WIDTH / 2), 0.05, -roadLength / 2);
    curbBody.userData = { isPenalized: false, isStatic: true, isCurb: true };
    curbBody.collisionResponse = false;
    world.addBody(curbBody);
  });

  buildLaneMarkings(0, laneCountPerSide, 0, -roadLength);
}
