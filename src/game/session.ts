import * as THREE from 'three';
import { renderer, camera, canvas } from '../core/renderer';
import { batchStatic } from '../core/batching';
import { scene, updateSun } from '../core/scene';
import { world } from '../core/physics';
import { applyPerformance, refreshMaterials, updateFps } from '../core/performance';
import { createPlayer, chassisBody, syncPlayerMesh, forwardSpeed } from '../entities/player';
import { initPedestrians } from '../entities/pedestrians';
import { buildCockpit, updateCockpit } from '../entities/cockpit';
import { controlState, initInput, initSteerAssist, applyVehicleControls } from '../systems/input';
import { initRules, setupCollisionListener, checkSpeedRule } from '../systems/rules';
import { updateCameraRig, renderMirrorViewports, layoutMirrors } from '../systems/cameraRig';
import { initAudio, updateEngineSound, suspendAudio, resumeAudio } from '../systems/audio';
import { gameState } from '../state/gameState';
import { skipPausedTime } from '../state/gameClock';
import { applyControls, getControls, type PerformanceSettings, type ResolvedScenario } from '../state/settings';
import { actionOf } from '../state/keybindings';
import { reloadAndRestart, reloadToHome } from '../app/autostart';
import { showPauseDialog, hidePauseDialog } from '../dialogs/pause';
import { bindHud, refreshHud, updateHudPerFrame, showToast } from './hud';
import { bindIdleHint, updateIdleHint } from './idleHint';
import type { LayoutRuntime } from './layouts/types';

// The 3D game itself: the renderer, the physics world, the player's car and the frame loop, common to every
// scenario. Everything that depends on the scenario's layout lives in game/layouts/*.ts, and this whole module
// (with three.js and cannon-es behind it) is only fetched once the player picks a scenario to play.

const LAYOUTS: Record<ResolvedScenario['layout'], () => Promise<{ layout: LayoutRuntime }>> = {
  line: () => import('./layouts/line'),
  grid: () => import('./layouts/grid'),
  roundabout: () => import('./layouts/roundabout'),
  tutorial: () => import('./layouts/tutorial'),
  parking: () => import('./layouts/parking'),
};

export interface Session {
  // The WebGL canvas: the game screen puts it in the page before starting.
  canvas: HTMLCanvasElement;
  // `hudRoot` holds the already rendered HUD (see game/hudTemplate.ts).
  start(hudRoot: HTMLElement, perf: PerformanceSettings): void;
}

// Loads the code for the scenario's layout. Nothing is built yet.
export async function prepareSession(scenario: ResolvedScenario): Promise<Session> {
  const { layout } = await LAYOUTS[scenario.layout]();
  return { canvas, start: (hudRoot, perf) => run(scenario, layout, hudRoot, perf) };
}

const clock = new THREE.Clock();

