import '../styles/screens/scenarios.scss';
import { SCENARIOS, PARKING_SIZES, type ScenarioId } from '../config';
import { getScenarioSettings } from '../state/settings';
import { goTo, type Screen } from '../app/router';
import { prefetchWhenIdle } from '../app/prefetch';
import { loadGame, loadSession } from '../app/screens';
import { escapeHtml } from '../utils/html';
import { SCENARIO_ICONS } from '../ui/scenarioIcons';

// The scenario picker. It is built when the player arrives and removed when they leave: nothing of it exists
// on the home screen or in the game. The action bar is only created once a scenario has been picked.

// One-line recap of the saved settings, shown next to the play button.
function scenarioSummary(scenarioId: ScenarioId): string {
  const scenario = SCENARIOS[scenarioId];
  const s = getScenarioSettings(scenarioId);
  const parts: string[] = [];
  if (!scenario.untimed) parts.push(`${Math.round(s.duration / 60)} min`);
  if (!scenario.scripted) parts.push(`tráfico ${s.traffic}%`, `${s.badDrivers}% imprudentes`);
  if (scenario.layout === 'parking') parts.push(`espacio ${PARKING_SIZES[s.parkingSpace].label.toLowerCase()}`, s.parkingGuide ? 'con guía' : 'sin guía');
  return parts.join(' · ');
}

const cardsHtml = (): string => Object.values(SCENARIOS).map(s => `
  <article class="scenarioCard" data-scenario="${s.id}" tabindex="0">
    <div class="scenarioArt">${SCENARIO_ICONS[s.id]}${s.badge ? `<span class="scenarioBadge">${escapeHtml(s.badge)}</span>` : ''}</div>
    <div class="scenarioBody">
      <div class="scenarioTitleRow"><h3>${escapeHtml(s.label)}</h3><span class="difficulty d${s.difficultyLevel}">${escapeHtml(s.difficulty)}</span></div>
      <p>${escapeHtml(s.description)}</p>
    </div>
  </article>`).join('');

const TEMPLATE = `
  <div id="scenarioInner">
    <div id="scenarioHeader">
      <button id="scenarioBackBtn" type="button" class="ghostBtn">&larr; Volver</button>
      <div>
        <h2>Elige tu escenario</h2>
        <p>Cada uno pone a prueba una habilidad distinta.</p>
      </div>
    </div>
    <div id="scenarioGrid">${cardsHtml()}</div>
  </div>`;

const ACTION_BAR = `
  <div id="scenarioActionBar">
    <div id="scenarioSelectedInfo"><span>Escenario seleccionado</span><b id="scenarioSelectedName"></b><small id="scenarioSummary"></small></div>
    <div id="scenarioActions">
      <button id="scenarioConfigBtn" type="button">CONFIGURAR</button>
      <button id="scenarioPlayBtn" type="button">JUGAR</button>
    </div>
  </div>`;

let el: HTMLElement | null = null;
let stopKeys: (() => void) | null = null;

export const screen: Screen<'scenarios'> = {
  mount(root) {
    const section = document.createElement('div');
    section.id = 'scenarioScreen';
    section.innerHTML = TEMPLATE;
    root.append(section);
    el = section;

    const gridEl = section.querySelector<HTMLElement>('#scenarioGrid')!;
    let selected: ScenarioId | null = null;
    let starting = false;
    let warmed = false;
    let bar: HTMLElement | null = null;

    const refreshSummary = (): void => {
      const summary = bar?.querySelector('#scenarioSummary');
      if (summary) summary.textContent = selected ? scenarioSummary(selected) : '';
    };

    function ensureBar(): HTMLElement {
      if (bar) return bar;
      gridEl.insertAdjacentHTML('beforebegin', ACTION_BAR);
      const created = section.querySelector<HTMLElement>('#scenarioActionBar')!;
      bar = created;

      created.querySelector('#scenarioConfigBtn')!.addEventListener('click', () => {
        if (!selected) return;
        void import('../dialogs/scenarioConfig').then(m => m.openScenarioConfig(selected!, refreshSummary));
      });
      created.querySelector('#scenarioPlayBtn')!.addEventListener('click', (e) => {
        if (!selected || starting) return;
        starting = true;
        const play = e.currentTarget as HTMLButtonElement;
        play.disabled = true;
        play.textContent = 'CARGANDO…'; // the game's code is fetched now if it was not already
        goTo('game', { scenarioId: selected }).catch((err: unknown) => {
          console.error('No se pudo iniciar la partida', err);
          starting = false;
          play.disabled = false;
          play.textContent = 'JUGAR';
        });
      });
      return created;
    }

    function select(id: ScenarioId): void {
      selected = id;
      if (!warmed) {
        // A scenario is picked, so PLAY is next: fetch the 3D game now, while the player reads the summary.
        warmed = true;
        prefetchWhenIdle(loadGame);
        prefetchWhenIdle(loadSession);
      }
      gridEl.querySelectorAll<HTMLElement>('.scenarioCard').forEach(c => c.classList.toggle('selected', c.dataset.scenario === id));
      const barEl = ensureBar();
      barEl.querySelector('#scenarioSelectedName')!.textContent = SCENARIOS[id].label;
      refreshSummary();
      barEl.classList.add('show');
    }

    gridEl.addEventListener('click', (e) => {
      const card = (e.target as Element).closest<HTMLElement>('.scenarioCard');
      if (card) select(card.dataset.scenario as ScenarioId);
    });
    gridEl.addEventListener('keydown', (e) => {
      const card = (e.target as Element).closest<HTMLElement>('.scenarioCard');
      if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(card.dataset.scenario as ScenarioId); }
    });
    section.querySelector('#scenarioBackBtn')!.addEventListener('click', () => { void goTo('home'); });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void goTo('home');
    };
    window.addEventListener('keydown', onKeyDown);
    stopKeys = () => window.removeEventListener('keydown', onKeyDown);
  },
  unmount() {
    stopKeys?.();
    stopKeys = null;
    el?.remove();
    el = null;
  },
};
