import { gameState } from '../state/gameState.js';
import { controlState } from '../systems/input.js';
import { chassisBody, playerMesh } from '../entities/player.js';
import { inSchoolZone } from '../world/schoolZone.js';
import { updateIndicatorSound } from '../systems/audio.js';

const speedValEl = document.getElementById('speedVal');
const scoreValEl = document.getElementById('scoreVal');
const scoreBarEl = document.getElementById('scoreBar');
const damageBarEl = document.getElementById('damageBar');
const zoneTagEl = document.getElementById('zoneTag');
const handbrakeTagEl = document.getElementById('handbrakeTag');
const indLEl = document.getElementById('indL');
const indREl = document.getElementById('indR');
const needleEl = document.getElementById('needle');
const gaugeArcEl = document.getElementById('gaugeArc');

const GAUGE_MAX_KMH = 140;
const GAUGE_ARC_LEN = 270; // matches the SVG path's approximate arc length (stroke-dasharray)

export function refreshHud() {
  scoreValEl.textContent = Math.round(gameState.score);
  scoreBarEl.style.width = `${gameState.score}%`;
  scoreBarEl.style.background = gameState.score > 50
    ? 'linear-gradient(90deg,#4caf50,#8bc34a)'
    : gameState.score > 20
      ? 'linear-gradient(90deg,#ff9800,#ffc107)'
      : 'linear-gradient(90deg,#e53935,#ff5252)';
  damageBarEl.style.width = `${gameState.damage}%`;
}

export function initDialogs() {
  const dialog = document.getElementById('instructionsDialog');
  document.getElementById('helpBtn').addEventListener('click', () => dialog.classList.add('show'));
  document.getElementById('closeInstructions').addEventListener('click', () => dialog.classList.remove('show'));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.classList.remove('show'); });
}

export function updateHudPerFrame() {
  const speedKmh = chassisBody.velocity.length() * 3.6;
  speedValEl.textContent = Math.round(speedKmh);
  zoneTagEl.style.display = inSchoolZone(chassisBody.position.z) ? 'block' : 'none';
  handbrakeTagEl.classList.toggle('show', controlState.handbrake);

  const frac = Math.min(speedKmh / GAUGE_MAX_KMH, 1);
  needleEl.style.transform = `rotate(${-90 + frac * 180}deg)`;
  gaugeArcEl.style.strokeDashoffset = `${GAUGE_ARC_LEN * (1 - frac)}`;
  gaugeArcEl.style.stroke = frac > 0.8 ? '#ff5252' : frac > 0.55 ? '#ffc107' : '#4caf50';

  const blink = Math.floor(performance.now() / 350) % 2 === 0;
  const blinkActive = (controlState.signalLeft || controlState.signalRight) && blink;
  indLEl.classList.toggle('on', controlState.signalLeft && blink);
  indREl.classList.toggle('on', controlState.signalRight && blink);
  updateIndicatorSound(blinkActive);

  playerMesh.userData.indicators.left.forEach(m => { m.material.emissiveIntensity = controlState.signalLeft && blink ? 1 : 0; });
  playerMesh.userData.indicators.right.forEach(m => { m.material.emissiveIntensity = controlState.signalRight && blink ? 1 : 0; });

  return blink;
}

export function showToast(title, sub) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function showGameOver() {
  document.getElementById('gameOverScreen').style.display = 'flex';
}
