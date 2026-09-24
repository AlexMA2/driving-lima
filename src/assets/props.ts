import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, cyl, type StdMesh } from './primitives';

export function buildCone() {
  const g = new THREE.Group();
  const base = cyl(0.35, 0.4, 0.06, 0xff6a00, 12); base.position.y = 0.03;
  const body = cyl(0.03, 0.22, 0.55, 0xff6a00, 12); body.position.y = 0.31;
  const stripe = cyl(0.16, 0.2, 0.08, 0xffffff, 12); stripe.position.y = 0.45;
  g.add(base, body, stripe);
  return g;
}

// A "rompemuelle": a low hump across the whole road, painted with alternating yellow and black bars like the real
// ones. Its crest is 0.24 above the ground plane the physics uses: the asphalt's visible top is at y=0.10 (see
// world/road.ts) and the collider in world/speedBumps.ts rises 0.14 above the plane, so the car climbs what is drawn.
const BUMP_LENGTH = 1.0;   // along the road
const BUMP_HEIGHT = 0.14;  // above the asphalt's top face
const BUMP_BAR = 0.5;      // width of one painted bar
const ASPHALT_TOP = 0.10;

export function buildSpeedBump(width: number) {
  // The hump's profile (a circular segment) in the road's z axis, then extruded along x one bar at a time.
  const half = BUMP_LENGTH / 2;
  const radius = (half * half + BUMP_HEIGHT * BUMP_HEIGHT) / (2 * BUMP_HEIGHT);
  const profile = new THREE.Shape();
  profile.moveTo(-half, 0);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const z = -half + (BUMP_LENGTH * i) / steps;
    profile.lineTo(z, Math.sqrt(radius * radius - z * z) + BUMP_HEIGHT - radius);
  }
  profile.lineTo(half, 0);

  const bars = Math.max(1, Math.round(width / BUMP_BAR));
  const barWidth = width / bars;
  const parts: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []];
  for (let i = 0; i < bars; i++) {
    const g = new THREE.ExtrudeGeometry(profile, { depth: barWidth, bevelEnabled: false });
    g.rotateY(Math.PI / 2); // the extrusion (+z) now runs along +x, the profile's x along -z
    g.translate(-width / 2 + i * barWidth, 0, 0);
    parts[i % 2].push(g);
  }

  const group = new THREE.Group();
  ([0xffd54a, 0x1c1c1c] as const).forEach((color, k) => {
    const merged = mergeGeometries(parts[k], false);
    parts[k].forEach(g => g.dispose());
    if (!merged) return;
    const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.position.y = ASPHALT_TOP - 0.005; // sunk a hair into the asphalt so there is no gap at the edges
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

// flipFacing: callers that swing the arm to the road's other side with `rotation.y = Math.PI`
// also flip which world direction the lamp housing's open face ends up pointing (a 180° turn
// negates both the arm's and the lamps' local offsets), which turns the lamps to face away from
// the approaching driver — invisible, hidden behind the opaque housing. Pass true in that case so
// the lamps are built on the housing's other local side and come out facing the right way after
// the rotation. Callers that reorient with a different angle (e.g. -90°) don't need it.
export interface TrafficLightLamps { red: StdMesh; yellow: StdMesh; green: StdMesh }

export function buildTrafficLightPole(flipFacing = false) {
  const g = new THREE.Group();
  const pole = cyl(0.09, 0.09, 4.2, 0x333333, 8); pole.position.y = 2.1;
  const arm = box(2.6, 0.1, 0.1, 0x333333); arm.position.set(1.3, 4.1, 0);
  const housing = box(0.4, 1.05, 0.4, 0x151515); housing.position.set(2.5, 3.6, 0);
  const faceZ = flipFacing ? -0.21 : 0.21;
  const red: StdMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0x000000 }));
  red.position.set(2.5, 3.95, faceZ);
  const yellow = red.clone(); yellow.material = yellow.material.clone(); yellow.material.color.set(0x554400); yellow.position.set(2.5, 3.6, faceZ);
  const green = red.clone(); green.material = green.material.clone(); green.material.color.set(0x004d00); green.position.set(2.5, 3.25, faceZ);
  g.add(pole, arm, housing, red, yellow, green);
  const lights: TrafficLightLamps = { red, yellow, green };
  g.userData.lights = lights;
  return g;
}

