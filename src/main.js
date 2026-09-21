import * as THREE from 'three';
import './style.css';

import { SCENARIOS } from './config.js';
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
} from './systems/rules.js';
import { updateCameraRig, renderMirrorViewports } from './systems/cameraRig.js';
import { initAudio, updateEngineSound } from './systems/audio.js';

import { refreshHud, updateHudPerFrame, initDialogs, showToast } from './ui/hud.js';
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

let selectedScenario = 'straight';
document.querySelectorAll('.scenarioCard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.scenarioCard').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedScenario = card.dataset.scenario;
  });
});

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('startScreen').style.display = 'none';
  buildWorld(selectedScenario);
  started = true;
  clock.getDelta();
});
document.getElementById('restartBtn').addEventListener('click', () => location.reload());

refreshHud();
animate();
