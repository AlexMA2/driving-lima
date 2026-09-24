import '../styles/components/controls-dialog.scss';
import { actionKeysHtml, fixedKeyCapHtml, mouseHtml } from '../ui/keycap';
import { openDialog, findDialog, type DialogHandle } from './dialog';
import type { ActionId } from '../state/keybindings';

// The controls list, built each time the dialog opens so it shows the player's own keys, drawn as key caps on a
// keyboard-like plate. While it is open, the cap of every key the player presses sinks and lights up.

type Row = [keys: string, what: string];

const keys = (id: ActionId): string => actionKeysHtml(id);
const plus = '<span class="ctrlPlus">+</span>';

function controlsHelpHtml(): string {
  const groups: Array<[title: string, rows: Row[]]> = [
    ['Volante', [
      [mouseHtml('drag'), 'Arrastra el mouse alrededor del volante para girarlo (dirección hidráulica: se auto-centra al soltar)'],
      [keys('steerLeft'), 'Girar el volante a la izquierda con el teclado'],
      [keys('steerRight'), 'Girar el volante a la derecha con el teclado'],
    ]],
    ['Acelerador y frenos', [
      [mouseHtml('up'), 'Rueda del mouse hacia arriba: acelerar (sube la posición del acelerador y se mantiene). En reversa (R), acelera hacia atrás'],
      [mouseHtml('down'), 'Rueda del mouse hacia abajo: desacelerar (baja la posición del acelerador y se mantiene)'],
      [keys('brake'), 'Freno (mantener). Con el auto casi detenido mete la reversa (R)'],
      [keys('drive'), 'Volver a la marcha hacia adelante (D)'],
      [keys('handbrake'), 'Freno de mano'],
    ]],
    ['Luces y bocina', [
      [keys('signalLeft'), 'Direccional izquierda'],
      [keys('signalRight'), 'Direccional derecha'],
      [keys('signalOff'), 'Apagar direccionales'],
      [keys('horn'), 'Bocina'],
    ]],
    ['Partida', [
      [keys('restart'), 'Reiniciar la partida'],
      [keys('menu'), 'Volver al menú principal'],
      [`${fixedKeyCapHtml('Ctrl')}${plus}${fixedKeyCapHtml('L')}`, 'Abrir el registro de depuración'],
    ]],
  ];
  return groups.map(([title, rows]) => `
    <section class="ctrlGroup">
      <h3>${title}</h3>
      ${rows.map(([caps, what]) => `<div class="ctrlRow"><div class="ctrlKeys">${caps}</div><div>${what}</div></div>`).join('')}
    </section>`).join('');
}

// Lights up the caps of the keys held down while the dialog is open. Returns the function that stops it.
function trackPressedKeys(box: HTMLElement): () => void {
  const caps = (key: string): HTMLElement[] =>
    [...box.querySelectorAll<HTMLElement>('.keycap[data-key]')].filter(el => el.dataset.key === key);
  const onDown = (e: KeyboardEvent): void => caps(e.key.toLowerCase()).forEach(el => el.classList.add('pressed'));
  const onUp = (e: KeyboardEvent): void => caps(e.key.toLowerCase()).forEach(el => el.classList.remove('pressed'));
  const clear = (): void => box.querySelectorAll('.keycap.pressed').forEach(el => el.classList.remove('pressed'));
  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', clear); // a keyup can be lost when the window loses the focus
  return () => {
    window.removeEventListener('keydown', onDown);
    window.removeEventListener('keyup', onUp);
    window.removeEventListener('blur', clear);
  };
}

export function openControlsDialog(): DialogHandle {
  const existing = findDialog('instructionsDialog');
  if (existing) return existing;
  let stopTracking = (): void => {};
  const dialog = openDialog({
    id: 'instructionsDialog',
    boxId: 'controlsBox',
    html: `
      <h2>Controles</h2>
      <div class="keyboardPlate">${controlsHelpHtml()}</div>
      <button type="button" data-close>Cerrar</button>`,
    onClose: () => stopTracking(),
  });
  stopTracking = trackPressedKeys(dialog.box);
  dialog.box.querySelector('[data-close]')?.addEventListener('click', dialog.close);
  return dialog;
}
