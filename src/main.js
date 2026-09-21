import * as THREE from 'three';
import './style.css';

import { CONFIG, SCENARIOS } from './config.js';
import { renderer, camera } from './core/renderer.js';
import { scene, updateSun } from './core/scene.js';
import { world } from './core/physics.js';

import { buildRoad, PLAYER_LANES, WORLD_Z_START } from './world/road.js';
import { buildBuildings } from './world/buildings.js';
import { buildIntersections, updateTrafficLight, INTERSECTIONS } from './world/intersections.js';
import { buildSchoolZone } from './world/schoolZone.js';
import { buildDecorations } from './world/decorations.js';
import { buildSpeedBumps } from './world/speedBumps.js';
import { buildGridCity, updateGridTrafficLights, updateGridAi, checkGridRedLight } from './world/gridCity.js';

import { buildBreakdowns, updateBreakdownHazards } from './entities/breakdowns.js';
import { createPlayer, chassisBody, syncPlayerMesh } from './entities/player.js';
import { updateAi, initAiTraffic } from './entities/aiTraffic.js';
import { updatePedestrians } from './entities/pedestrians.js';
import { buildCockpit, updateCockpit } from './entities/cockpit.js';

import { controlState, initInput, applyVehicleControls } from './systems/input.js';
import {
  initRules,
  setupCollisionListener,
  checkLaneChangeRule,
  checkSpeedRule,
  checkRedLightRule,
  checkSpeedBumpRule,
  checkWrongWayRule,
} from './systems/rules.js';
import { updateCameraRig, renderMirrorViewports } from './systems/cameraRig.js';
import { initAudio, updateEngineSound } from './systems/audio.js';

import { refreshHud, updateHudPerFrame, initDialogs, showToast, showResults } from './ui/hud.js';
import { gameState } from './state/gameState.js';

// The cockpit (dashboard/wheel/pillars) is parented to `camera` (see entities/cockpit.js) so
// it rides rigidly with the first-person view. WebGLRenderer only draws what it finds by
// traversing the `scene` graph, so the camera itself must be part of that graph for its
// children to ever render.
scene.add(camera);

let scenario = null;
let started = false;
const clock = new THREE.Clock();

function buildWorld(scenarioId) {
  scenario = SCENARIOS[scenarioId];
  let spawn;

  if (scenario.layout === 'grid') {
    spawn = buildGridCity(scenario);
  } else {
    buildRoad(scenario);
    buildBuildings(scenario);
    buildIntersections();
    buildSchoolZone();
    buildDecorations();
    buildSpeedBumps();
    buildBreakdowns();
    initAiTraffic(scenario);
    spawn = { x: PLAYER_LANES[0], y: 1.2, z: WORLD_Z_START - 30, rotY: 0 };
  }

  createPlayer(spawn);
  buildCockpit();
  initInput();
  initAudio();
  initRules(scenario);
  setupCollisionListener();

  if (scenario.layout === 'grid') {
    showToast('Ciudad con Giros', 'Gira libremente en cada cruce. Respeta los semáforos.');
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!started || gameState.gameOver) { renderer.render(scene, camera); return; }

  gameState.timeLeft = Math.max(0, gameState.timeLeft - dt);
  if (gameState.timeLeft <= 0) {
    gameState.gameOver = true;
    showResults();
    renderer.render(scene, camera);
    return;
  }

  applyVehicleControls(dt);
  world.step(1 / 60, dt, 5);
  syncPlayerMesh();

  const speedKmh = chassisBody.velocity.length() * 3.6;

  if (scenario.layout === 'grid') {
    updateGridAi(dt);
    updateGridTrafficLights(dt);
    checkGridRedLight(speedKmh);
  } else {
    updateAi(dt);
    updatePedestrians(dt);
    INTERSECTIONS.forEach(inter => updateTrafficLight(inter, dt));
    checkLaneChangeRule();
    checkRedLightRule();
    checkSpeedBumpRule();
    checkWrongWayRule();
    updateBreakdownHazards();
  }
  checkSpeedRule();

  updateCameraRig();
  updateSun(chassisBody.position);
  const blink = updateHudPerFrame();
  updateCockpit(controlState.wheelAngle, controlState.signalLeft, controlState.signalRight, blink);
  updateEngineSound(speedKmh, controlState.throttle);

  // ---- main viewport ----
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);

  // ---- mirror viewports (rear + both wing mirrors) ----
  renderMirrorViewports();
}

initDialogs();

// Persists the in-progress scenario+duration across a full page reload — reload is the
// simplest reliable way to reset all of three.js/cannon-es state (nothing in the world
// builders tracks/tears down what a previous buildWorld() created), and "R" / "Volver al
// inicio" would otherwise have to duplicate that cleanup by hand.
const AUTOSTART_KEY = 'dls_autostart';

let selectedScenario = 'straight';
let selectedDuration = CONFIG.DEFAULT_GAME_DURATION;

document.querySelectorAll('.scenarioCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.scenarioCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedScenario = card.dataset.scenario;
  });
});

document.querySelectorAll('.durationOpt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.durationOpt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDuration = parseInt(btn.dataset.seconds, 10);
  });
});

function startGame(scenarioId, durationSec) {
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('gameOverScreen').style.display = 'none';
  gameState.duration = durationSec;
  gameState.timeLeft = durationSec;
  buildWorld(scenarioId);
  started = true;
  clock.getDelta();
  refreshHud();
}

function goHome() {
  sessionStorage.removeItem(AUTOSTART_KEY);
  location.reload();
}

function restartGame() {
  sessionStorage.setItem(AUTOSTART_KEY, JSON.stringify({ scenario: scenario.id, duration: gameState.duration }));
  location.reload();
}

document.getElementById('startBtn').addEventListener('click', () => startGame(selectedScenario, selectedDuration));
document.getElementById('restartBtn').addEventListener('click', restartGame);
document.getElementById('homeBtn').addEventListener('click', goHome);

window.addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.key === 'Escape') goHome();
  else if (e.key.toLowerCase() === 'r') restartGame();
});

refreshHud();
animate();

// A "R" restart or the results screen's "Reintentar" reloads with this flag set so the
// chosen scenario/duration survive the reload instead of falling back to the defaults.
const pendingAutostart = sessionStorage.getItem(AUTOSTART_KEY);
if (pendingAutostart) {
  sessionStorage.removeItem(AUTOSTART_KEY);
  try {
    const { scenario: autoScenario, duration: autoDuration } = JSON.parse(pendingAutostart);
    if (autoScenario) selectedScenario = autoScenario;
    if (autoDuration) selectedDuration = autoDuration;
    startGame(selectedScenario, selectedDuration);
  } catch { /* malformed/stale sessionStorage entry — fall back to the normal start screen */ }
}
