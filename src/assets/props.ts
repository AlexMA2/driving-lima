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

// One orientation only, for northbound traffic (heading -Z): the pole stands on the lanes' right
// (east) verge, the arm reaches west over them and the lamps face +Z, towards the approaching
// drivers. world/trafficLights.ts places and turns it for every other heading — don't build one
// directly.
export interface TrafficLightLamps { red: StdMesh; yellow: StdMesh; green: StdMesh }

export function buildTrafficLightPole() {
  const g = new THREE.Group();
  const pole = cyl(0.09, 0.09, 4.2, 0x333333, 8); pole.position.y = 2.1;
  const arm = box(2.6, 0.1, 0.1, 0x333333); arm.position.set(-1.3, 4.1, 0);
  const housing = box(0.4, 1.05, 0.4, 0x151515); housing.position.set(-2.5, 3.6, 0);
  const faceZ = 0.21;
  const red: StdMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0x000000 }));
  red.position.set(-2.5, 3.95, faceZ);
  const yellow = red.clone(); yellow.material = yellow.material.clone(); yellow.material.color.set(0x554400); yellow.position.set(-2.5, 3.6, faceZ);
  const green = red.clone(); green.material = green.material.clone(); green.material.color.set(0x004d00); green.position.set(-2.5, 3.25, faceZ);
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
  plate.position.y = 2.25; // backing stays parallel to the face (+Z): turned sideways it cut through the text

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

// "Ceda el paso" (R-1): an inverted white triangle, red border, in Peru mostly shown blank —
// text is included here since our plates are small and viewed close up, unlike a full-size sign.
export function buildYieldPlate(): THREE.Group {
  const outline = (ctx: CanvasRenderingContext2D): void => {
    ctx.beginPath(); ctx.moveTo(14, 18); ctx.lineTo(242, 18); ctx.lineTo(128, 238); ctx.closePath();
  };
  return buildPlate({
    key: 'yield', size: 0.85, outline,
    paint(ctx) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
      ctx.save();
      ctx.translate(128, 158); ctx.scale(0.82, 0.82); ctx.translate(-128, -158);
      outline(ctx);
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 22; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#c62828'; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('CEDA EL', 128, 128);
      ctx.fillText('PASO', 128, 164);
    },
  });
}

// "Prohibido estacionar" (R-52): white disc, red ring, a blue "E" struck through by the red bar.
export function buildNoParkingPlate(): THREE.Group {
  const outline = (ctx: CanvasRenderingContext2D): void => { ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); };
  return buildPlate({
    key: 'no-parking', size: 0.75, outline,
    paint(ctx) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
      ctx.beginPath(); ctx.arc(128, 128, 108, 0, Math.PI * 2);
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 24; ctx.stroke();
      ctx.fillStyle = '#1565c0'; ctx.font = 'bold 140px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('E', 128, 138);
      ctx.save();
      ctx.translate(128, 128); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#c62828'; ctx.fillRect(-108, -16, 216, 32);
      ctx.restore();
    },
  });
}

// A stubby U-arrow, used by both U-turn plates below (the sign that's permitted keeps it plain,
// white on blue; the prohibited one draws it black on white with the red diagonal bar over it).
function drawUArrow(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 26; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(88, 60); ctx.lineTo(88, 138); ctx.arc(128, 138, 40, Math.PI, 0, true); ctx.lineTo(168, 60);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(168, 40); ctx.lineTo(198, 78); ctx.lineTo(142, 84); ctx.closePath(); ctx.fill();
}

// "Retorno permitido" (R-9-ish, informative): blue disc, white U-arrow.
export function buildUTurnPermittedPlate(): THREE.Group {
  const outline = (ctx: CanvasRenderingContext2D): void => { ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); };
  return buildPlate({
    key: 'uturn-ok', size: 0.75, outline,
    paint(ctx) {
      ctx.fillStyle = '#1565c0'; ctx.fillRect(0, 0, 256, 256);
      drawUArrow(ctx, '#ffffff');
    },
  });
}

// "Prohibido girar en U" (R-24): white disc, red ring, black arrow, red diagonal bar.
export function buildNoUTurnPlate(): THREE.Group {
  const outline = (ctx: CanvasRenderingContext2D): void => { ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); };
  return buildPlate({
    key: 'no-uturn', size: 0.75, outline,
    paint(ctx) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
      ctx.beginPath(); ctx.arc(128, 128, 108, 0, Math.PI * 2);
      ctx.strokeStyle = '#c62828'; ctx.lineWidth = 22; ctx.stroke();
      drawUArrow(ctx, '#111111');
      ctx.save();
      ctx.translate(128, 128); ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#c62828'; ctx.fillRect(-108, -15, 216, 30);
      ctx.restore();
    },
  });
}

