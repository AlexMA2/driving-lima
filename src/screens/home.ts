import { goTo, type Screen } from '../app/router';
import { prefetchWhenIdle } from '../app/prefetch';
import { loadScenarios } from '../app/screens';

// The home screen is the one screen whose markup ships in index.html: it is what the player sees first, so it
// is painted from the HTML and the inlined critical CSS before any script has run. This module only brings it
// to life (when it is imported, which is at boot). Leaving the screen takes the element out of the document (it is
// kept, not rebuilt, for the way back).

const element = document.getElementById('startScreen');

function wire(home: HTMLElement): void {
  const start = home.querySelector<HTMLElement>('#startBtn');
  start?.addEventListener('click', () => { void goTo('scenarios'); });
  // most players press PLAY next: start fetching the scenario picker as soon as they reach for it
  const warm = (): void => { void loadScenarios(); };
  start?.addEventListener('pointerenter', warm, { once: true });
  start?.addEventListener('focus', warm, { once: true });

  home.querySelector('#controlsBtn')?.addEventListener('click', () => {
    void import('../dialogs/controls').then(m => m.openControlsDialog());
  });
}

if (element) wire(element);

export const screen: Screen<'home'> = {
  mount(root) {
    if (!element) return;
    if (!element.isConnected) root.append(element);
    prefetchWhenIdle(loadScenarios);
  },
  unmount() {
    element?.remove();
  },
};