export function buildSign(text: string, bg = 0xffcc00, shape = 'rect') {
  const g = new THREE.Group();
  const pole = cyl(0.06, 0.06, 2.2, 0x777777, 6); pole.position.y = 1.1;
  let plate: THREE.Mesh;
  if (shape === 'octagon') {
    plate = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xcc1111 }));
    plate.rotation.x = Math.PI / 2;
  } else {
    plate = box(1.15, 0.65, 0.05, bg);
  }
  plate.position.y = 2.25;
  plate.rotation.y = Math.PI / 2 - 0.001;

  // simple canvas texture with the sign text
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 160;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = `#${bg.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 248, 152);
  ctx.fillStyle = '#111'; ctx.font = 'bold 34px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((l, i) => ctx.fillText(l, 128, 80 + (i - (lines.length - 1) / 2) * 38));
  const tex = new THREE.CanvasTexture(cvs);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.62), faceMat);
  face.position.set(0, 2.25, 0.03);

  g.add(plate, pole, face);
  return g;
}

// ---- Peruvian traffic signs (Manual de Dispositivos de Control del Tránsito, MTC) ----
// A plate is a flat sign drawn on a canvas: the front shows the sign, the back is bare grey metal. Plates are hung
// on a post with `buildSignPost`, so one post can carry several (the school warning above the speed limit).
// Faces the +Z direction: rotate the post to point it at the traffic it is meant for.

const plateCache = new Map<string, THREE.Group>();

interface PlateSpec {
  key: string;
  size: number; // metres, the square the artwork is drawn in
  outline: (ctx: CanvasRenderingContext2D) => void; // the plate's shape, in a 256 x 256 canvas
  paint: (ctx: CanvasRenderingContext2D) => void;   // the front artwork, clipped to the shape
}

function plateTexture(draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 256;
  draw(cvs.getContext('2d')!);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildPlate({ key, size, outline, paint }: PlateSpec): THREE.Group {
  const cached = plateCache.get(key);
  if (cached) return cached.clone();

  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      map: plateTexture(ctx => { ctx.save(); outline(ctx); ctx.clip(); paint(ctx); ctx.restore(); }),
      transparent: true, alphaTest: 0.5, roughness: 0.45,
    }),
  );
  front.position.z = 0.025;
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({
      map: plateTexture(ctx => { outline(ctx); ctx.fillStyle = '#8b9096'; ctx.fill(); }),
      transparent: true, alphaTest: 0.5, roughness: 0.7,
    }),
  );
  back.position.z = -0.025;
  back.rotation.y = Math.PI;

  const g = new THREE.Group();
  g.add(front, back);
  plateCache.set(key, g);
  return g.clone();
}

// "Zona escolar": the warning pentagon (point up) in fluorescent yellow-green, with two children crossing.
export function buildSchoolPlate(): THREE.Group {
  const outline = (ctx: CanvasRenderingContext2D): void => {
    ctx.beginPath();
    [[128, 6], [247, 93], [201, 234], [55, 234], [9, 93]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  return buildPlate({
    key: 'school', size: 0.9, outline,
    paint(ctx) {
      ctx.fillStyle = '#c9e21f'; ctx.fillRect(0, 0, 256, 256);
      // the black border, inset from the edge
      ctx.save();
      ctx.translate(128, 140); ctx.scale(0.9, 0.9); ctx.translate(-128, -140);
      outline(ctx);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();

      // two children walking hand in hand
      ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineCap = 'round';
      const child = (x: number, feet: number, h: number, handX: number): void => {
        ctx.lineWidth = h * 0.12;
        ctx.beginPath(); ctx.arc(x, feet - h * 0.9, h * 0.11, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, feet - h * 0.76); ctx.lineTo(x, feet - h * 0.4);                   // body
        ctx.moveTo(x, feet - h * 0.4); ctx.lineTo(x - h * 0.15, feet);                    // legs
        ctx.moveTo(x, feet - h * 0.4); ctx.lineTo(x + h * 0.17, feet);
        ctx.moveTo(x, feet - h * 0.68); ctx.lineTo(handX, feet - h * 0.42);               // the arm they hold hands with
        ctx.moveTo(x, feet - h * 0.68); ctx.lineTo(x + (x < 128 ? -0.2 : 0.2) * h, feet - h * 0.4); // the free arm
        ctx.stroke();
      };
      child(98, 205, 92, 128);
      child(158, 205, 80, 128);
    },
  });
}

// R-30 "Velocidad máxima": white disc, red ring, the limit in black.
export function buildSpeedLimitPlate(kmh: number): THREE.Group {
  const outline = (ctx: CanvasRenderingContext2D): void => { ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); };
  return buildPlate({
    key: `speed-${kmh}`, size: 0.75, outline,
    paint(ctx) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
      ctx.beginPath(); ctx.arc(128, 128, 108, 0, Math.PI * 2);
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 30; ctx.stroke();
      ctx.fillStyle = '#111'; ctx.font = 'bold 118px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(kmh), 128, 138);
    },
  });
}

// A post with plates on it. `y` is the height of each plate's centre.
export function buildSignPost(plates: Array<{ plate: THREE.Object3D; y: number }>, height = 3.3): THREE.Group {
  const g = new THREE.Group();
  const pole = cyl(0.05, 0.05, height, 0x777777, 6); pole.position.y = height / 2;
  g.add(pole);
  plates.forEach(({ plate, y }) => { plate.position.set(0, y, 0.06); g.add(plate); });
  return g;
}

// Octagonal red PARE sign on a pole; the face is a canvas texture on an 8-sided disc.
export function buildStopSign() {
  const g = new THREE.Group();
  const pole = cyl(0.06, 0.06, 2.4, 0x777777, 6); pole.position.y = 1.2;

  const cvs = document.createElement('canvas'); cvs.width = 256; cvs.height = 256;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = '#c62828'; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 10; ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    const x = 128 + 112 * Math.cos(a), y = 128 - 112 * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 74px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PARE', 128, 132);

  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 8, Math.PI / 8),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cvs), side: THREE.DoubleSide })
  );
  face.position.set(0, 2.3, 0.04);
  g.add(pole, face);
  return g;
}

export const CHILD_SCALE = 0.72; // a schoolchild next to an adult: about 1.0 m against 1.45 m

// `child` builds a schoolchild: the same figure at a smaller scale, in a school shirt and with a backpack (on the
// side the figure faces away from, +Z: pedestrians walk towards -Z at rotation 0).
export function buildPedestrian(shirtColor: THREE.ColorRepresentation, child = false) {
  const g = new THREE.Group();
  const legs = box(0.28, 0.7, 0.2, 0x2b2b3a); legs.position.y = 0.35;
  const torso = box(0.32, 0.5, 0.22, shirtColor); torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), new THREE.MeshStandardMaterial({ color: 0xe0b088 }));
  head.position.y = 1.32;
  g.add(legs, torso, head);
  if (child) {
    const pack = box(0.26, 0.34, 0.14, 0xc62828); pack.position.set(0, 1.0, 0.18);
    g.add(pack);
    g.scale.setScalar(CHILD_SCALE);
  }
  g.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; } });
  return g;
}
