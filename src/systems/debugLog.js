// A rolling, in-memory action log the player can dump (Ctrl+L / the LOG button) to hand back
// for debugging intermittent input/rules bugs that are hard to reproduce on demand. Lines are
// kept terse and grep-friendly (fixed "TAG key=value" shape) since they're meant to be pasted
// straight into an AI conversation, not read as prose.
const MAX_ENTRIES = 2000;
const entries = [];
const t0 = performance.now();

function fmt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}

export function logEvent(tag, data = {}) {
  const t = ((performance.now() - t0) / 1000).toFixed(3);
  const fields = Object.entries(data).map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
  entries.push(`[${t}s] ${tag}${fields ? ' ' + fields : ''}`);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

export function getLogText() {
  return entries.length ? entries.join('\n') : '(sin eventos registrados todavía)';
}

export function clearLog() {
  entries.length = 0;
}
