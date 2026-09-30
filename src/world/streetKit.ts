import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CONFIG } from '../config';
import { rand, choice } from '../utils/rng';
import { scene } from '../core/scene';
import { world, groundMaterial, propMaterial } from '../core/physics';
import { box } from '../assets/primitives';

// Building blocks shared by every scenario that lays roads out as discrete streets (the grid
// city, the roundabout arms, the tutorial course): asphalt + markings + curbed sidewalks with
// gaps where other streets cross, a ground plane, filler buildings and traffic-light meshes.

// Markings sit just above the asphalt's actual top face — asphalt is a 0.3-tall box, so its
// top face sits 0.15 above whatever y its center is placed at (asphaltY below). Drawing a
// marking below that buries it inside the opaque asphalt block, where it never renders.
const MARK_CLEARANCE = 0.005;

// Splits [lo, hi] into sub-spans, leaving a `gapHalf`-wide gap either side of every crossing.
export function subSpans(lo: number, hi: number, crossings: number[], gapHalf: number): Array<[number, number]> {
  const gaps = crossings.filter(c => c > lo && c < hi)
    .map((c): [number, number] => [Math.max(lo, c - gapHalf), Math.min(hi, c + gapHalf)])
    .sort((a, b) => a[0] - b[0]);
  const spans: Array<[number, number]> = [];
  let cursor = lo;
  gaps.forEach(([a, b]) => { if (a > cursor) spans.push([cursor, a]); cursor = Math.max(cursor, b); });
  if (cursor < hi) spans.push([cursor, hi]);
  return spans;
}

// Large static ground plane (also what RaycastVehicle wheels raycast against) plus its grass mesh.
export function buildGround(cx: number, cz: number, width: number, depth: number): void {
  const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(cx, 0, cz);
  world.addBody(groundBody);

  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 1 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(cx, -0.01, cz);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);
}

// One straight street: `orientation` 'z' runs along Z at x=`fixed`, 'x' runs along X at z=`fixed`,
// spanning [lo, hi] with `laneCountPerSide` lanes each way. Curbs/markings are cut at each
// `crossings` coordinate so the player can actually turn onto the crossing street.
// `padLo`/`padHi` grow only the asphalt slab past [lo, hi] (used where a street runs into a
// roundabout: the slab overlaps the ring but its centre line must stop at the ring's edge).
export interface Street {
  orientation: 'z' | 'x';
  fixed: number;
  lo: number;
  hi: number;
  laneCountPerSide: number;
}

export function buildStreet(
  orientation: 'z' | 'x',
  fixed: number,
  lo: number,
  hi: number,
  laneCountPerSide: number,
  crossings: number[] = [],
  { padLo = 0, padHi = 0 }: { padLo?: number; padHi?: number } = {},
): Street {
  const halfWidth = laneCountPerSide * CONFIG.LANE_WIDTH;
  const gapHalf = halfWidth + CONFIG.SIDEWALK_WIDTH;
  const spans = subSpans(lo, hi, crossings, gapHalf);
  const asphaltY = orientation === 'z' ? -0.05 : -0.045; // cross streets draw slightly above avenues at overlaps
  const markY = asphaltY + 0.15 + MARK_CLEARANCE;

  const slabLen = hi - lo + padLo + padHi;
  const slabMid = (lo - padLo + hi + padHi) / 2;
  if (orientation === 'z') {
    const asphalt = box(halfWidth * 2, 0.3, slabLen, 0x3a3a3f, { roughness: 1 });
    asphalt.position.set(fixed, asphaltY, slabMid);
    asphalt.receiveShadow = true;
    scene.add(asphalt);
  } else {
    const asphalt = box(slabLen, 0.3, halfWidth * 2, 0x3a3a3f, { roughness: 1 });
    asphalt.position.set(slabMid, asphaltY, fixed);
    asphalt.receiveShadow = true;
    scene.add(asphalt);
  }

  spans.forEach(([a, b]) => {
    const len = b - a, mid = (a + b) / 2;
    [-0.15, 0.15].forEach(oy => {
      const m = orientation === 'z'
        ? box(0.12, 0.02, len, 0xffcc00, { emissive: 0x554400, emissiveIntensity: 0.2 })
        : box(len, 0.02, 0.12, 0xffcc00, { emissive: 0x554400, emissiveIntensity: 0.2 });
      if (orientation === 'z') m.position.set(fixed + oy, markY, mid); else m.position.set(mid, markY, fixed + oy);
      scene.add(m);
    });
    [-halfWidth, halfWidth].forEach(edge => {
      const m = orientation === 'z' ? box(0.14, 0.02, len, 0xf2f2f2) : box(len, 0.02, 0.14, 0xf2f2f2);
      if (orientation === 'z') m.position.set(fixed + edge, markY, mid); else m.position.set(mid, markY, fixed + edge);
      scene.add(m);
    });

    [-1, 1].forEach(side => {
      const off = side * (halfWidth + CONFIG.SIDEWALK_WIDTH / 2);
      const sw = orientation === 'z'
        ? box(CONFIG.SIDEWALK_WIDTH, 0.18, len, 0xb9b6ad)
        : box(len, 0.18, CONFIG.SIDEWALK_WIDTH, 0xb9b6ad);
      if (orientation === 'z') sw.position.set(fixed + off, 0.05, mid); else sw.position.set(mid, 0.05, fixed + off);
      sw.receiveShadow = true;
      scene.add(sw);

      // No collision response (see world/road.ts's curbBody comment): this only exists to
      // detect the hit for the ticket in systems/rules.ts, the car drives up and over it.
      const curbBody = new CANNON.Body({ mass: 0, material: propMaterial });
      const half = orientation === 'z'
        ? new CANNON.Vec3(CONFIG.SIDEWALK_WIDTH / 2, 1, len / 2)
        : new CANNON.Vec3(len / 2, 1, CONFIG.SIDEWALK_WIDTH / 2);
      curbBody.addShape(new CANNON.Box(half));
      if (orientation === 'z') curbBody.position.set(fixed + off, 0.05, mid); else curbBody.position.set(mid, 0.05, fixed + off);
      curbBody.userData = { isPenalized: false, isStatic: true, isCurb: true };
      curbBody.collisionResponse = false;
      world.addBody(curbBody);
    });
  });

  return { orientation, fixed, lo, hi, laneCountPerSide };
}

