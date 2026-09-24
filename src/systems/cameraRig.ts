import * as THREE from 'three';
import { renderer, camera, mirrorCamera, leftMirrorCamera, rightMirrorCamera } from '../core/renderer';
import { scene } from '../core/scene';
import { chassisBody } from '../entities/player';
import { setFromCannonQuat, setFromCannonVec } from '../utils/cannonThree';
import { EYE_IN_CAR, MIRROR_POS, MIRROR_AIM } from '../entities/cabin';
import { MIRROR_ANCHORS } from '../entities/cockpit';

// Cockpit (first-person, driver's seat) is the only view. The eye is where a left-hand-drive
// driver's head would be (see entities/cabin.ts); the mirrors sit where real ones do: the
// wing mirrors on the front corners of the doors, the interior mirror at the top of the
// windscreen, all looking backwards.
const eyePitch = -0.035; // a hair downward so the dashboard/road read naturally

const smoothPos = new THREE.Vector3();
const smoothQuat = new THREE.Quaternion();
const pitchQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(eyePitch, 0, 0));
const carPos = new THREE.Vector3();
const carQuat = new THREE.Quaternion();
const tmp = new THREE.Vector3();
const desiredPos = new THREE.Vector3();
const desiredQuat = new THREE.Quaternion();
let initialized = false;

type MirrorName = 'rear' | 'left' | 'right';

function placeMirror(cam: THREE.PerspectiveCamera, name: MirrorName): void {
  cam.position.copy(MIRROR_POS[name]).applyQuaternion(carQuat).add(carPos);
  cam.up.set(0, 1, 0);
  cam.lookAt(tmp.copy(MIRROR_AIM[name]).applyQuaternion(carQuat).add(cam.position));
}

export function updateCameraRig(): void {
  setFromCannonVec(carPos, chassisBody.position);
  setFromCannonQuat(carQuat, chassisBody.quaternion);

  desiredPos.copy(EYE_IN_CAR).applyQuaternion(carQuat).add(carPos);
  desiredQuat.copy(carQuat).multiply(pitchQuat);

  if (!initialized) { smoothPos.copy(desiredPos); smoothQuat.copy(desiredQuat); initialized = true; }
  // Light damping takes the edge off suspension jitter without decoupling the view from the car.
  smoothPos.lerp(desiredPos, 0.55);
  smoothQuat.slerp(desiredQuat, 0.55);
  camera.position.copy(smoothPos);
  camera.quaternion.copy(smoothQuat);

  placeMirror(mirrorCamera, 'rear');
  placeMirror(leftMirrorCamera, 'left');
  placeMirror(rightMirrorCamera, 'right');
}

// ---- mirrors ------------------------------------------------------------------------------
// A real mirror flips left and right; a camera that simply looks backwards does not (the
// kerb on your right would show up on the left of the picture — exactly wrong for reversing).
// So each mirror view is rendered to a small target and then drawn into its DOM rectangle
// mirrored, with rounded corners so it reads as a piece of glass in a housing.

const MIRROR_RADIUS = 16; // css px; the housing's border-radius (styles/game/_mirrors.scss) minus a hair

const mirrorMaterial = () => new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, size: { value: new THREE.Vector2(1, 1) }, radius: { value: MIRROR_RADIUS } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D map; uniform vec2 size; uniform float radius; varying vec2 vUv;
    void main() {
      vec2 q = abs((vUv - 0.5) * size) - (size * 0.5 - radius);
      if (length(max(q, 0.0)) - radius > 0.0) discard;
      gl_FragColor = texture2D(map, vec2(1.0 - vUv.x, vUv.y));
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});

const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mirrorMaterial());
quadMesh.frustumCulled = false;
const quadScene = new THREE.Scene();
quadScene.add(quadMesh);
const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

interface Rect { left: number; right: number; top: number; bottom: number; width: number; height: number }

interface Mirror {
  id: string;
  cam: THREE.PerspectiveCamera;
  anchor: MirrorName;
  index: number;
  target: THREE.WebGLRenderTarget;
  material: THREE.ShaderMaterial;
  rect: Rect;
  stale: boolean;
}

const mirrorDefs: Array<Pick<Mirror, 'id' | 'cam' | 'anchor'>> = [
  { id: 'mirrorViewport', cam: mirrorCamera, anchor: 'rear' },
  { id: 'leftMirrorViewport', cam: leftMirrorCamera, anchor: 'left' },
  { id: 'rightMirrorViewport', cam: rightMirrorCamera, anchor: 'right' },
];

// The DOM rectangles are part of the HUD, which only exists while a game is on screen, so they are looked up when
// laid out rather than when this module loads.
const mirrors: Mirror[] = mirrorDefs.map((m, index) => ({
  ...m,
  index,
  target: new THREE.WebGLRenderTarget(64, 64, { samples: 4 }),
  material: mirrorMaterial(),
  rect: { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }, // cached by layoutMirrors(), so no per-frame layout reads
  stale: true,   // the target holds no valid picture yet (first frame, or it was just resized)
}));

