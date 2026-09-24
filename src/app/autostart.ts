// A restart ("R", the results screen's "Reintentar") and "Volver al inicio" reload the page: it is the
// simplest reliable way to reset all of three.js/cannon-es state (nothing in the world builders tracks or
// tears down what a previous game created). This flag carries the chosen scenario across that reload, so a
// restart goes straight back into the game instead of falling back to the home screen.
//
// The same key is read by the tiny inline script in index.html, which hides the home screen while the game
// loads, so keep them in step.
const AUTOSTART_KEY = 'dls_autostart';

// The scenario id a reload asked to start straight away, or null. The flag is consumed.
export function takeAutostart(): string | null {
  try {
    const raw = sessionStorage.getItem(AUTOSTART_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(AUTOSTART_KEY);
    const scenario = JSON.parse(raw).scenario;
    return typeof scenario === 'string' ? scenario : null;
  } catch {
    return null; // storage blocked, or a malformed/stale entry: fall back to the normal home screen
  }
}

export function reloadToHome(): void {
  try { sessionStorage.removeItem(AUTOSTART_KEY); } catch { /* nothing stored */ }
  location.reload();
}

export function reloadAndRestart(scenarioId: string): void {
  try { sessionStorage.setItem(AUTOSTART_KEY, JSON.stringify({ scenario: scenarioId })); } catch { /* the reload just lands on home */ }
  location.reload();
}
