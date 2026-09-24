import { goTo, type Screen } from '../app/router';
import { prefetchWhenIdle } from '../app/prefetch';
import { loadScenarios } from '../app/screens';

// The home screen is the one screen whose markup ships in index.html: it is what the player sees first, so it
// is painted from the HTML and the inlined critical CSS before any script has run. This module only brings it
// to life (when it is imported, which is at boot). Leaving the screen takes the element out of the document (it is
// kept, not rebuilt, for the way back).

const element = document.getElementById('startScreen');

// The author's LinkedIn profile, base64-encoded. It is not in index.html and the button is not a link, so a scraper
// reading the page finds no address: it is decoded and opened only on a click. (This keeps bots off; it is not secret.)
const LINKEDIN = 'aHR0cHM6Ly93d3cubGlua2VkaW4uY29tL2luL2FsZXhtYW1hbmkv';

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

  home.querySelector('#linkedinBtn')?.addEventListener('click', () => {
    window.open(atob(LINKEDIN), '_blank', 'noopener,noreferrer');
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
