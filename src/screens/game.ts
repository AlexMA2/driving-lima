import '../styles/game/hud.scss';
import '../styles/game/mirrors.scss';
import '../styles/game/tutorial-panel.scss';
import { SCENARIOS, type ScenarioId } from '../config';
import { getPerformance, resolveScenario } from '../state/settings';
import { loadSession } from '../app/screens';
import { hudHtml, hudOptionsFor } from '../game/hudTemplate';
import type { Screen } from '../app/router';
import type { Session } from '../game/session';

// The driving screen. Its own code is small (the HUD markup and its styles); the game proper, with
// three.js and the physics engine, is fetched in `preload`, while the scenario picker is still on screen, so
// the switch to the game is instant. Leaving a game means reloading the page (see app/autostart.ts), so there
// is nothing to tear down.

let session: Session | null = null;

const nextPaint = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()));

export const screen: Screen<'game'> = {
  async preload({ scenarioId }) {
    if (!(scenarioId in SCENARIOS)) throw new Error(`Unknown scenario "${scenarioId}"`);
    const { prepareSession } = await loadSession();
    session = await prepareSession(resolveScenario(scenarioId as ScenarioId));
  },

  async mount(root, { scenarioId }) {
    if (!session) return;
    const scenario = resolveScenario(scenarioId as ScenarioId);
    const perf = getPerformance();

    const hud = document.createElement('div');
    hud.innerHTML = hudHtml(hudOptionsFor(scenario, perf));
    root.append(session.canvas, hud);

    await nextPaint(); // let the HUD paint before the world is built, which keeps the page busy for a moment
    session.start(hud, perf);
  },

  unmount() {},
};
