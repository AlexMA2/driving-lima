import * as THREE from 'three';
import './style.css';

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
import { buildRoundabout } from './world/roundabout.js';

import { initBreakdowns, updateBreakdowns } from './entities/breakdowns.js';
import { createPlayer, chassisBody, syncPlayerMesh } from './entities/player.js';
import { updateAi, initAiTraffic } from './entities/aiTraffic.js';
import { initRoundaboutAi, updateRoundaboutAi } from './entities/roundaboutAi.js';
import { updatePedestrians, initPedestrians } from './entities/pedestrians.js';
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
  checkRoundaboutRules,
} from './systems/rules.js';
import { updateCameraRig, renderMirrorViewports } from './systems/cameraRig.js';
import { initAudio, updateEngineSound } from './systems/audio.js';

import { refreshHud, updateHudPerFrame, initDialogs, showToast, showResults } from './ui/hud.js';
import { gameState } from './state/gameState.js';
import { resolveScenario, getPerformance } from './state/settings.js';
import { applyPerformance, refreshMaterials, updateFps } from './core/performance.js';
import { initMenu, setScreen } from './ui/menu.js';
import { initGlobalConfig } from './ui/globalConfigDialog.js';

// The cockpit (dashboard/wheel/pillars) is parented to `camera` (see entities/cockpit.js) so
// it rides rigidly with the first-person view. WebGLRenderer only draws what it finds by
// traversing the `scene` graph, so the camera itself must be part of that graph for its
// children to ever render.
scene.add(camera);

let scenario = null;
let started = false;
const clock = new THREE.Clock();

function buildWorld(scenarioId) {
  scenario = resolveScenario(scenarioId);
  let spawn;

  if (scenario.layout === 'grid') {
    spawn = buildGridCity(scenario);
  } else if (scenario.layout === 'roundabout') {
    spawn = buildRoundabout(scenario);
  } else {
    buildRoad(scenario);
    buildBuildings(scenario);
    buildIntersections();
    buildSchoolZone();
    buildDecorations();
    buildSpeedBumps();
    initAiTraffic(scenario);
    initPedestrians(scenario);
    spawn = { x: PLAYER_LANES[0], y: 1.2, z: WORLD_Z_START - 30, rotY: 0 };
  }

  createPlayer(spawn);
  if (scenario.layout === 'roundabout') initRoundaboutAi(scenario); // after the player exists so spawns keep clear of it
  if (scenario.layout === 'line') initBreakdowns(scenario);
  buildCockpit();
  initInput();
  initAudio();
  initRules(scenario);
  setupCollisionListener();

  if (scenario.layout === 'grid') {
    showToast('Ciudad con Giros', 'Gira libremente en cada cruce. Respeta los semáforos.');
  } else if (scenario.layout === 'roundabout') {
    showToast('Rotondas', 'Cede el paso a quien ya circula y señaliza tu salida a la derecha.');
  }
}

function endGame() {
  if (gameState.gameOver) return;
  gameState.gameOver = true;
  showResults();
}

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  if (!started || gameState.gameOver) { renderer.render(scene, camera); return; }
  updateFps(rawDt);

  gameState.timeLeft = Math.max(0, gameState.timeLeft - dt);
  if (gameState.timeLeft <= 0) {
    endGame();
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
  } else if (scenario.layout === 'roundabout') {
    updateRoundaboutAi(dt);
    checkRoundaboutRules();
  } else {
    updateAi(dt);
    updatePedestrians(dt);
    INTERSECTIONS.forEach(inter => updateTrafficLight(inter, dt));
    checkLaneChangeRule();
    checkRedLightRule();
    checkSpeedBumpRule();
    checkWrongWayRule();
    updateBreakdowns();
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

// Persists the in-progress scenario across a full page reload (its settings live in localStorage) — reload is the
// simplest reliable way to reset all of three.js/cannon-es state (nothing in the world
// builders tracks/tears down what a previous buildWorld() created), and "R" / "Volver al
// inicio" would otherwise have to duplicate that cleanup by hand.
const AUTOSTART_KEY = 'dls_autostart';

function startGame(scenarioId) {
  setScreen('game');
  document.getElementById('gameOverScreen').style.display = 'none';
  applyPerformance(getPerformance());
  buildWorld(scenarioId);
  refreshMaterials();
  gameState.duration = scenario.duration;
  gameState.timeLeft = scenario.duration;
  started = true;
  clock.getDelta();
  refreshHud();
}

function goHome() {
  sessionStorage.removeItem(AUTOSTART_KEY);
  location.reload();
}

function restartGame() {
  sessionStorage.setItem(AUTOSTART_KEY, JSON.stringify({ scenario: scenario.id }));
  location.reload();
}

initMenu({ onStart: startGame });
initGlobalConfig();
document.getElementById('restartBtn').addEventListener('click', restartGame);
document.getElementById('homeBtn').addEventListener('click', goHome);
document.getElementById('finishBtn').addEventListener('click', () => { if (started) endGame(); });

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
    startGame(JSON.parse(pendingAutostart).scenario);
  } catch { /* malformed/stale sessionStorage entry — fall back to the normal start screen */ }
}
