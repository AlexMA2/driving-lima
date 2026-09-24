import '../styles/components/keycap.scss';
import { getBindings, keyName, type ActionId } from '../state/keybindings';
import { escapeHtml } from '../utils/html';

// Keyboard key caps and the mouse, drawn as the real thing. `data-key` carries the key as KeyboardEvent.key
// lowercased, so a dialog can light up the cap of a key while it is held down.

// A cap for a key as the bindings store it (' ' is the space bar).
export function keyCapHtml(key: string): string {
  if (!key) return '<span class="keycap keycap--none" title="Sin asignar">—</span>';
  const label = keyName(key);
  const size = key === ' ' ? ' keycap--space' : label.length > 1 ? ' keycap--wide' : '';
  return `<span class="keycap${size}" data-key="${escapeHtml(key)}">${escapeHtml(label)}</span>`;
}

// A cap for a key that cannot be remapped (Ctrl, L in "Ctrl + L").
export function fixedKeyCapHtml(label: string, key = label.toLowerCase()): string {
  return `<span class="keycap${label.length > 1 ? ' keycap--wide' : ''}" data-key="${escapeHtml(key)}">${escapeHtml(label)}</span>`;
}

// Every key bound to an action, as caps ("S o ↓"), or one empty cap when it has none.
export function actionKeysHtml(actionId: ActionId): string {
  const keys = getBindings()[actionId].filter(Boolean);
  if (!keys.length) return keyCapHtml('');
  return keys.map(keyCapHtml).join('<span class="keyOr">o</span>');
}

// The mouse with the part in use lit: the left button for dragging, the wheel for scrolling up or down.
export function mouseHtml(use: 'drag' | 'up' | 'down'): string {
  const lit = 'fill="currentColor"';
  const arrow = use === 'up'
    ? '<path d="M16 1 21 6H11Z" fill="currentColor"/>'
    : use === 'down'
      ? '<path d="M16 47 21 42H11Z" fill="currentColor"/>'
      : '';
  return `<svg class="mouseIcon" viewBox="0 0 32 48" aria-hidden="true">
    <rect x="4" y="6" width="24" height="36" rx="12" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M4 22h24M16 6v16" stroke="currentColor" stroke-width="2"/>
    ${use === 'drag' ? `<path d="M5 22V18A11 11 0 0 1 16 7v15Z" ${lit} opacity="0.85"/>` : `<rect x="14" y="10" width="4" height="9" rx="2" ${lit}/>`}
    ${arrow}
  </svg>`;
}
