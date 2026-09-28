// A reason-counted pause coordinator: several independent parts of the game (a dialog, the window
// losing focus, free cam) can each ask for the game to be paused without knowing about each other —
// the game actually resumes only once every reason has let go. game/session.ts is the only module
// that knows how to mechanically pause/resume (the frame loop, the clock, the audio); it registers
// itself once via registerPauseHandler() and everyone else only calls request/release.

export type PauseReason = 'window' | 'dialog' | 'freeCam';

const counts: Record<PauseReason, number> = { window: 0, dialog: 0, freeCam: 0 };
let handler: ((paused: boolean) => void) | null = null;

function isPaused(): boolean {
  return counts.window > 0 || counts.dialog > 0 || counts.freeCam > 0;
}

export function registerPauseHandler(fn: (paused: boolean) => void): void {
  handler = fn;
}

export function requestPause(reason: PauseReason): void {
  const before = isPaused();
  counts[reason]++;
  if (!before) handler?.(true);
}

export function releasePause(reason: PauseReason): void {
  const before = isPaused();
  counts[reason] = Math.max(0, counts[reason] - 1);
  if (before && !isPaused()) handler?.(false);
}

export function isPausedFor(reason: PauseReason): boolean {
  return counts[reason] > 0;
}

// Called once at the start of a session: a fresh page load (every restart/menu reloads, see
// app/autostart.ts) would already be zeroed, but this keeps the module honest either way.
export function resetPauseReasons(): void {
  (Object.keys(counts) as PauseReason[]).forEach(k => { counts[k] = 0; });
  handler = null;
}
