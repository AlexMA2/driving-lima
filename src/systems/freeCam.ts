import * as THREE from 'three';
import { camera, canvas, renderer } from '../core/renderer';
import { scene } from '../core/scene';
import { LAYER_PLAYER_CAR, LAYER_COCKPIT } from '../entities/cabin';
import { actionOf } from '../state/keybindings';
import { requestPause, releasePause, isPausedFor } from '../state/pause';
import { gameState } from '../state/gameState';

// A detached, free-flying camera to look around the scenario from outside the car: WASD moves
// (Ctrl/Space down/up), the mouse looks (pointer lock). It pauses the game the same way a dialog
// does (state/pause.ts) — physics, traffic and the timer freeze — but keeps its own tiny render
// loop going so the camera itself can still move and the view keeps redrawing while everything
// else stands still. Toggled by a remappable hotkey (state/keybindings.ts, action 'freeCam').

const SPEED = 18; // m/s
const LOOK_SENSITIVITY = 0.0022;
const PITCH_LIMIT = THREE.MathUtils.degToRad(89);

let active = false;
let yaw = 0;
let pitch = 0;
const keys = new Set<string>();

let rafId = 0;
const clock = new THREE.Clock();

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const yawOnly = new THREE.Quaternion();

let hint: HTMLElement | null = null;

export function isFreeCamActive(): boolean {
  return active;
}

function onMouseMove(e: MouseEvent): void {
  if (!active || document.pointerLockElement !== canvas) return;
  yaw -= e.movementX * LOOK_SENSITIVITY;
  pitch -= e.movementY * LOOK_SENSITIVITY;
  pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
}

function onMoveKeyDown(e: KeyboardEvent): void {
  if (!active) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'w' || k === 'a' || k === 's' || k === 'd' || k === 'control') {
    keys.add(k);
    e.preventDefault();
  }
}

function onMoveKeyUp(e: KeyboardEvent): void {
  keys.delete(e.key.toLowerCase());
}

function onPointerLockChange(): void {
  if (active && document.pointerLockElement !== canvas) exitFreeCam(); // the browser released it on its own (e.g. its own Esc handling)
}

function tick(): void {
  rafId = requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  euler.set(pitch, yaw, 0);
  camera.quaternion.setFromEuler(euler);

  yawOnly.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
  forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  right.set(1, 0, 0).applyQuaternion(yawOnly);

  move.set(0, 0, 0);
  if (keys.has('w')) move.add(forward);
  if (keys.has('s')) move.sub(forward);
  if (keys.has('d')) move.add(right);
  if (keys.has('a')) move.sub(right);
  if (keys.has(' ')) move.y += 1;
  if (keys.has('control')) move.y -= 1;
  if (move.lengthSq() > 0) camera.position.addScaledVector(move.normalize(), SPEED * dt);

  // The world is frozen (nothing moved to cast a different shadow), so the last shadow map from
  // before the pause is reused as-is (renderer.shadowMap.autoUpdate is off, see core/renderer.ts).
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);
}

function buildHint(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'freeCamHint';
  el.innerHTML = '<b>CÁMARA LIBRE</b>WASD mover · Ctrl/Espacio bajar/subir · Mouse mirar';
  document.body.append(el);
  return el;
}

function enterFreeCam(): void {
  if (active || gameState.gameOver) return;
  if (isPausedFor('dialog') || isPausedFor('window')) return;
  active = true;

  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  pitch = e.x;
  yaw = e.y;
  keys.clear();

  camera.layers.enable(LAYER_PLAYER_CAR);
  camera.layers.disable(LAYER_COCKPIT);
  document.documentElement.classList.add('freeCamActive');
  hint = buildHint();

  requestPause('freeCam');
  canvas.requestPointerLock();
  clock.getDelta();
  rafId = requestAnimationFrame(tick);
}

export function exitFreeCam(): void {
  if (!active) return;
  active = false;
  keys.clear();
  cancelAnimationFrame(rafId);
  if (document.pointerLockElement === canvas) document.exitPointerLock();

  camera.layers.disable(LAYER_PLAYER_CAR);
  camera.layers.enable(LAYER_COCKPIT);
  document.documentElement.classList.remove('freeCamActive');
  hint?.remove();
  hint = null;

  releasePause('freeCam');
}

export function initFreeCam(): void {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (actionOf(e.key) !== 'freeCam') return;
    if (active) exitFreeCam();
    else enterFreeCam();
  });
  window.addEventListener('keydown', onMoveKeyDown);
  window.addEventListener('keyup', onMoveKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
}
