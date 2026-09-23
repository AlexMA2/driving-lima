// Renders a list of field descriptors (see state/settings.js) into a form. Three control
// types cover every setting: 'range' (slider + live value), 'toggle' (on/off switch) and
// 'choice' (segmented buttons). The form edits `values` in place and reports each change.

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A field's own `format` returns the complete label; otherwise the raw value plus its unit.
function formatValue(field, value) {
  return field.format ? field.format(value) : `${value}${field.unit ?? ''}`;
}

function controlHtml(field, value) {
  if (field.type === 'range') {
    return `<input type="range" data-key="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}">`;
  }
  if (field.type === 'toggle') {
    return `<button type="button" class="sfSwitch${value ? ' on' : ''}" data-key="${field.key}" role="switch" aria-checked="${!!value}"><span></span></button>`;
  }
  return `<div class="sfChoice" data-key="${field.key}">${field.options.map(o =>
    `<button type="button" class="sfOpt${o.value === value ? ' selected' : ''}" data-value="${esc(o.value)}">${esc(o.label)}</button>`).join('')}</div>`;
}

function rowHtml(field, value) {
  const head = field.type === 'range'
    ? `<div class="sfHead"><span>${esc(field.label)}</span><output data-out="${field.key}">${esc(formatValue(field, value))}</output></div>`
    : `<div class="sfHead"><span>${esc(field.label)}</span></div>`;
  const control = controlHtml(field, value);
  const help = field.help ? `<small>${esc(field.help)}</small>` : '';
  return field.type === 'toggle'
    ? `<div class="sfRow sfInline" data-row="${field.key}"><div class="sfLabel">${head}${help}</div>${control}</div>`
    : `<div class="sfRow" data-row="${field.key}">${head}${control}${help}</div>`;
}

export function renderSettingsForm(container, fields, values, onChange) {
  const sections = [];
  fields.forEach(f => {
    let sec = sections.find(s => s.name === f.section);
    if (!sec) { sec = { name: f.section, fields: [] }; sections.push(sec); }
    sec.fields.push(f);
  });

  container.innerHTML = sections.map(sec => `
    <section class="sfSection"><h3>${esc(sec.name)}</h3>${sec.fields.map(f => rowHtml(f, values[f.key])).join('')}</section>`).join('');

  const fieldOf = (key) => fields.find(f => f.key === key);

  // Fields can be greyed out depending on other values (e.g. shadow quality with shadows off).
  const syncEnabled = () => {
    fields.forEach(f => {
      if (!f.enabledWhen) return;
      container.querySelector(`[data-row="${f.key}"]`)?.classList.toggle('disabled', !f.enabledWhen(values));
    });
  };
  syncEnabled();

  const commit = (key, value) => {
    values[key] = value;
    onChange?.(key, value);
    syncEnabled();
  };

  container.oninput = (e) => {
    const input = e.target.closest('input[type="range"]');
    if (!input) return;
    const field = fieldOf(input.dataset.key);
    const value = parseFloat(input.value);
    container.querySelector(`[data-out="${field.key}"]`).textContent = formatValue(field, value);
    commit(field.key, value);
  };

  container.onclick = (e) => {
    const sw = e.target.closest('.sfSwitch');
    if (sw) {
      const on = !sw.classList.contains('on');
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
      commit(sw.dataset.key, on);
      return;
    }
    const opt = e.target.closest('.sfOpt');
    if (opt) {
      const group = opt.closest('.sfChoice');
      const field = fieldOf(group.dataset.key);
      const chosen = field.options.find(o => String(o.value) === opt.dataset.value);
      group.querySelectorAll('.sfOpt').forEach(b => b.classList.toggle('selected', b === opt));
      commit(field.key, chosen.value);
    }
  };
}
