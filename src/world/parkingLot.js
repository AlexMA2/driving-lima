import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PARKING_SIZES } from '../config.js';
import { rand, choice } from '../utils/rng.js';
import { scene } from '../core/scene.js';
import { world, propMaterial } from '../core/physics.js';
import { box } from '../assets/primitives.js';
import { buildSedan } from '../assets/vehicles.js';
import { CAR_HALF_WIDTH, CAR_HALF_LENGTH } from '../entities/player.js';
import { buildGround, barrier, scatterBlockBuildings } from './streetKit.js';
import { setLaneLayout } from './road.js';

// The two parking exercises. Both are laid out the way a driving school's practice ground is,
// with the dimensions real parking uses, so the usual reference points work with this car:
//
//   parallel      — a street with a parking lane along the right-hand kerb. Two parked cars
//                   leave one gap; the kerb, the painted end lines and the neighbours' bumpers
//                   are what you line yourself up with.
//   perpendicular — a car park with a 6.5 m aisle and bays either side (the "batería" layout):
//                   bay lines every `bay` metres, a kerb / wheel stop at the back of each bay.
//
// Seen from above, north is -Z, the player drives north and kerbs/bays are on their right (+X).
// Everything the parking system (systems/parking.js) needs to judge the manoeuvre is in PARKING.

export const PARKING = { mode: null };

const CAR_LENGTH = CAR_HALF_LENGTH * 2;
const LINE_Y = 0.105; // just above the asphalt's top face (see world/road.js)
const PAINT = 0xf2f2f2;
const PARKED_COLORS = [0xcc2b2b, 0x2e7d32, 0x455a64, 0xf9a825, 0x6a1b9a, 0xe0e0e0, 0x212121, 0x8d6e63, 0x00838f, 0xb71c1c];

// Streets here are a stretch of asphalt with curb colliders on the sides — the same idea as
// world/road.js and streetKit.js (see the comment there: they only detect the hit, not block it).
function slab(x0, x1, z0, z1, color, y, height) {
  const m = box(x1 - x0, height, Math.abs(z1 - z0), color, { roughness: 1 });
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function kerb(x0, x1, z0, z1, { touchOk = false } = {}) {
  slab(x0, x1, z0, z1, 0xb9b6ad, 0.05, 0.18); // the sidewalk
  const body = new CANNON.Body({ mass: 0, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3((x1 - x0) / 2, 1, Math.abs(z1 - z0) / 2)));
  body.position.set((x0 + x1) / 2, 0.05, (z0 + z1) / 2);
  body.userData = { isPenalized: false, isStatic: true, isCurb: true, touchOk };
  // No collision response: this still fires 'collide' events for the ticket in systems/rules.js,
  // but doesn't physically block the chassis — the car drives up and over the curb instead of
  // stopping dead against it.
  body.collisionResponse = false;
  world.addBody(body);
}

// paint: a thin flat box lying on the road
function paint(cx, cz, w, d, color = PAINT, opts) {
  const m = box(w, 0.02, d, color, opts);
  m.position.set(cx, LINE_Y, cz);
  m.castShadow = false;
  scene.add(m);
  return m;
}

function parkedCar(x, z, rotY = 0) {
  const mesh = buildSedan(choice(PARKED_COLORS));
  mesh.position.set(x, 0, z);
  mesh.rotation.y = rotY;
  scene.add(mesh);

  const body = new CANNON.Body({ mass: 0, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(CAR_HALF_WIDTH, 0.55, CAR_HALF_LENGTH)));
  body.position.set(x, 0.55, z);
  body.quaternion.setFromEuler(0, rotY, 0);
  body.userData = { isPenalized: false, isStatic: true, isParked: true };
  world.addBody(body);
  return mesh;
}

// A big white "P" painted on the road, facing a driver who is heading north.
function paintLetter(cx, cz, size, text = 'P') {
  const cvs = document.createElement('canvas');
  cvs.width = 256; cvs.height = 256;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#f2f2f2'; ctx.font = 'bold 230px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 138);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, LINE_Y + 0.011, cz);
  scene.add(m);
}

// The green "target" rectangle the guide shows on the ground.
function targetZone(x0, x1, z0, z1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, Math.abs(z1 - z0)),
    new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.22, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, LINE_Y + 0.008, (z0 + z1) / 2);
  scene.add(m);
  return m;
}

