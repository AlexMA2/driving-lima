// Screen flow: home -> scenarios -> game. Only the screen being shown is in the page: going to another one
// unmounts the current screen (taking its markup out of the document) and mounts the next, whose code is
// loaded the first time it is needed. Which screen is showing is also written to <body data-screen>, which
// the input system reads to know when the mouse wheel should drive the throttle instead of scrolling a menu.

export type ScreenName = 'home' | 'scenarios' | 'game';

export interface ScreenParams {
  home: void;
  scenarios: void;
  game: { scenarioId: string };
}

export interface Screen<N extends ScreenName> {
  // Fetches whatever the screen needs before it can show (code, data) while the current screen is still on
  // display, so the switch itself is instant. Errors reject `goTo` and leave the current screen in place.
  preload?(params: ScreenParams[N]): Promise<void>;
  mount(root: HTMLElement, params: ScreenParams[N]): void | Promise<void>;
  unmount(): void;
}

type Loader<N extends ScreenName> = () => Promise<{ screen: Screen<N> }>;

const loaders: { [N in ScreenName]?: Loader<N> } = {};

export function registerScreen<N extends ScreenName>(name: N, loader: Loader<N>): void {
  (loaders as Record<string, unknown>)[name] = loader;
}

// The gear button opens the global settings from the menu screens; it is not part of the game HUD, so it is
// in the page only while a menu screen is.
const MENU_SCREENS: ScreenName[] = ['home', 'scenarios'];
let gearButton: HTMLElement | null = null;

export function setGearButton(el: HTMLElement): void {
  gearButton = el;
}

function syncGearButton(name: ScreenName): void {
  if (!gearButton) return;
  if (MENU_SCREENS.includes(name)) {
    if (!gearButton.isConnected) document.body.append(gearButton);
  } else {
    gearButton.remove();
  }
}

let current: { name: ScreenName; unmount(): void } | null = null;
let navigation = 0; // a newer `goTo` supersedes one still loading

export function goTo(name: 'home' | 'scenarios'): Promise<void>;
export function goTo(name: 'game', params: ScreenParams['game']): Promise<void>;
export async function goTo(name: ScreenName, params?: unknown): Promise<void> {
  const id = ++navigation;
  const loader = loaders[name] as Loader<ScreenName> | undefined;
  if (!loader) throw new Error(`Unknown screen "${name}"`);

  const { screen } = await loader();
  const args = params as ScreenParams[ScreenName];
  await screen.preload?.(args);
  if (id !== navigation) return;

  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app');

  current?.unmount();
  document.body.dataset.screen = name;
  syncGearButton(name);
  current = { name, unmount: () => screen.unmount() };
  await screen.mount(root, args);
  document.documentElement.classList.remove('autostart');
}
