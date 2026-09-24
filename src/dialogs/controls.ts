import { keyLabels } from '../state/keybindings';
import { escapeHtml } from '../utils/html';
import { openDialog, findDialog, type DialogHandle } from './dialog';

// The controls list, built each time the dialog opens so it shows the player's own keys.
function controlsHelpHtml(): string {
  const rows: Array<[string, string]> = [
    ['Mouse (arrastrar)', 'Girar el volante (dirección hidráulica, se auto-centra al soltar)'],
    [keyLabels('steerLeft'), 'Girar el volante a la izquierda con el teclado'],
    [keyLabels('steerRight'), 'Girar el volante a la derecha con el teclado'],
    ['Rueda del mouse ↑', 'Acelerar (sube la posición del acelerador y se mantiene)'],
    ['Rueda del mouse ↓', 'Desacelerar (baja la posición del acelerador y se mantiene)'],
    [keyLabels('brake'), 'Freno (mantener; casi detenido, sigue presionando para meter reversa, que avanza a paso de tortuga)'],
    [keyLabels('handbrake'), 'Freno de mano'],
    [`${keyLabels('signalLeft')} / ${keyLabels('signalRight')}`, 'Direccionales (izquierda / derecha)'],
    [keyLabels('signalOff'), 'Apagar direccionales'],
    [keyLabels('horn'), 'Bocina'],
    [keyLabels('restart'), 'Reiniciar la partida'],
    [keyLabels('menu'), 'Volver al menú principal'],
    ['CTRL+L', 'Abrir el registro de depuración'],
  ];
  return rows.map(([keys, what]) => `<div><b>${escapeHtml(keys)}</b> — ${what}</div>`).join('');
}

export function openControlsDialog(): DialogHandle {
  const existing = findDialog('instructionsDialog');
  if (existing) return existing;
  const dialog = openDialog({
    id: 'instructionsDialog',
    html: `
      <h2>Controles</h2>
      <div class="rules">${controlsHelpHtml()}</div>
      <button type="button" data-close>Cerrar</button>`,
  });
  dialog.box.querySelector('[data-close]')?.addEventListener('click', dialog.close);
  return dialog;
}
