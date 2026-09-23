import { CONFIG, SCENARIOS } from '../config.js';
import { SCENARIO_ICONS } from './scenarioIcons.js';

// Screen flow: home -> scenarios -> game. Which screen is showing lives on <body data-screen>,
// which the stylesheet uses to show/hide the menu layers and the input system reads to know
// when the scroll wheel should drive the throttle instead of scrolling a menu.
export function setScreen(name) {
  document.body.dataset.screen = name;
}

function formatDuration(seconds) {
  return `${Math.round(seconds / 60)} min`;
}

function renderScenarioCards(gridEl) {
  gridEl.innerHTML = Object.values(SCENARIOS).map(s => `
    <article class="scenarioCard" data-scenario="${s.id}" tabindex="0">
      <div class="scenarioArt">${SCENARIO_ICONS[s.id] ?? ''}</div>
      <div class="scenarioBody">
        <div class="scenarioTitleRow"><h3>${s.label}</h3><span class="difficulty d${s.difficultyLevel}">${s.difficulty}</span></div>
        <p>${s.description}</p>
      </div>
    </article>`).join('');
}

function renderDurationOptions(containerEl, selectedSeconds) {
  containerEl.innerHTML = CONFIG.GAME_DURATION_OPTIONS.map(sec =>
    `<button type="button" class="durationOpt${sec === selectedSeconds ? ' selected' : ''}" data-seconds="${sec}">${formatDuration(sec)}</button>`
  ).join('');
}

// onStart(scenarioId, durationSeconds) is called when the player presses JUGAR.
export function initMenu({ onStart }) {
  const gridEl = document.getElementById('scenarioGrid');
  const barEl = document.getElementById('scenarioActionBar');
  const nameEl = document.getElementById('scenarioSelectedName');
  const durationEl = document.getElementById('durationOptions');

  let selectedScenario = null;
  let selectedDuration = CONFIG.DEFAULT_GAME_DURATION;

  renderScenarioCards(gridEl);
  renderDurationOptions(durationEl, selectedDuration);

  function selectScenario(id) {
    selectedScenario = id;
    gridEl.querySelectorAll('.scenarioCard').forEach(c => c.classList.toggle('selected', c.dataset.scenario === id));
    nameEl.textContent = SCENARIOS[id].label;
    barEl.classList.add('show');
  }

  gridEl.addEventListener('click', (e) => {
    const card = e.target.closest('.scenarioCard');
    if (card) selectScenario(card.dataset.scenario);
  });
  gridEl.addEventListener('keydown', (e) => {
    const card = e.target.closest('.scenarioCard');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectScenario(card.dataset.scenario); }
  });

  durationEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.durationOpt');
    if (!btn) return;
    selectedDuration = parseInt(btn.dataset.seconds, 10);
    renderDurationOptions(durationEl, selectedDuration);
  });

  document.getElementById('startBtn').addEventListener('click', () => setScreen('scenarios'));
  document.getElementById('scenarioBackBtn').addEventListener('click', () => setScreen('home'));
  document.getElementById('scenarioPlayBtn').addEventListener('click', () => {
    if (selectedScenario) onStart(selectedScenario, selectedDuration);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.dataset.screen === 'scenarios') setScreen('home');
  });
}