// "Cruce de peatones" (P-31, preventive): yellow diamond, black border, a walking pedestrian.
export function buildPedestrianWarningPlate(): THREE.Group {
  const outline = (ctx: CanvasRenderingContext2D): void => {
    ctx.beginPath(); ctx.moveTo(128, 8); ctx.lineTo(248, 128); ctx.lineTo(128, 248); ctx.lineTo(8, 128); ctx.closePath();
  };
  return buildPlate({
    key: 'ped-warning', size: 0.85, outline,
    paint(ctx) {
      ctx.fillStyle = '#f5d90a'; ctx.fillRect(0, 0, 256, 256);
      ctx.save();
      ctx.translate(128, 128); ctx.scale(0.86, 0.86); ctx.translate(-128, -128);
      outline(ctx);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.restore();
      // a single figure mid-stride
      ctx.strokeStyle = '#111'; ctx.fillStyle = '#111'; ctx.lineCap = 'round'; ctx.lineWidth = 16;
      ctx.beginPath(); ctx.arc(140, 68, 15, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(140, 90); ctx.lineTo(132, 150);
      ctx.moveTo(132, 150); ctx.lineTo(102, 200);
      ctx.moveTo(132, 150); ctx.lineTo(168, 195);
      ctx.moveTo(136, 108); ctx.lineTo(100, 130);
      ctx.moveTo(136, 108); ctx.lineTo(172, 96);
      ctx.stroke();
    },
  });
}

// ---- more MTC plates: regulatory (R-, blue disc/white pictogram) and preventive (P-, yellow
// diamond/black pictogram) signs the César Vallejo circuit needs (docs/track-mapping) that the
// plates above don't cover. Same simplified-but-readable style as the plates above (e.g.
// buildYieldPlate's lettering) rather than a strict reproduction of the official artwork.

function blueDiscOutline(ctx: CanvasRenderingContext2D): void { ctx.beginPath(); ctx.arc(128, 128, 124, 0, Math.PI * 2); }

function fillBlueDisc(ctx: CanvasRenderingContext2D): void { ctx.fillStyle = '#1565c0'; ctx.fillRect(0, 0, 256, 256); }

// A shaft from (x1,y1) to (x2,y2) with a triangular arrowhead at the end.
function drawArrowShaft(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 24): void {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const hx = Math.cos(ang), hy = Math.sin(ang);
  const px = -hy, py = hx;
  ctx.beginPath();
  ctx.moveTo(x2 + hx * 16, y2 + hy * 16);
  ctx.lineTo(x2 - hx * 26 + px * 20, y2 - hy * 26 + py * 20);
  ctx.lineTo(x2 - hx * 26 - px * 20, y2 - hy * 26 - py * 20);
  ctx.closePath(); ctx.fill();
}

// A single arrow rising from the bottom then bending toward `dir` — the "turn this way" pictogram
// shared by R-3 (straight ahead), R-5 (left only) and R-7 (right only).
function drawBentArrow(ctx: CanvasRenderingContext2D, color: string, dir: 'straight' | 'left' | 'right'): void {
  if (dir === 'straight') { drawArrowShaft(ctx, 128, 220, 128, 50, color); return; }
  const sign = dir === 'left' ? -1 : 1;
  ctx.strokeStyle = color; ctx.lineWidth = 24; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(128, 220); ctx.lineTo(128, 120); ctx.quadraticCurveTo(128, 80, 128 + sign * 40, 80); ctx.stroke();
  drawArrowShaft(ctx, 128 + sign * 15, 80, 128 + sign * 70, 80, color);
}

// R-5 "Giro solamente a la izquierda": blue disc, white left-bending arrow.
export function buildLeftTurnOnlyPlate(): THREE.Group {
  return buildPlate({
    key: 'turn-left-only', size: 0.75, outline: blueDiscOutline,
    paint(ctx) { fillBlueDisc(ctx); drawBentArrow(ctx, '#ffffff', 'left'); },
  });
}

// R-7 "Giro solamente a la derecha": blue disc, white right-bending arrow.
export function buildRightTurnOnlyPlate(): THREE.Group {
  return buildPlate({
    key: 'turn-right-only', size: 0.75, outline: blueDiscOutline,
    paint(ctx) { fillBlueDisc(ctx); drawBentArrow(ctx, '#ffffff', 'right'); },
  });
}

// R-3 "Dirección obligada": blue disc, white straight-ahead arrow.
export function buildMandatoryDirectionPlate(): THREE.Group {
  return buildPlate({
    key: 'mandatory-straight', size: 0.75, outline: blueDiscOutline,
    paint(ctx) { fillBlueDisc(ctx); drawBentArrow(ctx, '#ffffff', 'straight'); },
  });
}

// R-7-2 "Carril permitido para volteo (derecha) y para seguir": blue disc, one arrow straight
// ahead and a second branching right off the same shaft — a merge lane that may turn or continue.
export function buildRightTurnOrContinuePlate(): THREE.Group {
  return buildPlate({
    key: 'turn-right-or-continue', size: 0.75, outline: blueDiscOutline,
    paint(ctx) {
      fillBlueDisc(ctx);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 20; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(128, 220); ctx.lineTo(128, 130); ctx.stroke();
      drawArrowShaft(ctx, 128, 130, 128, 55, '#ffffff', 20);
      ctx.beginPath(); ctx.moveTo(128, 170); ctx.quadraticCurveTo(128, 130, 175, 130); ctx.stroke();
      drawArrowShaft(ctx, 145, 130, 200, 130, '#ffffff', 20);
    },
  });
}

function yellowDiamondOutline(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath(); ctx.moveTo(128, 8); ctx.lineTo(248, 128); ctx.lineTo(128, 248); ctx.lineTo(8, 128); ctx.closePath();
}

function fillYellowDiamond(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#f5d90a'; ctx.fillRect(0, 0, 256, 256);
  ctx.save();
  ctx.translate(128, 128); ctx.scale(0.86, 0.86); ctx.translate(-128, -128);
  yellowDiamondOutline(ctx);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}

// P-15 "Intersección rotatoria": yellow diamond, three arrows circling — warns of the óvalo ahead.
export function buildRoundaboutAheadPlate(): THREE.Group {
  return buildPlate({
    key: 'roundabout-ahead', size: 0.85, outline: yellowDiamondOutline,
    paint(ctx) {
      fillYellowDiamond(ctx);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 16; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * Math.PI * 2, a1 = a0 + Math.PI * 2 / 3 - 0.35;
        ctx.beginPath(); ctx.arc(128, 128, 52, a0, a1); ctx.stroke();
        const ex = 128 + 52 * Math.cos(a1), ey = 128 + 52 * Math.sin(a1);
        const tang = a1 + Math.PI / 2;
        drawArrowShaft(ctx, ex - Math.cos(tang) * 14, ey - Math.sin(tang) * 14, ex + Math.cos(tang) * 4, ey + Math.sin(tang) * 4, '#111', 16);
      }
    },
  });
}

