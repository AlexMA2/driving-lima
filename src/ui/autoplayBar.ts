import { refreshKbds, type ActionId } from '../state/keybindings';

// The bottom-middle "which keys are pressed" readout shown while the tutorial's AI autopilot
// (systems/tutorialAutopilot.ts) is driving (game/hudTemplate.ts builds the markup, only for the
// tutorial scenario). Only exists in the DOM while a game is on screen, same as the rest of the HUD.

interface Elements {
  hud: HTMLElement;
  kbds: Map<ActionId, HTMLElement[]>;
  accel: HTMLElement | null;
  brake: HTMLElement | null;
}

let els: Elements | null = null;

export function bindAutoplayBar(root: ParentNode): void {
  const hud = root.querySelector<HTMLElement>('#hud');
  const bar = root.querySelector<HTMLElement>('#autoplayBar');
  if (!hud || !bar) { els = null; return; }
  refreshKbds(bar); // the caps read the player's own bindings, same as the tutorial instruction text
  const kbds = new Map<ActionId, HTMLElement[]>();
  bar.querySelectorAll<HTMLElement>('kbd[data-action]').forEach((el) => {
    const id = el.dataset.action as ActionId;
    const list = kbds.get(id) ?? [];
    list.push(el);
    kbds.set(id, list);
  });
  els = { hud, kbds, accel: bar.querySelector('#apAccel'), brake: bar.querySelector('#apBrakePedal') };
}

export function showAutoplayBar(): void {
  els?.hud.classList.add('autopilotOn');
}

export function hideAutoplayBar(): void {
  els?.hud.classList.remove('autopilotOn');
  setAutoplayPressed(new Set(), 0);
}

// `held` are the actions the autopilot currently holds (or just tapped); `throttleDir` is which
// way it is "scrolling" the accelerator right now (1 up, -1 down, 0 neither).
export function setAutoplayPressed(held: ReadonlySet<ActionId>, throttleDir: 1 | 0 | -1): void {
  if (!els) return;
  els.kbds.forEach((list, id) => list.forEach(el => el.classList.toggle('pressed', held.has(id))));
  els.accel?.classList.toggle('pressed', throttleDir === 1);
  els.brake?.classList.toggle('pressed', throttleDir === -1 || held.has('brake'));
}
