// A nudge for a player who is stuck at the start: if the car has not moved 3 seconds into the game, a popover
// bounces above the "?" button telling them the controls are one click away. The markup is in
// game/hudTemplate.ts. It is shown at most once per game, and goes away as soon as the car moves or the
// player opens the controls.

const IDLE_SECONDS = 3;
const MOVING_KMH = 1;

type State = 'waiting' | 'shown' | 'done';

let state: State = 'done';
let idle = 0;
let hint: HTMLElement | null = null;
let hud: HTMLElement | null = null;

export function bindIdleHint(root: ParentNode): void {
  hint = root.querySelector<HTMLElement>('#helpHint');
  hud = root.querySelector<HTMLElement>('#hud');
  idle = 0;
  state = hint ? 'waiting' : 'done';
  root.querySelector('#helpBtn')?.addEventListener('click', () => finish());
}

// Called every frame with the game's own dt (a paused game does not count) and the car's speed.
export function updateIdleHint(dt: number, speedKmh: number): void {
  if (state === 'done') return;
  if (speedKmh > MOVING_KMH) { finish(); return; }
  if (state === 'shown') return;
  idle += dt;
  if (idle >= IDLE_SECONDS) show();
}

function show(): void {
  state = 'shown';
  hint?.classList.add('show');
  hud?.classList.add('hintOn');
}

function finish(): void {
  state = 'done';
  hint?.classList.remove('show');
  hud?.classList.remove('hintOn');
}
