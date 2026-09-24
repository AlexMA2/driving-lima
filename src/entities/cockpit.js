import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { camera } from '../core/renderer.js';
import { EYE_IN_CAR, MIRROR_POS, LAYER_COCKPIT, toCameraSpace } from './cabin.js';
import { createCluster, CLUSTER_SIZE } from './instrumentCluster.js';

// All cockpit geometry is parented to the camera itself, so it rides perfectly rigid with
// the first-person view with zero extra sync code — no chase/hood toggle to keep consistent.
// The eye sits at the camera origin, LHD: the car's centreline is CX to the right of it, so
// the wheel and instrument cluster are dead ahead and the centre stack is to their right.
export let steeringWheelSpin; // rotate .rotation.z each frame to match the wheel angle
let cluster;

const CX = -EYE_IN_CAR.x;

// Wheel's position in camera-local space — camera-space IS view-space for a direct camera
// child, so systems/input.js reuses this exact point to project the wheel's on-screen
// center (via camera.projectionMatrix) for mouse-drag angle tracking.
export const WHEEL_LOCAL_POS = new THREE.Vector3(0, -0.47, -0.6);
const WHEEL_TILT = 0.5; // the top of the rim leans away from the driver

// Screen anchors of the three mirrors in camera space (the DOM mirror viewports are laid over
// their projections, see systems/cameraRig.js).
export const MIRROR_ANCHORS = {
  rear: toCameraSpace(MIRROR_POS.rear),
  left: toCameraSpace(MIRROR_POS.left),
  right: toCameraSpace(MIRROR_POS.right),
};

const HALF_CABIN = 0.78;                // inner half-width of the cabin
const DASH_TOP = -0.24;                 // top surface of the dash pad, below the eye
const FASCIA_Z = -0.8;                  // the driver-facing panel of the dashboard

const M = {
  dashTop: () => mat(0x15161a, 0.92),
  dashLow: () => mat(0x282a2f, 0.85),
  trim: () => mat(0x0d0d0f, 0.8),
  silver: () => mat(0xb9bec6, 0.28, 0.85),
  leather: () => mat(0x101012, 0.55),
  black: () => mat(0x050607, 0.5),
};

function mat(color, roughness = 0.7, metalness = 0.1, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
function part(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  return m;
}
const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
  const m = part(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
};
const rounded = (w, h, d, r, material, x, y, z) => {
  const m = part(new RoundedBoxGeometry(w, h, d, 3, r), material);
  m.position.set(x, y, z);
  return m;
};
// A square beam between two points (an A-pillar, a mirror arm).
function beam(p0, p1, thickness, material) {
  const len = p0.distanceTo(p1);
  const m = part(new THREE.BoxGeometry(thickness, thickness, len), material);
  m.position.copy(p0).add(p1).multiplyScalar(0.5);
  m.lookAt(p1);
  return m;
}

// A round-ish air vent: chrome bezel, dark opening, horizontal slats.
function buildVent(x, y, w = 0.11, h = 0.048) {
  const g = new THREE.Group();
  g.add(rounded(w + 0.016, h + 0.016, 0.012, 0.006, M.silver(), 0, 0, 0));
  g.add(box(w, h, 0.014, M.black(), 0, 0, 0.001));
  const slat = M.trim();
  for (let i = -1; i <= 1; i++) g.add(box(w - 0.008, 0.0035, 0.018, slat, 0, i * h * 0.27, 0.002));
  g.position.set(x, y, FASCIA_Z + 0.004);
  return g;
}

// The infotainment display: a static navigation-style screen.
function buildScreenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 232;
  const ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, 232);
  bg.addColorStop(0, '#12233a'); bg.addColorStop(1, '#0a1220');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 232);
  // map: blocks, roads and a route
  ctx.fillStyle = '#1b3350';
  [[20, 50, 110, 60], [150, 50, 90, 60], [270, 50, 100, 60], [400, 50, 90, 60],
    [20, 140, 110, 60], [150, 140, 90, 60], [270, 140, 100, 60], [400, 140, 90, 60]].forEach(b => ctx.fillRect(...b));
  ctx.strokeStyle = '#3f6a99'; ctx.lineWidth = 3;
  [[0, 125, 512, 0], [138, 30, 0, 200], [258, 30, 0, 200], [388, 30, 0, 200]].forEach(([x, y, w, h]) => {
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke();
  });
  ctx.strokeStyle = '#3ea6ff'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(138, 215); ctx.lineTo(138, 125); ctx.lineTo(388, 125); ctx.lineTo(388, 60); ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(138, 168); ctx.lineTo(126, 192); ctx.lineTo(150, 192); ctx.closePath(); ctx.fill();
  // status bar
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, 512, 34);
  ctx.fillStyle = '#e8f1ff'; ctx.font = '600 22px "Segoe UI", Arial, sans-serif'; ctx.textBaseline = 'middle';
  ctx.textAlign = 'left'; ctx.fillText('Lima', 14, 18);
  ctx.textAlign = 'right'; ctx.fillText('18°C   12:30', 498, 18);
  ctx.textAlign = 'center'; ctx.fillStyle = '#9fd0ff'; ctx.fillText('98.5 FM', 256, 18);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

