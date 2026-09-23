import { SCENARIOS } from '../config.js';
import { SCENARIO_ICONS } from './scenarioIcons.js';
import { openScenarioConfig, scenarioSummary } from './configDialog.js';

// Screen flow: home -> scenarios -> game. Which screen is showing lives on <body data-screen>,
// which the stylesheet uses to show/hide the menu layers and the input system reads to know
// when the scroll wheel should drive the throttle instead of scrolling a menu.
export function setScreen(name) {
  document.body.dataset.screen = name;
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

// onStart(scenarioId) is called when the player presses JUGAR; the match settings for that
// scenario (duration, traffic, ...) are read from the saved config at that point.
export function initMenu({ onStart }) {
  const gridEl = document.getElementById('scenarioGrid');
  const barEl = document.getElementById('scenarioActionBar');
  const nameEl = document.getElementById('scenarioSelectedName');
  const summaryEl = document.getElementById('scenarioSummary');

  let selectedScenario = null;

  renderScenarioCards(gridEl);
  const refreshSummary = () => { summaryEl.textContent = selectedScenario ? scenarioSummary(selectedScenario) : ''; };

  function selectScenario(id) {
    selectedScenario = id;
    gridEl.querySelectorAll('.scenarioCard').forEach(c => c.classList.toggle('selected', c.dataset.scenario === id));
    nameEl.textContent = SCENARIOS[id].label;
    refreshSummary();
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

  document.getElementById('startBtn').addEventListener('click', () => setScreen('scenarios'));
  document.getElementById('scenarioBackBtn').addEventListener('click', () => setScreen('home'));
  document.getElementById('scenarioConfigBtn').addEventListener('click', () => {
    if (selectedScenario) openScenarioConfig(selectedScenario, refreshSummary);
  });
  document.getElementById('scenarioPlayBtn').addEventListener('click', () => {
    if (selectedScenario) onStart(selectedScenario);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.dataset.screen === 'scenarios') setScreen('home');
  });
}
