import { PENALTIES } from '../config.js';
import { gameState } from '../state/gameState.js';
import { controlState } from '../systems/input.js';
import { chassisBody, playerMesh } from '../entities/player.js';
import { inSchoolZone } from '../world/schoolZone.js';
import { updateIndicatorSound } from '../systems/audio.js';
import { getLogText, clearLog } from '../systems/debugLog.js';
import { keyLabels, escapeHtml } from '../state/keybindings.js';

const zoneTagEl = document.getElementById('zoneTag');
const timerValEl = document.getElementById('timerVal');
const timerRowEl = document.getElementById('timerRow');

function formatMMSS(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

// DOM writes dirty layout, and the mirrors/HUD sit on top of a WebGL canvas that redraws every
// frame: only touch an element when its value actually changed.
const shown = { zone: null, time: '', warn: null };

function setTimer() {
  const text = formatMMSS(gameState.timeLeft);
  if (text !== shown.time) { shown.time = text; timerValEl.textContent = text; }
}

export function refreshHud() {
  setTimer();
}

// The controls list, rebuilt each time the dialog opens so it shows the player's own keys.
function controlsHelpHtml() {
  const rows = [
    ['Mouse (arrastrar)', 'Girar el volante (dirección hidráulica, se auto-centra al soltar)'],
    [keyLabels('steerLeft'), 'Girar el volante a la izquierda con el teclado'],
    [keyLabels('steerRight'), 'Girar el volante a la derecha con el teclado'],
    ['Rueda del mouse ↑', 'Acelerar (sube la posición del acelerador y se mantiene)'],
    ['Rueda del mouse ↓', 'Desacelerar (baja la posición del acelerador y se mantiene)'],
    [keyLabels('brake'), 'Freno (mantener; casi detenido, sigue presionando para meter reversa, que avanza a paso de tortuga)'],
    [keyLabels('handbrake'), 'Freno de mano'],
    [`${keyLabels('signalLeft')} / ${keyLabels('signalRight')}`, 'Direccionales (izquierda / derecha)'],
    [keyLabels('signalOff'), 'Apagar direccionales'],
    [keyLabels('horn'), 'Bocina'],
    [keyLabels('restart'), 'Reiniciar la partida'],
    [keyLabels('menu'), 'Volver al menú principal'],
    ['CTRL+L', 'Abrir el registro de depuración'],
  ];
  return rows.map(([keys, what]) => `<div><b>${escapeHtml(keys)}</b> — ${what}</div>`).join('');
}

export function initDialogs() {
  const dialog = document.getElementById('instructionsDialog');
  const showControls = () => {
    document.getElementById('controlsList').innerHTML = controlsHelpHtml();
    dialog.classList.add('show');
  };
  document.getElementById('helpBtn').addEventListener('click', showControls);
  document.getElementById('controlsBtn').addEventListener('click', showControls);
  document.getElementById('closeInstructions').addEventListener('click', () => dialog.classList.remove('show'));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.classList.remove('show'); });

  // Debug action log: a copyable dump of every input/rule event, meant to be pasted back for
  // diagnosing intermittent bugs (throttle not responding, a lane-change ticket firing while
  // signaled, etc.) that are hard to catch live. Opened with the LOG button or Ctrl+L.
  const logDialog = document.getElementById('logDialog');
  const logTextEl = document.getElementById('logText');
  const openLog = () => { logTextEl.textContent = getLogText(); logDialog.classList.add('show'); };
  document.getElementById('logBtn').addEventListener('click', openLog);
  document.getElementById('closeLog').addEventListener('click', () => logDialog.classList.remove('show'));
  logDialog.addEventListener('click', (e) => { if (e.target === logDialog) logDialog.classList.remove('show'); });
  document.getElementById('refreshLogBtn').addEventListener('click', () => { logTextEl.textContent = getLogText(); });
  document.getElementById('clearLogBtn').addEventListener('click', () => { clearLog(); logTextEl.textContent = getLogText(); });
  document.getElementById('copyLogBtn').addEventListener('click', async () => {
    const btn = document.getElementById('copyLogBtn');
    try {
      await navigator.clipboard.writeText(getLogText());
      btn.textContent = 'Copiado ✓';
    } catch {
      btn.textContent = 'Error al copiar';
    }
    setTimeout(() => { btn.textContent = 'Copiar log'; }, 1500);
  });
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); openLog(); }
  });
}

// The speedometer, gear and turn-signal arrows live in the 3D instrument cluster now
// (entities/instrumentCluster.js); this keeps the rest of the HUD current and returns the
// shared blink phase so the cluster's arrows and the car's lamps flash together.
export function updateHudPerFrame() {
  const inZone = inSchoolZone(chassisBody.position.z);
  if (inZone !== shown.zone) { shown.zone = inZone; zoneTagEl.style.display = inZone ? 'block' : 'none'; }

  const blink = Math.floor(performance.now() / 350) % 2 === 0;
  const blinkActive = (controlState.signalLeft || controlState.signalRight) && blink;
  updateIndicatorSound(blinkActive);

  playerMesh.userData.indicators.left.forEach(m => { m.material.emissiveIntensity = controlState.signalLeft && blink ? 1 : 0; });
  playerMesh.userData.indicators.right.forEach(m => { m.material.emissiveIntensity = controlState.signalRight && blink ? 1 : 0; });

  setTimer();
  const warn = gameState.timeLeft <= 15;
  if (warn !== shown.warn) { shown.warn = warn; timerRowEl.classList.toggle('warn', warn); }

  return blink;
}

// `kind` 'good' gives the toast the green accent (used for positive feedback, e.g. tutorial steps).
export function showToast(title, sub, kind) {
  const el = document.createElement('div');
  el.className = kind === 'good' ? 'toast good' : 'toast';
  el.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// End-of-run results: every rule broken this run, its per-instance fine, a subtotal, and a
// grand total — built from gameState.infractionCounts rather than a running score/damage tally.
export function showResults(title = 'RESULTADOS') {
  document.getElementById('resultsTitle').textContent = title;
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
  document.getElementById('resultTime').textContent = formatMMSS(gameState.elapsed);
  document.getElementById('gameOverScreen').style.display = 'flex';
}