function buildHazardButton(x, y) {
  const g = new THREE.Group();
  g.add(rounded(0.05, 0.036, 0.012, 0.005, M.trim(), 0, 0, 0));
  const tri = new THREE.Shape();
  tri.moveTo(0, 0.014); tri.lineTo(0.016, -0.009); tri.lineTo(-0.016, -0.009); tri.closePath();
  const hole = new THREE.Path();
  hole.moveTo(0, 0.006); hole.lineTo(0.0075, -0.005); hole.lineTo(-0.0075, -0.005); hole.closePath();
  tri.holes.push(hole);
  const icon = part(new THREE.ShapeGeometry(tri), new THREE.MeshBasicMaterial({ color: 0xe53935 }));
  icon.position.z = 0.0065;
  g.add(icon);
  g.position.set(x, y, FASCIA_Z + 0.005);
  return g;
}

function buildKnob(x, y) {
  const g = new THREE.Group();
  const cap = part(new THREE.CylinderGeometry(0.023, 0.026, 0.026, 24), M.silver());
  cap.rotation.x = Math.PI / 2;
  const face = part(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 24), M.trim());
  face.rotation.x = Math.PI / 2; face.position.z = 0.014;
  const tick = box(0.003, 0.014, 0.004, mat(0xffffff, 0.4), 0, 0.008, 0.017);
  g.add(cap, face, tick);
  g.position.set(x, y, FASCIA_Z + 0.012);
  return g;
}

function buildSteeringWheel() {
  const mount = new THREE.Group();
  mount.position.copy(WHEEL_LOCAL_POS);
  mount.rotation.x = -WHEEL_TILT;
  const spin = new THREE.Group();

  const R = 0.19;
  const rim = part(new THREE.TorusGeometry(R, 0.022, 14, 56), M.leather());
  const marker = box(0.014, 0.036, 0.03, mat(0xe6e6e6, 0.5), 0, R, 0);
  spin.add(rim, marker);

  // three-spoke layout: the top is open so the gauges show through
  const spokeMat = mat(0x1c1d20, 0.5, 0.35);
  const inlay = M.silver();
  const spoke = (angle, from, to) => {
    const len = to - from, mid = (from + to) / 2;
    const g = new THREE.Group();
    g.add(box(len, 0.04, 0.02, spokeMat));
    g.add(box(len * 0.85, 0.007, 0.022, inlay, 0, 0, 0.0005));
    g.position.set(Math.cos(angle) * mid, Math.sin(angle) * mid, 0);
    g.rotation.z = angle;
    return g;
  };
  spin.add(spoke(Math.PI + 0.16, 0.05, R - 0.01), spoke(-0.16, 0.05, R - 0.01), spoke(-Math.PI / 2, 0.05, R - 0.01));

  const hub = part(new THREE.CylinderGeometry(0.066, 0.07, 0.05, 28), spokeMat);
  hub.rotation.x = Math.PI / 2;
  const logo = part(new THREE.CircleGeometry(0.034, 24), M.silver());
  logo.position.z = 0.0265;
  const logoCore = part(new THREE.CircleGeometry(0.02, 24), mat(0x1565c0, 0.4, 0.4));
  logoCore.position.z = 0.0275;
  spin.add(hub, logo, logoCore);

  mount.add(spin);
  const column = part(new THREE.CylinderGeometry(0.036, 0.042, 0.3, 14), M.trim());
  column.rotation.x = Math.PI / 2;
  column.position.set(0, -0.02, -0.17);
  mount.add(column);

  steeringWheelSpin = spin;
  return mount;
}

