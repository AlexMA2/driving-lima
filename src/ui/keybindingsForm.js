import {
  KEY_ACTIONS, getBindings, setBinding, clearBinding, keyName, isBindable,
} from '../state/keybindings.js';

// The "Teclas" tab: every action with its main and alternative key. Clicking a key slot puts it
// in listening mode; the next key pressed becomes the binding (Esc cancels, Backspace/Delete
// empties the slot). Returns { stop } so the dialog can drop a pending capture when it closes or
// switches tab.

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SLOT_TITLES = ['Tecla principal', 'Tecla alternativa'];

export function renderKeybindings(container) {
  let capture = null; // { actionId, slot }
  let note = '';

  const sections = [];
  KEY_ACTIONS.forEach(a => {
    let sec = sections.find(s => s.name === a.section);
    if (!sec) { sec = { name: a.section, actions: [] }; sections.push(sec); }
    sec.actions.push(a);
  });

  const slotHtml = (a, slot, key) => {
    const listening = capture && capture.actionId === a.id && capture.slot === slot;
    const cls = `keySlot${listening ? ' listening' : ''}${key ? '' : ' empty'}`;
    return `<button type="button" class="${cls}" data-action="${a.id}" data-slot="${slot}" title="${SLOT_TITLES[slot]}">${listening ? 'Pulsa una tecla…' : esc(keyName(key))}</button>`;
  };

  const render = () => {
    const bindings = getBindings();
    container.innerHTML = `${note ? `<p class="keyNote">${esc(note)}</p>` : ''}${sections.map(sec => `
      <section class="sfSection"><h3>${esc(sec.name)}</h3>${sec.actions.map(a => `
        <div class="sfRow keyRow">
          <div class="sfLabel"><div class="sfHead"><span>${esc(a.label)}</span></div>${a.help ? `<small>${esc(a.help)}</small>` : ''}</div>
          <div class="keySlots">${bindings[a.id].map((k, i) => slotHtml(a, i, k)).join('')}</div>
        </div>`).join('')}
      </section>`).join('')}`;
  };

  const onKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation(); // nothing else (menu Esc, game shortcuts) may react while a key is being chosen
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    const { actionId, slot } = capture;

    if (key === 'escape') { stop(); return; }
    if (key === 'backspace' || key === 'delete') { clearBinding(actionId, slot); note = ''; stop(); return; }
    if (!isBindable(key) || e.ctrlKey || e.metaKey || e.altKey) return; // a lone modifier or a chord: keep listening

    const displaced = setBinding(actionId, slot, key);
    note = displaced ? `«${keyName(key)}» ya estaba en «${displaced.label}»; se la quité.` : '';
    stop();
  };

  function stop() {
    if (capture) window.removeEventListener('keydown', onKeyDown, true);
    capture = null;
    render();
  }

  function start(actionId, slot) {
    if (capture) window.removeEventListener('keydown', onKeyDown, true);
    capture = { actionId, slot };
    note = '';
    render();
    window.addEventListener('keydown', onKeyDown, true); // capture phase: runs before every other key handler
  }

  container.oninput = null;
  container.onclick = (e) => {
    const btn = e.target.closest('.keySlot');
    if (!btn) { if (capture) stop(); return; } // clicking anywhere else cancels
    const { action, slot } = btn.dataset;
    if (capture && capture.actionId === action && capture.slot === Number(slot)) stop();
    else start(action, Number(slot));
  };

  render();
  return { stop: () => { if (capture) stop(); }, refresh: () => { note = ''; render(); } };
}
