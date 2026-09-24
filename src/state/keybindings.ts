// Remappable keyboard controls, persisted in localStorage. Every action can have two keys (a main
// one and an alternative); the game systems ask actionOf(event.key) instead of comparing letters,
// and any on-screen mention of a key goes through kbdHtml()/refreshKbds() so it follows the binding.
// Keys are stored as KeyboardEvent.key lowercased (' ' for the space bar, 'arrowdown', ...).

import { escapeHtml } from '../utils/html';

const KEYS_KEY = 'dls_keybindings_v1';

export type ActionId =
  | 'brake' | 'drive' | 'steerLeft' | 'steerRight' | 'handbrake' | 'horn'
  | 'signalLeft' | 'signalRight' | 'signalOff'
  | 'restart' | 'menu';

export interface KeyAction {
  id: ActionId;
  section: string;
  label: string;
  help?: string;
  defaults: string[];
}

type Bindings = Record<ActionId, string[]>;

export const KEY_ACTIONS: KeyAction[] = [
  { id: 'brake', section: 'Conducción', label: 'Freno / reversa (R)', help: 'Frena mientras lo mantienes. Con el auto casi detenido mete la reversa (R): la rueda del mouse acelera hacia atrás.', defaults: ['s', 'arrowdown'] },
  { id: 'drive', section: 'Conducción', label: 'Avanzar (D)', help: 'Vuelve a la marcha hacia adelante (D) desde la reversa.', defaults: ['w', 'arrowup'] },
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
const NAMES: Record<string, string> = {
  ' ': 'Espacio', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', escape: 'Esc',
  enter: 'Enter', backspace: '⌫', delete: 'Supr', shift: 'Shift', capslock: 'Bloq Mayús',
};

// Never bindable: they'd break the dialog itself or the browser (Tab moves focus, Esc cancels a
// capture, Delete/Backspace clear a slot) or are modifiers that only make sense as part of a combo.
const RESERVED = new Set(['tab', 'escape', 'backspace', 'delete', 'control', 'alt', 'meta', 'shift', 'altgraph', 'dead', 'unidentified']);
export const isBindable = (key: string): boolean => !RESERVED.has(key);

function defaultBindings(): Bindings {
  return Object.fromEntries(KEY_ACTIONS.map(a => [a.id, Array.from({ length: SLOTS }, (_, i) => a.defaults[i] ?? '')])) as Bindings;
}

function load(): Bindings {
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
let lookup = new Map<string, ActionId>();

function rebuildLookup(): void {
  lookup = new Map();
  KEY_ACTIONS.forEach(a => bindings[a.id].forEach(k => { if (k) lookup.set(k, a.id); }));
}
rebuildLookup();

const persist = () => { try { localStorage.setItem(KEYS_KEY, JSON.stringify(bindings)); } catch { /* not persisted */ } };
const clone = (): Bindings => Object.fromEntries(Object.entries(bindings).map(([id, keys]) => [id, [...keys]])) as Bindings;

export const getBindings = clone;

// The action a pressed key is bound to, or undefined.
export const actionOf = (key: string): ActionId | undefined => lookup.get(key.toLowerCase());

export function keyName(key: string): string {
  if (!key) return '—';
  return NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
}

// Every key bound to an action, e.g. "S / ↓" (or "—" when it has none).
export function keyLabels(actionId: ActionId): string {
  const keys = bindings[actionId].filter(Boolean);
  return keys.length ? keys.map(keyName).join(' / ') : '—';
}

// The label of an action's main key, falling back to its alternative.
export function keyLabel(actionId: ActionId): string {
  return keyName(bindings[actionId].find(Boolean) ?? '');
}

// Binds `key` to slot `slot` of `actionId`. A key can only do one thing, so any other slot that
// held it is cleared; returns the action that lost the key (if any) so the UI can say so.
export function setBinding(actionId: ActionId, slot: number, key: string): KeyAction | null {
  let displaced = null as KeyAction | null;
  KEY_ACTIONS.forEach(a => bindings[a.id].forEach((k, i) => {
    if (k === key && !(a.id === actionId && i === slot)) { bindings[a.id][i] = ''; if (a.id !== actionId) displaced = a; }
  }));
  bindings[actionId][slot] = key;
  rebuildLookup(); persist();
  return displaced;
}

export function clearBinding(actionId: ActionId, slot: number): void {
  bindings[actionId][slot] = '';
  rebuildLookup(); persist();
}

export function resetBindings(): void {
  bindings = defaultBindings();
  rebuildLookup(); persist();
}

// ---- on-screen key caps ----

export const kbdHtml = (actionId: ActionId): string => `<kbd data-action="${actionId}">${escapeHtml(keyLabel(actionId))}</kbd>`;

// Re-labels every key cap under `root` with the current binding (for text written before the
// player changed the keys, or static markup in index.html).
export function refreshKbds(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('kbd[data-action]').forEach(el => { el.textContent = keyLabel(el.dataset.action as ActionId); });
}