// A solid striped barrier: closes off dead ends so the player can't wander onto open ground.
export function barrier(cx: number, cz: number, width: number, depth: number): void {
  const base = box(width, 1, depth, 0xff6a00);
  base.position.set(cx, 0.5, cz);
  const band = box(width + 0.02, 0.25, depth + 0.02, 0xffffff);
  band.position.set(cx, 0.85, cz);
  scene.add(base, band);

  const body = new CANNON.Body({ mass: 0, material: propMaterial });
  body.addShape(new CANNON.Box(new CANNON.Vec3(width / 2, 1.2, depth / 2)));
  body.position.set(cx, 0.6, cz);
  body.userData = { isPenalized: false, isStatic: true };
  world.addBody(body);
}

// A flat ring (or a sector of one) centred on (cx, cz), extruded as a prism spanning y in
// [yBottom, yTop]. `theta0`/`theta1` are world angles (increasing); omit both for a full annulus.
export function annulus(cx: number, cz: number, rIn: number, rOut: number, yBottom: number, yTop: number, color: THREE.ColorRepresentation, theta0?: number, theta1?: number, opts: { roughness?: number; cast?: boolean } = {}): THREE.Mesh {
  const shape = new THREE.Shape();
  if (theta0 === undefined || theta1 === undefined) {
    shape.absarc(0, 0, rOut, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  } else {
    // Shape space is X/Y; rotating the extrusion onto the ground maps shape angle phi to world -theta.
    const p0 = -theta1, p1 = -theta0;
    shape.moveTo(rOut * Math.cos(p0), rOut * Math.sin(p0));
    shape.absarc(0, 0, rOut, p0, p1, false);
    shape.lineTo(rIn * Math.cos(p1), rIn * Math.sin(p1));
    shape.absarc(0, 0, rIn, p1, p0, true);
    shape.closePath();
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: yTop - yBottom, bevelEnabled: false, curveSegments: 40 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(cx, yBottom, cz);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.9 }));
  mesh.receiveShadow = true; mesh.castShadow = !!opts.cast;
  scene.add(mesh);
  return mesh;
}

// Curved wall of tangent boxes standing on an arc centred on (cx, cz) — the cheap way to give a
// curb a real collider. No collision response (see buildStreet's own curbBody comment): it only
// detects the hit for the ticket in systems/rules.ts, the car drives up and over it.
export function arcCurbColliders(cx: number, cz: number, radius: number, thickness: number, theta0: number, theta1: number): void {
  const steps = Math.max(1, Math.ceil((theta1 - theta0) / 0.16));
  const dTheta = (theta1 - theta0) / steps;
  for (let i = 0; i < steps; i++) {
    const th = theta0 + dTheta * (i + 0.5);
    const chord = 2 * radius * Math.sin(dTheta / 2) + 0.6;
    const body = new CANNON.Body({ mass: 0, material: propMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(chord / 2, 1, thickness / 2)));
    body.position.set(cx + radius * Math.cos(th), 0.05, cz + radius * Math.sin(th));
    body.quaternion.setFromEuler(0, -th - Math.PI / 2, 0);
    body.userData = { isPenalized: false, isStatic: true, isCurb: true };
    body.collisionResponse = false;
    world.addBody(body);
  }
}

const BUILDING_PALETTE = [0xd9c79e, 0xc8896b, 0xdfe3e6, 0x9fb6c9, 0xe8d5a0, 0xb98d6f, 0xcbb4d1];

// Scatters low-poly filler buildings inside a square block cell centred on (cx, cz), keeping
// `inset` clear of the block edge so nothing grows into the surrounding streets.
export function scatterBlockBuildings(cx: number, cz: number, size: number, inset: number, [minCount, maxCount]: [number, number] = [3, 6]): void {
  const usable = size - inset * 2;
  if (usable < 8) return;
  const count = Math.floor(rand(minCount, maxCount));
  for (let i = 0; i < count; i++) {
    const w = rand(6, 11), h = rand(4, 22), d = rand(6, 11);
    const bx = cx + rand(-usable / 2 + w / 2, usable / 2 - w / 2);
    const bz = cz + rand(-usable / 2 + d / 2, usable / 2 - d / 2);
    const m = box(w, h, d, choice(BUILDING_PALETTE), { roughness: 0.85 });
    m.position.set(bx, h / 2, bz);
    scene.add(m);
  }
}
