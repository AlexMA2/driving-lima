import { gameState } from '../state/gameState';
import { controlState } from '../systems/input';
import { playerMesh } from '../entities/player';
import { updateIndicatorSound } from '../systems/audio';
import { bindTutorialPanel } from '../ui/tutorialPanel';
import { bindAutoplayBar } from '../ui/autoplayBar';
import { formatMMSS } from '../utils/format';

// Runtime side of the driving HUD (its markup is game/hudTemplate.ts). Parts of the HUD are only rendered for
// some scenarios, so every element here may be missing and is guarded.

interface HudElements {
  timerVal: HTMLElement | null;
  timerRow: HTMLElement | null;
  toasts: HTMLElement | null;
}

let els: HudElements = { timerVal: null, timerRow: null, toasts: null };

// DOM writes dirty layout, and the mirrors/HUD sit on top of a WebGL canvas that redraws every
// frame: only touch an element when its value actually changed.
const shown = { time: '', warn: null as boolean | null };

export interface HudHandlers {
  onFinish(): void;
  onToggleAutopilot?: () => void;
}

export function bindHud(root: ParentNode, { onFinish, onToggleAutopilot }: HudHandlers): void {
  const get = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`#${id}`);
  els = { timerVal: get('timerVal'), timerRow: get('timerRow'), toasts: get('toastContainer') };
  bindTutorialPanel(root);
  bindAutoplayBar(root);

  get('finishBtn')?.addEventListener('click', onFinish);
  get('helpBtn')?.addEventListener('click', () => { void import('../dialogs/controls').then(m => m.openControlsDialog()); });
  get('logBtn')?.addEventListener('click', openLog);
  if (onToggleAutopilot) get('aiBtn')?.addEventListener('click', onToggleAutopilot);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); openLog(); }
  });
}

const openLog = (): void => { void import('../dialogs/log').then(m => m.openLogDialog()); };

function setTimer(): void {
  if (!els.timerVal) return;
  const text = formatMMSS(gameState.timeLeft);
  if (text !== shown.time) { shown.time = text; els.timerVal.textContent = text; }
}

export function refreshHud(): void {
  setTimer();
}

// The speedometer, gear and turn-signal arrows live in the 3D instrument cluster now
// (entities/instrumentCluster.ts); this keeps the rest of the HUD current and returns the
// shared blink phase so the cluster's arrows and the car's lamps flash together.
export function updateHudPerFrame(): boolean {
  const blink = Math.floor(performance.now() / 350) % 2 === 0;
  const blinkActive = (controlState.signalLeft || controlState.signalRight) && blink;
  updateIndicatorSound(blinkActive);

  const { left, right } = playerMesh.userData.indicators;
  left.forEach(m => { m.material.emissiveIntensity = controlState.signalLeft && blink ? 1 : 0; });
  right.forEach(m => { m.material.emissiveIntensity = controlState.signalRight && blink ? 1 : 0; });

  setTimer();
  if (els.timerRow) {
    const warn = gameState.timeLeft <= 15;
    if (warn !== shown.warn) { shown.warn = warn; els.timerRow.classList.toggle('warn', warn); }
  }

  return blink;
}

// `kind` 'good' gives the toast the green accent (used for positive feedback, e.g. tutorial steps).
export function showToast(title: string, sub?: string, kind?: 'good'): void {
  if (!els.toasts) return;
  const el = document.createElement('div');
  el.className = kind === 'good' ? 'toast good' : 'toast';
  el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
