import { PENALTIES } from '../config.js';
import { gameState } from '../state/gameState.js';
import { controlState } from '../systems/input.js';
import { chassisBody, playerMesh } from '../entities/player.js';
import { inSchoolZone } from '../world/schoolZone.js';
import { updateIndicatorSound } from '../systems/audio.js';

const speedValEl = document.getElementById('speedVal');
const zoneTagEl = document.getElementById('zoneTag');
const handbrakeTagEl = document.getElementById('handbrakeTag');
const indLEl = document.getElementById('indL');
const indREl = document.getElementById('indR');
const needleEl = document.getElementById('needle');
const gaugeArcEl = document.getElementById('gaugeArc');
const timerValEl = document.getElementById('timerVal');
const timerRowEl = document.getElementById('timerRow');

const GAUGE_MAX_KMH = 140;
const GAUGE_ARC_LEN = 270; // matches the SVG path's approximate arc length (stroke-dasharray)

function formatMMSS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function refreshHud() {
  timerValEl.textContent = formatMMSS(gameState.timeLeft);
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

  timerValEl.textContent = formatMMSS(gameState.timeLeft);
  timerRowEl.classList.toggle('warn', gameState.timeLeft <= 15);

  return blink;
}

export function showToast(title, sub) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// End-of-run results: every rule broken this run, its per-instance fine, a subtotal, and a
// grand total — built from gameState.infractionCounts rather than a running score/damage tally.
export function showResults() {
  const listEl = document.getElementById('resultsInfractions');
  listEl.innerHTML = '';

  const codes = Object.keys(gameState.infractionCounts).filter(code => gameState.infractionCounts[code] > 0);
  let total = 0;

  if (codes.length === 0) {
    listEl.innerHTML = '<div class="resultRow"><span>Sin infracciones — ¡buen manejo!</span><b>S/ 0</b></div>';
  } else {
    codes.forEach(code => {
      const count = gameState.infractionCounts[code];
      const p = PENALTIES[code];
      const subtotal = p.fine * count;
      total += subtotal;
      const row = document.createElement('div');
      row.className = 'resultRow';
      row.innerHTML = `<span>${p.label}${count > 1 ? ` &times;${count}` : ''}</span><b>S/ ${subtotal}</b>`;
      listEl.appendChild(row);
    });
  }

  document.getElementById('resultTotal').textContent = `S/ ${total}`;
  const elapsed = gameState.duration - Math.max(0, gameState.timeLeft);
  document.getElementById('resultTime').textContent = formatMMSS(elapsed);
  document.getElementById('gameOverScreen').style.display = 'flex';
}
