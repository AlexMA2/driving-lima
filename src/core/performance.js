import { renderer, camera, mirrorCamera, leftMirrorCamera, rightMirrorCamera } from './renderer.js';
import { scene, sun } from './scene.js';

// Applies the player's performance settings (see state/settings.js) to the renderer, lights,
// fog and mirrors. Run before the world is built; call refreshMaterials() afterwards so
// materials compiled while shadows were in another state get rebuilt.

export function applyPerformance(perf) {
  renderer.shadowMap.enabled = perf.shadows;
  sun.castShadow = perf.shadows;
  if (sun.shadow.mapSize.x !== perf.shadowQuality) {
    sun.shadow.mapSize.set(perf.shadowQuality, perf.shadowQuality);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // recreated at the new size on the next render
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * (perf.renderScale / 100));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene.fog.near = perf.viewDistance * 0.23;
  scene.fog.far = perf.viewDistance;
  [camera, mirrorCamera, leftMirrorCamera, rightMirrorCamera].forEach(c => {
    c.far = perf.viewDistance * 1.9;
    c.updateProjectionMatrix();
  });

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
  fps.frames++;
  fps.time += dt;
  if (fps.time >= 0.5) {
    document.getElementById('fpsCounter').textContent = `${Math.round(fps.frames / fps.time)} FPS`;
    fps.frames = 0; fps.time = 0;
  }
}