function run(scenario: ResolvedScenario, layout: LayoutRuntime, hudRoot: HTMLElement, perf: PerformanceSettings): void {
  const endGame = (title?: string): void => {
    if (gameState.gameOver) return;
    gameState.gameOver = true;
    void import('./results').then(m => m.showResults(scenario.id, title));
  };

  applyControls(getControls()); // the saved control tuning takes effect from the first frame
  bindHud(hudRoot, {
    onFinish: () => endGame(scenario.untimed ? (scenario.layout === 'parking' ? 'PRÁCTICA TERMINADA' : 'TUTORIAL TERMINADO') : undefined),
  });
  bindIdleHint(hudRoot);
  applyPerformance(perf);

  // The cockpit (dashboard/wheel/pillars) is parented to `camera` (see entities/cockpit.ts) so
  // it rides rigidly with the first-person view. WebGLRenderer only draws what it finds by
  // traversing the `scene` graph, so the camera itself must be part of that graph for its
  // children to ever render.
  scene.add(camera);

  const spawn = layout.build(scenario);

  // Everything built so far is scenery that never changes: weld what looks alike into far fewer draw calls.
  // Chunked per area so the far end of a long street is still culled while it is out of view.
  batchStatic(scene, { cell: 96 });

  createPlayer(spawn);
  initPedestrians(scenario);
  layout.init(scenario, { endGame });
  buildCockpit();
  initInput();
  initSteerAssist(layout.steerAssistZone);
  initAudio();
  initRules(scenario);
  setupCollisionListener();
  if (layout.intro) showToast(layout.intro.title, layout.intro.text);

  refreshMaterials();
  layoutMirrors();
  gameState.duration = scenario.duration;
  gameState.timeLeft = scenario.duration;
  clock.getDelta();
  refreshHud();

  let frame = 0;
  let paused = false;
  let pausedAt = 0;

  window.addEventListener('keydown', (e) => {
    if (paused) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = actionOf(e.key);
    if (action === 'menu') reloadToHome();
    else if (action === 'restart') reloadAndRestart(scenario.id);
  });

  const animate = (): void => {
    frame = requestAnimationFrame(animate);
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    if (gameState.gameOver) return; // the results screen covers the canvas: leave the last frame up instead of redrawing it
    updateFps(rawDt);

    gameState.elapsed += dt;
    if (!scenario.untimed) {
      gameState.timeLeft = Math.max(0, gameState.timeLeft - dt);
      if (gameState.timeLeft <= 0) {
        endGame();
        renderer.render(scene, camera);
        return;
      }
    }

    applyVehicleControls(dt);
    world.step(1 / 60, dt, 5);
    syncPlayerMesh();

    const speedKmh = chassisBody.velocity.length() * 3.6;
    layout.update(dt, speedKmh);
    checkSpeedRule();
    updateIdleHint(dt, speedKmh);

    updateCameraRig();
    updateSun(chassisBody.position);
    const blink = updateHudPerFrame();
    updateCockpit({
      dt,
      wheelAngle: controlState.wheelAngle,
      signalLeft: controlState.signalLeft, signalRight: controlState.signalRight, blink,
      speedKmh, forwardMs: forwardSpeed(),
      throttle: controlState.throttle, brakeHeld: controlState.brakeHeld,
      handbrake: controlState.handbrake,
    });
    updateEngineSound(speedKmh, controlState.throttle);

    // ---- main viewport ----
    // The sun's shadow map is drawn only here (autoUpdate is off, see core/renderer.ts): the mirror
    // passes below reuse it instead of re-rendering the same shadows three more times per frame.
    renderer.shadowMap.needsUpdate = true;
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);

    // ---- mirror viewports (rear + both wing mirrors) ----
    renderMirrorViewports();
  };

  // The game is paused for as long as its window is not the one in use (another window or tab in front, the
  // browser's own UI focused). The frame loop stops altogether, so a paused game costs no CPU or GPU time, and
  // the sound is suspended too. Coming back resumes by itself.
  const setPaused = (next: boolean): void => {
    if (next === paused || gameState.gameOver) return; // the results screen has nothing left to pause
    paused = next;
    document.documentElement.classList.toggle('gamePaused', paused);
    if (paused) {
      cancelAnimationFrame(frame);
      pausedAt = performance.now();
      suspendAudio();
      showPauseDialog();
    } else {
      hidePauseDialog();
      skipPausedTime(performance.now() - pausedAt); // real-time timers do not count the pause
      clock.getDelta(); // nor does the frame clock: the pause must not come back as one huge step
      resumeAudio();
      frame = requestAnimationFrame(animate);
    }
  };
  window.addEventListener('blur', () => setPaused(true));
  window.addEventListener('focus', () => setPaused(document.hidden));
  document.addEventListener('visibilitychange', () => setPaused(document.hidden || !document.hasFocus()));

  animate();
  if (document.hidden || !document.hasFocus()) setPaused(true); // started while another window had the focus
}
