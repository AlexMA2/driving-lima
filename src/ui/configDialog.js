import { SCENARIOS, PARKING_SIZES } from '../config.js';
import { SCENARIO_FIELDS, getScenarioSettings, saveScenarioSettings, resetScenarioSettings } from '../state/settings.js';
import { renderSettingsForm } from './settingsForm.js';

// The per-scenario settings dialog opened from the scenario menu's CONFIGURAR button:
// match settings (duration, limit, traffic, drivers) for the picked scenario. Controls, keys and
// performance are global and live in the gear dialog (ui/globalConfigDialog.js). Edits are saved
// as they're made, so closing the dialog just hides it.

const dialogEl = () => document.getElementById('configDialog');

// One-line recap of the saved settings, shown next to the play button.
export function scenarioSummary(scenarioId) {
  const scenario = SCENARIOS[scenarioId];
  const s = getScenarioSettings(scenarioId);
  const parts = [];
  if (!scenario.untimed) parts.push(`${Math.round(s.duration / 60)} min`);
  if (!scenario.scripted) parts.push(`tráfico ${s.traffic}%`, `${s.badDrivers}% imprudentes`);
  if (scenario.layout === 'parking') parts.push(`espacio ${PARKING_SIZES[s.parkingSpace].label.toLowerCase()}`, s.parkingGuide ? 'con guía' : 'sin guía');
  return parts.join(' · ');
}

export function openScenarioConfig(scenarioId, onClose) {
  const scenario = SCENARIOS[scenarioId];
  const dialog = dialogEl();
  const body = document.getElementById('configBody');
  document.getElementById('configTitle').textContent = `Configurar: ${scenario.label}`;

  const scenarioFields = SCENARIO_FIELDS.filter(f => !f.show || f.show(scenario));
  let scenarioValues = getScenarioSettings(scenarioId);

  const render = () => renderSettingsForm(body, scenarioFields, scenarioValues, () => saveScenarioSettings(scenarioId, scenarioValues));
  render();

  const close = () => {
    dialog.classList.remove('show');
    dialog.onclick = null;
    onClose?.();
  };
  document.getElementById('configReset').onclick = () => {
    scenarioValues = resetScenarioSettings(scenarioId);
    render();
  };
  document.getElementById('configClose').onclick = close;
  dialog.onclick = (e) => { if (e.target === dialog) close(); };
  dialog.classList.add('show');
}
