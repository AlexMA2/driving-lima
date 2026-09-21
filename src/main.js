import * as THREE from 'three';
import './style.css';

import { renderer, camera } from './core/renderer.js';
import { scene, updateSun } from './core/scene.js';
import { world } from './core/physics.js';

import { buildRoad } from './world/road.js';
import { buildBuildings } from './world/buildings.js';
import { buildIntersections, updateTrafficLight, INTERSECTIONS } from './world/intersections.js';
import { buildSchoolZone } from './world/schoolZone.js';
import { buildDecorations } from './world/decorations.js';
import { buildSpeedBumps } from './world/speedBumps.js';

import { buildBreakdowns, updateBreakdownHazards } from './entities/breakdowns.js';
import { createPlayer, chassisBody, syncPlayerMesh } from './entities/player.js';
import { updateAi } from './entities/aiTraffic.js';
import { updatePedestrians } from './entities/pedestrians.js';

import { controlState, initInput, applyVehicleControls } from './systems/input.js';
import {
  initRules,
  setupCollisionListener,
  checkLaneChangeRule,
  checkSpeedRule,
  checkRedLightRule,
  checkSpeedBumpRule,
} from './systems/rules.js';
import { updateCameraRig, renderMirrorViewport } from './systems/cameraRig.js';

import { refreshHud, updateHudPerFrame } from './ui/hud.js';
import { gameState } from './state/gameState.js';

/* ---------------------------------------------------------------------------------------
   BUILD THE STATIC WORLD
   Order here only affects draw sequence, not correctness — none of these depend on
   each other's output.
   --------------------------------------------------------------------------------------- */
buildRoad();
buildBuildings();
buildIntersections();
buildSchoolZone();
buildDecorations();
buildSpeedBumps();
buildBreakdowns();

/* ---------------------------------------------------------------------------------------
   PLAYER + INPUT + RULE ENGINE WIRING
   Must happen in this order: the player body must exist before rules/collision hook into it.
   --------------------------------------------------------------------------------------- */
createPlayer();
initInput();
initRules();
setupCollisionListener();

/* ---------------------------------------------------------------------------------------
   MAIN LOOP
   --------------------------------------------------------------------------------------- */
const clock = new THREE.Clock();
let started = false;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!started || gameState.gameOver) { renderer.render(scene, camera); return; }

  applyVehicleControls(dt);
  world.step(1 / 60, dt, 5);
  syncPlayerMesh();

  updateAi(dt);
  updatePedestrians(dt);
  INTERSECTIONS.forEach(inter => updateTrafficLight(inter, dt));

  checkLaneChangeRule();
  checkSpeedRule();
  checkRedLightRule();
  checkSpeedBumpRule();

  updateBreakdownHazards();

  updateCameraRig();
  updateSun(chassisBody.position);
  updateHudPerFrame();

  // ---- main viewport ----
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);

  // ---- mirror viewport (top-center small window) ----
  renderMirrorViewport();
}

document.getElementById('startBtn').addEventListener('click', () => {
  document.getElementById('startScreen').style.display = 'none';
  started = true;
  clock.getDelta();
});
document.getElementById('restartBtn').addEventListener('click', () => location.reload());

refreshHud();
animate();
