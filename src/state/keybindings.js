// Remappable keyboard controls, persisted in localStorage. Every action can have two keys (a main
// one and an alternative); the game systems ask actionOf(event.key) instead of comparing letters,
// and any on-screen mention of a key goes through kbdHtml()/refreshKbds() so it follows the binding.
// Keys are stored as KeyboardEvent.key lowercased (' ' for the space bar, 'arrowdown', ...).

const KEYS_KEY = 'dls_keybindings_v1';

export const KEY_ACTIONS = [
  { id: 'brake', section: 'Conducción', label: 'Freno / reversa', help: 'Mantenlo pisado; casi detenido, sigue presionando para meter la reversa.', defaults: ['s', 'arrowdown'] },
  { id: 'steerLeft', section: 'Conducción', label: 'Girar a la izquierda', defaults: ['a', 'arrowleft'] },
  { id: 'steerRight', section: 'Conducción', label: 'Girar a la derecha', defaults: ['d', 'arrowright'] },
  { id: 'handbrake', section: 'Conducción', label: 'Freno de mano', defaults: [' '] },
  { id: 'horn', section: 'Conducción', label: 'Bocina', defaults: ['h'] },

  { id: 'signalLeft', section: 'Luces', label: 'Direccional izquierda', defaults: ['q'] },
  { id: 'signalRight', section: 'Luces', label: 'Direccional derecha', defaults: ['e'] },
  { id: 'signalOff', section: 'Luces', label: 'Apagar direccionales', defaults: ['l'] },

  { id: 'restart', section: 'Partida', label: 'Reiniciar la partida', defaults: ['r'] },
  { id: 'menu', section: 'Partida', label: 'Volver al menú principal', defaults: ['escape'] },
];

const SLOTS = 2;
const NAMES = {
  ' ': 'Espacio', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', escape: 'Esc',
  enter: 'Enter', backspace: '⌫', delete: 'Supr', shift: 'Shift', capslock: 'Bloq Mayús',
};

// Never bindable: they'd break the dialog itself or the browser (Tab moves focus, Esc cancels a
// capture, Delete/Backspace clear a slot) or are modifiers that only make sense as part of a combo.
const RESERVED = new Set(['tab', 'escape', 'backspace', 'delete', 'control', 'alt', 'meta', 'shift', 'altgraph', 'dead', 'unidentified']);
export const isBindable = (key) => !RESERVED.has(key);

function defaultBindings() {
  return Object.fromEntries(KEY_ACTIONS.map(a => [a.id, Array.from({ length: SLOTS }, (_, i) => a.defaults[i] ?? '')]));
}

function load() {
  const merged = defaultBindings();
  try {
    const saved = JSON.parse(localStorage.getItem(KEYS_KEY) ?? '{}');
    KEY_ACTIONS.forEach(a => {
      if (Array.isArray(saved[a.id])) merged[a.id] = Array.from({ length: SLOTS }, (_, i) => String(saved[a.id][i] ?? ''));
    });
  } catch { /* storage blocked or corrupted — keep the defaults */ }
  return merged;
}

let bindings = load();
let lookup = new Map();

function rebuildLookup() {
  lookup = new Map();
  KEY_ACTIONS.forEach(a => bindings[a.id].forEach(k => { if (k) lookup.set(k, a.id); }));
}
rebuildLookup();

const persist = () => { try { localStorage.setItem(KEYS_KEY, JSON.stringify(bindings)); } catch { /* not persisted */ } };
const clone = () => Object.fromEntries(Object.entries(bindings).map(([id, keys]) => [id, [...keys]]));

export const getBindings = clone;

// The action a pressed key is bound to, or undefined.
export const actionOf = (key) => lookup.get(key.toLowerCase());

export function keyName(key) {
  if (!key) return '—';
  return NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
}

// Every key bound to an action, e.g. "S / ↓" (or "—" when it has none).
export function keyLabels(actionId) {
  const keys = bindings[actionId].filter(Boolean);
  return keys.length ? keys.map(keyName).join(' / ') : '—';
}

// The label of an action's main key, falling back to its alternative.
export function keyLabel(actionId) {
  return keyName(bindings[actionId].find(Boolean) ?? '');
}

// Binds `key` to slot `slot` of `actionId`. A key can only do one thing, so any other slot that
// held it is cleared; returns the action that lost the key (if any) so the UI can say so.
export function setBinding(actionId, slot, key) {
  let displaced = null;
  KEY_ACTIONS.forEach(a => bindings[a.id].forEach((k, i) => {
    if (k === key && !(a.id === actionId && i === slot)) { bindings[a.id][i] = ''; if (a.id !== actionId) displaced = a; }
  }));
  bindings[actionId][slot] = key;
  rebuildLookup(); persist();
  return displaced;
}

export function clearBinding(actionId, slot) {
  bindings[actionId][slot] = '';
  rebuildLookup(); persist();
}

export function resetBindings() {
  bindings = defaultBindings();
  rebuildLookup(); persist();
}

// ---- on-screen key caps ----

export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const kbdHtml = (actionId) => `<kbd data-action="${actionId}">${escapeHtml(keyLabel(actionId))}</kbd>`;

// Re-labels every key cap under `root` with the current binding (for text written before the
// player changed the keys, or static markup in index.html).
export function refreshKbds(root = document) {
  root.querySelectorAll('kbd[data-action]').forEach(el => { el.textContent = keyLabel(el.dataset.action); });
}
