import '../styles/components/config-dialog.scss';
import {
  CONTROL_FIELDS, getControls, saveControls, resetControls, applyControls,
  PERFORMANCE_FIELDS, getPerformance, savePerformance, resetPerformance,
  type SettingValues,
} from '../state/settings';
import { resetBindings } from '../state/keybindings';
import { renderSettingsForm } from '../ui/settingsForm';
import { renderKeybindings, type KeybindingsForm } from '../ui/keybindingsForm';
import { escapeHtml } from '../utils/html';
import { openDialog, findDialog, type DialogHandle } from './dialog';

// The global settings dialog behind the gear button in the corner of the menu screens. Three tabs,
// all shared by every scenario and saved as they're changed:
//  - Movimiento: the feel of the pedals and steering wheel (applied to CONFIG straight away)
//  - Teclas: the keyboard bindings
//  - Rendimiento: quality options and the FPS counter (read when a game starts)

interface Tab {
  id: string;
  label: string;
  hint: string;
  render(body: HTMLElement): void;
  reset(): void;
}

export function openGlobalConfig(): DialogHandle {
  const existing = findDialog('globalConfigDialog');
  if (existing) return existing;

  let controls: SettingValues = getControls();
  let perf: SettingValues = { ...getPerformance() };
  let keys: KeybindingsForm | null = null; // the key form's handle, alive only while its tab is showing

  const TABS: Tab[] = [
    {
      id: 'movement', label: 'Movimiento',
      hint: 'Ajusta la sensibilidad del acelerador, los frenos y el volante.',
      render: body => renderSettingsForm(body, CONTROL_FIELDS, controls, () => { applyControls(controls); saveControls(controls); }),
      reset: () => { controls = resetControls(); applyControls(controls); },
    },
    {
      id: 'keys', label: 'Teclas',
      hint: 'Haz clic en una tecla y pulsa la nueva (Esc cancela, Retroceso la borra). Cada acción admite una tecla principal y una alternativa. El volante con el mouse y el acelerador con la rueda no se reasignan.',
      render: body => { keys = renderKeybindings(body); },
      reset: () => resetBindings(),
    },
    {
      id: 'performance', label: 'Rendimiento',
      hint: 'Opciones para ganar FPS en equipos modestos. Se aplican al empezar la siguiente partida.',
      render: body => renderSettingsForm(body, PERFORMANCE_FIELDS, perf, () => savePerformance(perf)),
      reset: () => { perf = { ...resetPerformance() }; },
    },
  ];

  let active = TABS[0];

  const dialog = openDialog({
    id: 'globalConfigDialog',
    boxId: 'globalConfigBox',
    html: `
      <h2>Configuración</h2>
      <div id="globalConfigTabs" role="tablist">${TABS.map(t =>
        `<button type="button" class="cfgTab" role="tab" data-tab="${t.id}">${escapeHtml(t.label)}</button>`).join('')}</div>
      <p id="globalConfigHint"></p>
      <div id="globalConfigBody"></div>
      <div id="configActions">
        <button id="globalConfigReset" type="button" class="secondary" title="Restaura solo la pestaña que estás viendo">Restaurar pestaña</button>
        <button id="globalConfigClose" type="button">Listo</button>
      </div>`,
    onClose: () => keys?.stop(),
  });

  const body = dialog.box.querySelector<HTMLElement>('#globalConfigBody')!;
  const hint = dialog.box.querySelector<HTMLElement>('#globalConfigHint')!;
  const tabsEl = dialog.box.querySelector<HTMLElement>('#globalConfigTabs')!;

  const render = (): void => {
    keys?.stop();
    keys = null;
    tabsEl.querySelectorAll<HTMLElement>('.cfgTab').forEach(t => {
      const on = t.dataset.tab === active.id;
      t.classList.toggle('selected', on);
      t.setAttribute('aria-selected', String(on));
    });
    hint.textContent = active.hint;
    body.scrollTop = 0;
    active.render(body);
  };

  tabsEl.addEventListener('click', (e) => {
    const tab = (e.target as Element).closest<HTMLElement>('.cfgTab');
    if (!tab || tab.dataset.tab === active.id) return;
    active = TABS.find(t => t.id === tab.dataset.tab) ?? active;
    render();
  });
  dialog.box.querySelector('#globalConfigReset')!.addEventListener('click', () => {
    active.reset();
    render();
  });
  dialog.box.querySelector('#globalConfigClose')!.addEventListener('click', dialog.close);

  render();
  return dialog;
}
