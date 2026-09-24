import {
  CONTROL_FIELDS, getControls, saveControls, resetControls, applyControls,
  PERFORMANCE_FIELDS, getPerformance, savePerformance, resetPerformance,
} from '../state/settings.js';
import { resetBindings } from '../state/keybindings.js';
import { renderSettingsForm } from './settingsForm.js';
import { renderKeybindings } from './keybindingsForm.js';

// The global settings dialog behind the gear button in the corner of the menu screens. Three tabs,
// all shared by every scenario and saved as they're changed:
//  - Movimiento: the feel of the pedals and steering wheel (applied to CONFIG straight away)
//  - Teclas: the keyboard bindings
//  - Rendimiento: quality options and the FPS counter (read when a game starts)
export function initGlobalConfig() {
  const dialog = document.getElementById('globalConfigDialog');
  const body = document.getElementById('globalConfigBody');
  const hint = document.getElementById('globalConfigHint');
  const tabsEl = document.getElementById('globalConfigTabs');

  let controls = getControls();
  applyControls(controls); // saved tuning takes effect from the first frame
  let perf = getPerformance();
  let keys = null; // the key form's handle, alive only while its tab is showing

  const TABS = [
    {
      id: 'movement', label: 'Movimiento',
      hint: 'Ajusta la sensibilidad del acelerador, los frenos y el volante.',
      render: () => renderSettingsForm(body, CONTROL_FIELDS, controls, () => { applyControls(controls); saveControls(controls); }),
      reset: () => { controls = resetControls(); applyControls(controls); },
    },
    {
      id: 'keys', label: 'Teclas',
      hint: 'Haz clic en una tecla y pulsa la nueva (Esc cancela, Retroceso la borra). Cada acción admite una tecla principal y una alternativa. El volante con el mouse y el acelerador con la rueda no se reasignan.',
      render: () => { keys = renderKeybindings(body); },
      reset: () => resetBindings(),
    },
    {
      id: 'performance', label: 'Rendimiento',
      hint: 'Opciones para ganar FPS en equipos modestos. Se aplican al empezar la siguiente partida.',
      render: () => renderSettingsForm(body, PERFORMANCE_FIELDS, perf, () => savePerformance(perf)),
      reset: () => { perf = resetPerformance(); },
    },
  ];

  let active = TABS[0];

  const render = () => {
    keys?.stop();
    keys = null;
    tabsEl.querySelectorAll('.cfgTab').forEach(t => {
      const on = t.dataset.tab === active.id;
      t.classList.toggle('selected', on);
      t.setAttribute('aria-selected', String(on));
    });
    hint.textContent = active.hint;
    body.scrollTop = 0;
    active.render();
  };

  tabsEl.innerHTML = TABS.map(t => `<button type="button" class="cfgTab" role="tab" data-tab="${t.id}">${t.label}</button>`).join('');
  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.cfgTab');
    if (!tab || tab.dataset.tab === active.id) return;
    active = TABS.find(t => t.id === tab.dataset.tab);
    render();
  });

  const close = () => {
    keys?.stop();
    dialog.classList.remove('show');
  };
  document.getElementById('globalConfigBtn').addEventListener('click', () => {
    render();
    dialog.classList.add('show');
  });
  document.getElementById('globalConfigReset').addEventListener('click', () => {
    active.reset();
    render();
  });
  document.getElementById('globalConfigClose').addEventListener('click', close);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
}