export function buildCockpit() {
  const g = new THREE.Group();
  g.name = 'cockpit';

  // ---- dashboard: soft-touch pad, two-tone fascia, chrome trim line
  const dashW = HALF_CABIN * 2;
  g.add(rounded(dashW + 0.02, 0.09, 0.4, 0.035, M.dashTop(), CX, DASH_TOP - 0.045, -1.0));
  g.add(rounded(dashW, 0.46, 0.3, 0.04, M.dashLow(), CX, -0.52, FASCIA_Z - 0.15));
  g.add(box(dashW - 0.06, 0.012, 0.006, M.silver(), CX, -0.335, FASCIA_Z + 0.001));

  // air vents: driver's side, either side of the screen, passenger's side
  g.add(buildVent(-0.27, -0.40), buildVent(CX - 0.19, -0.40), buildVent(CX + 0.19, -0.40), buildVent(CX + 0.66, -0.40));

  // centre stack: hazard button, touchscreen, climate controls
  g.add(buildHazardButton(CX, -0.395));
  g.add(rounded(0.32, 0.15, 0.03, 0.012, M.trim(), CX, -0.52, FASCIA_Z + 0.006));
  const screen = part(new THREE.PlaneGeometry(0.29, 0.13), new THREE.MeshBasicMaterial({ map: buildScreenTexture(), toneMapped: false }));
  screen.position.set(CX, -0.52, FASCIA_Z + 0.0225);
  g.add(screen);
  [-0.16, 0, 0.16].forEach(dx => g.add(buildKnob(CX + dx, -0.635)));
  for (let i = -3; i <= 3; i++) g.add(rounded(0.03, 0.014, 0.008, 0.004, M.trim(), CX + i * 0.045, -0.6, FASCIA_Z + 0.004));

  // glovebox seams on the passenger's side
  const seam = M.black();
  const gx0 = CX + 0.36, gx1 = CX + 0.74, gy0 = -0.5, gy1 = -0.72;
  g.add(box(gx1 - gx0, 0.005, 0.004, seam, (gx0 + gx1) / 2, gy0, FASCIA_Z + 0.002));
  g.add(box(gx1 - gx0, 0.005, 0.004, seam, (gx0 + gx1) / 2, gy1, FASCIA_Z + 0.002));
  g.add(box(0.005, gy0 - gy1, 0.004, seam, gx0, (gy0 + gy1) / 2, FASCIA_Z + 0.002));
  g.add(box(0.005, gy0 - gy1, 0.004, seam, gx1, (gy0 + gy1) / 2, FASCIA_Z + 0.002));
  g.add(box(0.07, 0.012, 0.01, M.silver(), (gx0 + gx1) / 2, gy0 - 0.03, FASCIA_Z + 0.004));

  // ---- instrument cluster in its binnacle, tilted to face the eye
  cluster = createCluster();
  const pod = new THREE.Group();
  pod.position.set(0, -0.247, -0.79);
  pod.rotation.x = -0.3;
  cluster.mesh.frustumCulled = false;
  pod.add(cluster.mesh);
  pod.add(rounded(CLUSTER_SIZE.w + 0.04, CLUSTER_SIZE.h + 0.04, 0.09, 0.02, M.trim(), 0, 0, -0.05));
  const visor = rounded(CLUSTER_SIZE.w + 0.03, 0.018, 0.075, 0.008, M.dashTop(), 0, CLUSTER_SIZE.h / 2 + 0.008, 0.02);
  visor.rotation.x = 0.3;
  pod.add(visor);
  g.add(pod);

  // ---- A-pillars, door tops and door panels
  const trim = M.dashTop();
  // raked ~23° back toward the driver, like a real windscreen pillar; it runs on past the top of the view
  const pillarBase = -0.98, pillarTop = { y: 0.6, z: -0.62 };
  g.add(beam(new THREE.Vector3(CX - HALF_CABIN, DASH_TOP - 0.02, pillarBase), new THREE.Vector3(CX - HALF_CABIN - 0.02, pillarTop.y, pillarTop.z), 0.06, trim));
  g.add(beam(new THREE.Vector3(CX + HALF_CABIN, DASH_TOP - 0.02, pillarBase), new THREE.Vector3(CX + HALF_CABIN + 0.02, pillarTop.y, pillarTop.z), 0.06, trim));
  [-1, 1].forEach(side => {
    const x = CX + side * HALF_CABIN;
    g.add(rounded(0.07, 0.62, 1.55, 0.02, M.dashLow(), x + side * 0.03, DASH_TOP - 0.34, -0.2));
    g.add(rounded(0.12, 0.035, 1.55, 0.014, M.dashTop(), x + side * 0.0, DASH_TOP - 0.018, -0.2));
    g.add(box(0.014, 0.008, 1.45, M.silver(), x - side * 0.003, DASH_TOP + 0.001, -0.2));
    g.add(rounded(0.1, 0.06, 0.55, 0.02, M.dashTop(), x - side * 0.02, DASH_TOP - 0.2, 0.0));
  });

  // ---- steering wheel
  g.add(buildSteeringWheel());

  // ---- interior mirror: arm from the windscreen header (the mirror glass itself is the DOM viewport)
  const a = MIRROR_ANCHORS.rear;
  g.add(beam(new THREE.Vector3(a.x, a.y + 0.2, a.z + 0.03), new THREE.Vector3(a.x, a.y + 0.03, a.z), 0.022, M.trim()));

  g.traverse(o => o.layers.set(LAYER_COCKPIT));
  camera.layers.enable(LAYER_COCKPIT);
  camera.add(g);
  return g;
}

// state: { dt, wheelAngle, signalLeft, signalRight, blink, speedKmh, forwardMs, throttle, brakeHeld, handbrake }
export function updateCockpit(state) {
  // Positive rotation.z is CCW as seen by the camera looking down -Z, but a positive
  // wheelAngle means "turned right" (see systems/input.js) — negate so the on-screen
  // wheel actually turns the way the driver turned it.
  if (steeringWheelSpin) steeringWheelSpin.rotation.z = -state.wheelAngle;
  cluster.update(state);
}
