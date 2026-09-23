import { CONTROL_FIELDS, getControls, saveControls, resetControls, applyControls } from '../state/settings.js';
import { renderSettingsForm } from './settingsForm.js';

// The global controls dialog behind the gear button in the corner of the menu screens: every
// tunable of the pedals and steering wheel, applied to CONFIG as it's changed and saved.
export function initGlobalConfig() {
  const dialog = document.getElementById('globalConfigDialog');
  const body = document.getElementById('globalConfigBody');
  let values = getControls();
  applyControls(values); // saved tuning takes effect from the first frame

  const render = () => renderSettingsForm(body, CONTROL_FIELDS, values, () => {
    applyControls(values);
    saveControls(values);
  });

  const close = () => dialog.classList.remove('show');
  document.getElementById('globalConfigBtn').addEventListener('click', () => {
    render();
    dialog.classList.add('show');
  });
  document.getElementById('globalConfigReset').addEventListener('click', () => {
    values = resetControls();
    applyControls(values);
    render();
  });
  document.getElementById('globalConfigClose').addEventListener('click', close);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
}