// P-25 "Doble circulación": yellow diamond, two opposed vertical arrows — two-way traffic ahead.
export function buildTwoWayTrafficPlate(): THREE.Group {
  return buildPlate({
    key: 'two-way-traffic', size: 0.85, outline: yellowDiamondOutline,
    paint(ctx) {
      fillYellowDiamond(ctx);
      drawArrowShaft(ctx, 108, 210, 108, 60, '#111', 18);
      drawArrowShaft(ctx, 148, 60, 148, 210, '#111', 18);
    },
  });
}

// P-33 "Resalto": yellow diamond, a black hump-profile pictogram — speed bump ahead.
export function buildSpeedBumpAheadPlate(): THREE.Group {
  return buildPlate({
    key: 'speed-bump-ahead', size: 0.85, outline: yellowDiamondOutline,
    paint(ctx) {
      fillYellowDiamond(ctx);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(58, 168); ctx.lineTo(88, 168);
      ctx.bezierCurveTo(108, 168, 108, 108, 128, 108);
      ctx.bezierCurveTo(148, 108, 148, 168, 168, 168);
      ctx.lineTo(198, 168);
      ctx.stroke();
    },
  });
}

// P-10-A "Empalme en ángulo agudo con vía lateral derecha": yellow diamond, a straight main line
// with a side road merging in from the right at a shallow angle.
export function buildAcuteMergeRightPlate(): THREE.Group {
  return buildPlate({
    key: 'acute-merge-right', size: 0.85, outline: yellowDiamondOutline,
    paint(ctx) {
      fillYellowDiamond(ctx);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(90, 210); ctx.lineTo(90, 46); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(90, 140); ctx.lineTo(206, 60); ctx.stroke();
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