// Performance settings (core/performance.ts): how sharp the mirror pictures are, and how often a
// mirror's scene is redrawn (the rest of the time its last picture is simply drawn again).
const MIRROR_QUALITY: Record<'low' | 'medium' | 'high', { scale: number; samples: number }> = { low: { scale: 0.5, samples: 0 }, medium: { scale: 0.75, samples: 2 }, high: { scale: 1, samples: 4 } };
let mirrorScale = 1;
let mirrorEvery = 1;
let mirrorFrame = 0;

export function setMirrorQuality(level: 'low' | 'medium' | 'high'): void {
  const q = MIRROR_QUALITY[level] ?? MIRROR_QUALITY.high;
  mirrorScale = q.scale;
  mirrors.forEach(m => {
    m.target.samples = q.samples;
    m.target.dispose(); // the framebuffer is rebuilt with the new sample count on next use
    m.stale = true;
  });
}

export function setMirrorRefresh(everyNFrames: number): void {
  mirrorEvery = Math.max(1, everyNFrames | 0);
}

function renderMirror(m: Mirror): void {
  const r = m.rect;
  if (r.width <= 0 || r.height <= 0) return;

  // Redraw the scene only on this mirror's turn (turns are staggered so the cost spreads over frames).
  if (m.stale || (mirrorFrame + m.index) % mirrorEvery === 0) {
    const dpr = renderer.getPixelRatio() * mirrorScale;
    const pw = Math.max(2, Math.round(r.width * dpr)), ph = Math.max(2, Math.round(r.height * dpr));
    if (m.target.width !== pw || m.target.height !== ph) m.target.setSize(pw, ph);

    m.cam.aspect = r.width / r.height;
    m.cam.updateProjectionMatrix();
    renderer.setRenderTarget(m.target);
    renderer.render(scene, m.cam);
    renderer.setRenderTarget(null);
    m.stale = false;
  }

  // (setViewport/setScissor take css pixels — three multiplies by the pixel ratio itself)
  const x = r.left, y = window.innerHeight - r.bottom;
  renderer.setScissorTest(true);
  renderer.setScissor(x, y, r.width, r.height);
  renderer.setViewport(x, y, r.width, r.height);
  m.material.uniforms.map.value = m.target.texture;
  m.material.uniforms.size.value.set(r.width, r.height);
  quadMesh.material = m.material;
  // don't clear first: the rounded corners the shader discards must keep showing the main view
  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.render(quadScene, quadCamera);
  renderer.autoClear = autoClear;
  renderer.setScissorTest(false);
}

// Renders the rearview + both wing mirrors into their DOM-rect viewports.
// NOTE: each viewport's CSS must keep a transparent background, otherwise it paints over
// this render since it sits in front of the canvas in the DOM stacking order.
export function renderMirrorViewports(): void {
  mirrorFrame++;
  // The main pass has just brought every world matrix up to date and nothing has moved since, so
  // the mirror passes skip the full-scene matrix walk (their cameras still update themselves).
  scene.matrixWorldAutoUpdate = false;
  mirrors.forEach(renderMirror);
  scene.matrixWorldAutoUpdate = true;
}

// Lays each DOM mirror over the screen position of its real spot in the cabin (the anchor
// points in entities/cockpit.ts, projected through the eye's camera): the interior mirror hangs
// up by the windscreen, the wing mirrors sit at the door corners. The right one is further
// from the driver's eye than the frustum reaches, so like every driving game it is held at
// the screen edge instead of falling out of view.
export function layoutMirrors(): void {
  const W = window.innerWidth, H = window.innerHeight, margin = 10;
  const els = new Map<Mirror, HTMLElement>();
  mirrors.forEach(m => {
    const el = document.getElementById(m.id);
    if (el) els.set(m, el);
  });
  mirrors.forEach(m => {
    const el = els.get(m);
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const p = MIRROR_ANCHORS[m.anchor].clone().applyMatrix4(camera.projectionMatrix);
    const cx = (p.x + 1) / 2 * W, cy = (1 - p.y) / 2 * H;
    el.style.left = `${THREE.MathUtils.clamp(cx - w / 2, margin, Math.max(margin, W - w - margin))}px`;
    el.style.top = `${THREE.MathUtils.clamp(cy - h / 2, margin, Math.max(margin, H - h - margin))}px`;
  });
  // one layout read after all the writes; a hidden mirror reads as a zero-size rect and is skipped
  mirrors.forEach(m => {
    const el = els.get(m);
    if (!el) return;
    const r = el.getBoundingClientRect();
    m.rect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    m.stale = true;
  });
}

window.addEventListener('resize', layoutMirrors);