function skyline(xs, zs, size, inset) {
  xs.forEach(x => zs.forEach(z => scatterBlockBuildings(x, z, size, inset, [2, 4])));
}

// ---- parallel parking ------------------------------------------------------------------------
//
//   x: -3.5 ......... 0 ......... 3.5 ==== parking lane ==== 6.0 | sidewalk
//      oncoming lane   own lane (x=1.75)      2.5 m wide         kerb
//
// The slot is the gap between the rear bumper of the FRONT car (zF, further north) and the front
// bumper of the REAR car (zR = zF + gap). Cars sit 30 cm off the kerb.
function buildParallel(scenario) {
  const size = PARKING_SIZES[scenario.parkingSpace] ?? PARKING_SIZES.normal;
  const KERB_X = 6.0, LANE_EDGE_X = 3.5, CAR_X = KERB_X - 0.3 - CAR_HALF_WIDTH;
  const zF = -30, zR = zF + size.slot;
  const zStart = 60, zEnd = -80;

  buildGround(0, (zStart + zEnd) / 2, 300, 260);
  slab(-LANE_EDGE_X, KERB_X, zStart, zEnd, 0x3a3a3f, -0.05, 0.3);
  kerb(KERB_X, KERB_X + 3, zStart, zEnd);
  kerb(-LANE_EDGE_X - 3, -LANE_EDGE_X, zStart, zEnd);

  const len = zStart - zEnd, mid = (zStart + zEnd) / 2;
  paint(-0.15, mid, 0.12, len, 0xffcc00, { emissive: 0x554400, emissiveIntensity: 0.2 });   // double yellow centre line
  paint(0.15, mid, 0.12, len, 0xffcc00, { emissive: 0x554400, emissiveIntensity: 0.2 });
  paint(LANE_EDGE_X, mid, 0.14, len);                                                       // solid line: edge of the driving lanes
  // the painted ends of the parking slot, across the whole lane
  paint((LANE_EDGE_X + KERB_X) / 2, zF + 0.1, KERB_X - LANE_EDGE_X, 0.12);
  paint((LANE_EDGE_X + KERB_X) / 2, zR - 0.1, KERB_X - LANE_EDGE_X, 0.12);
  paintLetter((LANE_EDGE_X + KERB_X) / 2, (zF + zR) / 2, 1.8);

  // the row of parked cars: the two that frame the slot are exact, the others sit a little off
  parkedCar(CAR_X, zF - CAR_HALF_LENGTH, 0);
  parkedCar(CAR_X, zR + CAR_HALF_LENGTH, 0);
  for (let k = 1; k <= 3; k++) {
    parkedCar(CAR_X + rand(-0.12, 0.08), zF - CAR_HALF_LENGTH - k * (CAR_LENGTH + rand(0.7, 1.3)), rand(-0.03, 0.03));
  }
  for (let k = 1; k <= 5; k++) {
    if (k === 3) continue; // a second, shorter gap that isn't an exercise
    parkedCar(CAR_X + rand(-0.12, 0.08), zR + CAR_HALF_LENGTH + k * (CAR_LENGTH + rand(0.7, 1.3)), rand(-0.03, 0.03));
  }

  barrier(1.25, zStart + 3, 22, 2);
  barrier(1.25, zEnd - 3, 22, 2);
  skyline([KERB_X + 3 + 45, -LANE_EDGE_X - 3 - 45], [40, -40, -120], 80, 12);

  const zone = targetZone(LANE_EDGE_X + 0.15, KERB_X, zF + 0.16, zR - 0.16);

  Object.assign(PARKING, {
    mode: 'parallel', zone,
    kerbX: KERB_X, laneEdgeX: LANE_EDGE_X, zF, zR, slot: size.slot,
  });
  return { x: 1.75, y: 1.2, z: 45, rotY: 0 };
}

