import type { PerformanceSettings, ResolvedScenario } from '../state/settings';
import { tutorialPanelHtml } from '../ui/tutorialPanel';
import { formatMMSS } from '../utils/format';

// The driving HUD's markup. It is assembled per game from what the scenario and the player's settings need:
// no countdown in an untimed exercise, no school-zone tag away from the avenue, no FPS counter or wing mirrors
// unless they are switched on, no instruction panel outside the guided scenarios. What is not needed is not
// rendered at all.

export interface HudOptions {
  timed: boolean;             // show the countdown
  duration: number;           // seconds, for the first reading of the countdown
  schoolZone: boolean;        // the avenue's "zona escolar" tag
  fps: boolean;
  sideMirrors: boolean;
  panelKind: string | null;   // label of the instruction panel, or null when the scenario has none
}

export function hudOptionsFor(scenario: ResolvedScenario, perf: PerformanceSettings): HudOptions {
  let panelKind: string | null = null;
  if (scenario.layout === 'tutorial') panelKind = 'TUTORIAL';
  else if (scenario.layout === 'parking' && scenario.guide) {
    panelKind = scenario.parkingMode === 'perpendicular' ? 'ESTACIONAMIENTO EN BATERÍA' : 'ESTACIONAMIENTO EN PARALELO';
  }
  return {
    timed: !scenario.untimed,
    duration: scenario.duration,
    schoolZone: scenario.layout === 'line',
    fps: perf.showFps,
    sideMirrors: perf.sideMirrors,
    panelKind,
  };
}

export function hudHtml(o: HudOptions): string {
  return `
<div id="hud"${o.panelKind ? ' class="guided"' : ''}>
  <div id="timerPanel">
    ${o.timed ? `<div id="timerRow"><span id="timerIcon">⏱</span><span id="timerVal">${formatMMSS(o.duration)}</span></div>` : ''}
    <button id="finishBtn" title="Terminar la partida">🏁 TERMINAR</button>
  </div>
  ${o.fps ? '<div id="fpsCounter">-- FPS</div>' : ''}
  ${o.schoolZone ? '<div id="zoneTag">⚠ ZONA ESCOLAR - MÁX 30 KM/H</div>' : ''}
  ${o.panelKind ? tutorialPanelHtml(o.panelKind) : ''}
  <div id="toastContainer"></div>

  <div id="mirrorViewport"></div>
  ${o.sideMirrors ? '<div id="leftMirrorViewport"></div><div id="rightMirrorViewport"></div>' : ''}

  <button id="logBtn" title="Registro de depuración (Ctrl+L)">LOG</button>
  <button id="helpBtn" title="Instrucciones">?</button>
</div>`;
}
