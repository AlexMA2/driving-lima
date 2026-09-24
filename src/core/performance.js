import { renderer, camera, mirrorCamera, leftMirrorCamera, rightMirrorCamera } from './renderer.js';
import { scene, sun } from './scene.js';
import { setMirrorQuality, setMirrorRefresh } from '../systems/cameraRig.js';

// Applies the player's performance settings (see state/settings.js) to the renderer, lights,
// fog and mirrors. Run before the world is built; call refreshMaterials() afterwards so
// materials compiled while shadows were in another state get rebuilt.

// Adaptive resolution: how many pixels are shaded is the cost that grows with the screen, so when the frame rate
// falls the render scale is stepped down (never below MIN_SCALE) and, after a stretch of smooth frames, back up
// towards the scale chosen in the settings. Each failed attempt to go back up doubles the wait before the next.
const MIN_SCALE = 0.5;
const adaptive = { enabled: false, max: 1, scale: 1, frames: 0, time: 0, good: 0, wait: 8, sinceRaise: Infinity };

function applyRenderScale(scale) {
  adaptive.scale = scale;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * scale);
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function adaptResolution(dt) {
  if (!adaptive.enabled) return;
  if (dt > 0.25) { adaptive.frames = 0; adaptive.time = 0; return; } // a hidden tab or a hitch, not a measure of load
  adaptive.frames++;
  adaptive.time += dt;
  if (adaptive.time < 1) return;

  const fps = adaptive.frames / adaptive.time;
  adaptive.frames = 0; adaptive.time = 0;
  adaptive.sinceRaise++;

  if (fps < 45 && adaptive.scale > MIN_SCALE) {
    if (adaptive.sinceRaise <= 2) adaptive.wait = Math.min(adaptive.wait * 2, 64); // the last raise did not hold
    adaptive.good = 0;
    applyRenderScale(Math.max(MIN_SCALE, adaptive.scale - 0.1));
  } else if (fps >= 56 && adaptive.scale < adaptive.max) {
    if (++adaptive.good >= adaptive.wait) {
      adaptive.good = 0;
      adaptive.sinceRaise = 0;
      applyRenderScale(Math.min(adaptive.max, adaptive.scale + 0.1));
    }
  } else adaptive.good = 0;
}

export function applyPerformance(perf) {
  renderer.shadowMap.enabled = perf.shadows;
  sun.castShadow = perf.shadows;
  if (sun.shadow.mapSize.x !== perf.shadowQuality) {
    sun.shadow.mapSize.set(perf.shadowQuality, perf.shadowQuality);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // recreated at the new size on the next render
  }

  adaptive.max = perf.renderScale / 100;
  adaptive.enabled = !!perf.adaptiveResolution;
  applyRenderScale(adaptive.max);

  scene.fog.near = perf.viewDistance * 0.23;
  scene.fog.far = perf.viewDistance;
  // Past the fog's far distance everything is exactly the sky colour, so drawing it is wasted work:
  // the far plane sits right there and frustum culling drops all those objects (the mirrors too).
  [camera, mirrorCamera, leftMirrorCamera, rightMirrorCamera].forEach(c => {
    c.far = perf.viewDistance * 1.05;
    c.updateProjectionMatrix();
  });

  setMirrorQuality(perf.mirrorQuality);
  setMirrorRefresh(perf.mirrorRefresh);

  // A hidden mirror has a zero-size rect, which the mirror renderer skips (see systems/cameraRig.js).
  ['leftMirrorViewport', 'rightMirrorViewport'].forEach(id => {
    document.getElementById(id).style.display = perf.sideMirrors ? '' : 'none';
  });
  document.getElementById('fpsCounter').style.display = perf.showFps ? 'block' : 'none';
}

export function refreshMaterials() {
  scene.traverse(o => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach(m => { m.needsUpdate = true; });
  });
}

const fps = { frames: 0, time: 0 };

// Cheap FPS readout: averaged over half a second so the number is readable.
export function updateFps(dt) {
  adaptResolution(dt);
  fps.frames++;
  fps.time += dt;
  if (fps.time >= 0.5) {
    document.getElementById('fpsCounter').textContent = `${Math.round(fps.frames / fps.time)} FPS`;
    fps.frames = 0; fps.time = 0;
  }
}
