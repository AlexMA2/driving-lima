// Warms a lazily loaded chunk while the browser is idle, so the click that needs it finds it already
// downloaded. Skipped when the user asked to save data.
export function prefetchWhenIdle(load: () => Promise<unknown>): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const run = (): void => { load().catch(() => { /* a failed warm-up is retried by the real navigation */ }); };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
