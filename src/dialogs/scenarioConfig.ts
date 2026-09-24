import '../styles/components/config-dialog.scss';
import { SCENARIOS, type ScenarioId } from '../config';
import { SCENARIO_FIELDS, getScenarioSettings, saveScenarioSettings, resetScenarioSettings } from '../state/settings';
import { renderSettingsForm } from '../ui/settingsForm';
import { escapeHtml } from '../utils/html';
import { openDialog, findDialog, type DialogHandle } from './dialog';

// The per-scenario settings dialog opened from the scenario menu's CONFIGURAR button:
// match settings (duration, limit, traffic, drivers) for the picked scenario. Controls, keys and
// performance are global and live in the gear dialog (dialogs/globalConfig.ts). Edits are saved
// as they're made, so closing the dialog just removes it.
export function openScenarioConfig(scenarioId: ScenarioId, onClose?: () => void): DialogHandle {
  const existing = findDialog('configDialog');
  if (existing) return existing;

  const scenario = SCENARIOS[scenarioId];
  const dialog = openDialog({
    id: 'configDialog',
    boxId: 'configBox',
    html: `
      <h2 id="configTitle">Configurar: ${escapeHtml(scenario.label)}</h2>
      <div id="configBody"></div>
      <div id="configActions">
        <button id="configReset" type="button" class="secondary">Restaurar valores</button>
        <button id="configClose" type="button">Listo</button>
      </div>`,
    onClose,
  });

  const body = dialog.box.querySelector<HTMLElement>('#configBody')!;
  const scenarioFields = SCENARIO_FIELDS.filter(f => !f.show || f.show(scenario));
  let scenarioValues: Record<string, number | string | boolean> = { ...getScenarioSettings(scenarioId) };

  const render = (): void => renderSettingsForm(body, scenarioFields, scenarioValues, () => saveScenarioSettings(scenarioId, scenarioValues));
  render();

  dialog.box.querySelector('#configReset')!.addEventListener('click', () => {
    scenarioValues = { ...resetScenarioSettings(scenarioId) };
    render();
  });
  dialog.box.querySelector('#configClose')!.addEventListener('click', dialog.close);
  return dialog;
}
