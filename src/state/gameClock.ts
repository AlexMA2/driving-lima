// The game's own wall clock, in seconds. Systems that time things in real time (a signal held, a horn, a stop
// that must last a few seconds, the cooldown between fines) read this instead of performance.now(), so the time
// the game spends paused (see game/session.ts) is not counted: coming back from another window must not let a
// "stay stopped for 3 seconds" step complete, or a cooldown lapse, on its own.
let pausedMs = 0;

export function gameNow(): number {
  return (performance.now() - pausedMs) / 1000;
}

export function skipPausedTime(ms: number): void {
  pausedMs += ms;
}