// ---- perpendicular ("en batería") parking --------------------------------------------------------
//
//   x: -8.3 ..... -3.25 | aisle -3.25..3.25 | 3.25 ..... 8.3 : bays, kerb at the back
//
// Bays run along the aisle every `bay` metres. Both sides are full of parked cars except the
// target bay on the right, which sits between two of them.
function buildPerpendicular(scenario) {
  const size = PARKING_SIZES[scenario.parkingSpace] ?? PARKING_SIZES.normal;
  const AISLE = 3.25, DEPTH = 5.2, WALL_X = AISLE + DEPTH;
  const BAYS = 10, TARGET = 5, W = size.bay;
  const zTarget = -22;
  const zBay = (k) => zTarget + (TARGET - k) * W; // bay 0 is the southernmost, bay 9 the northernmost
  const zStart = 34, zEnd = -58;

  buildGround(0, (zStart + zEnd) / 2, 300, 260);
  slab(-WALL_X, WALL_X, zStart, zEnd, 0x3a3a3f, -0.05, 0.3);
  kerb(WALL_X, WALL_X + 3, zStart, zEnd, { touchOk: true });
  kerb(-WALL_X - 3, -WALL_X, zStart, zEnd, { touchOk: true });

  // bay lines: BAYS + 1 lines per side, and a low concrete stop at the back of every bay
  [-1, 1].forEach(side => {
    for (let k = 0; k <= BAYS; k++) {
      const z = zBay(0) + W / 2 - k * W;
      paint(side * (AISLE + DEPTH / 2), z, DEPTH, 0.12);
    }
    for (let k = 0; k < BAYS; k++) {
      const stop = box(W - 0.6, 0.12, 0.16, 0xa9a59b);
      stop.position.set(side * (WALL_X - 0.35), 0.15, zBay(k));
      scene.add(stop);
    }
  });

  // cars in the bays: nose in or reversed in, sitting a touch off-centre like real ones
  const carX = (side) => side * (WALL_X - 0.3 - CAR_HALF_LENGTH + rand(-0.15, 0.25));
  for (let k = 0; k < BAYS; k++) {
    if (k !== TARGET) {
      const noseInto = choice([1, -1]);               // +1: nose toward the back of the bay
      parkedCar(carX(1), zBay(k) + rand(-0.12, 0.12), noseInto > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    if (rand(0, 1) < 0.75) parkedCar(carX(-1), zBay(k) + rand(-0.12, 0.12), choice([Math.PI / 2, -Math.PI / 2]));
  }
  paintLetter(AISLE + DEPTH - 1.6, zBay(TARGET), 1.5);

  barrier(0, zStart + 3, 2 * WALL_X + 6, 2);
  barrier(0, zEnd - 3, 2 * WALL_X + 6, 2);
  skyline([WALL_X + 3 + 45, -WALL_X - 3 - 45], [30, -20, -70], 80, 12);

  const zone = targetZone(AISLE + 0.1, WALL_X, zBay(TARGET) - W / 2 + 0.08, zBay(TARGET) + W / 2 - 0.08);

  Object.assign(PARKING, {
    mode: 'perpendicular', zone,
    aisleX: AISLE, wallX: WALL_X, bayW: W, zBay: zBay(TARGET), bayDepth: DEPTH,
  });
  return { x: 1.4, y: 1.2, z: 20, rotY: 0 };
}

export function buildParkingLot(scenario) {
  setLaneLayout(1); // lane centres (±1.75) for the shared lane helpers; lane rules are off here
  return scenario.parkingMode === 'perpendicular' ? buildPerpendicular(scenario) : buildParallel(scenario);
}
