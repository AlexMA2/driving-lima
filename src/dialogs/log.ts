import '../styles/components/log-dialog.scss';
import { getLogText, clearLog } from '../systems/debugLog';
import { openDialog, findDialog, type DialogHandle } from './dialog';

// Debug action log: a copyable dump of every input/rule event, meant to be pasted back for
// diagnosing intermittent bugs (throttle not responding, a lane-change ticket firing while
// signaled, etc.) that are hard to catch live. Opened with the LOG button or Ctrl+L.
export function openLogDialog(): DialogHandle {
  const existing = findDialog('logDialog');
  if (existing) return existing;
  const dialog = openDialog({
    id: 'logDialog',
    boxId: 'logDialogBox',
    html: `
      <h2>Registro de depuración</h2>
      <p id="logHint">Cada acción (acelerador, freno, direccionales, infracciones) queda registrada aquí con marca de tiempo. Copia el texto y pégalo para reportar un error.</p>
      <pre id="logText"></pre>
      <div id="logActions">
        <button type="button" data-act="refresh">Actualizar</button>
        <button type="button" data-act="copy">Copiar log</button>
        <button type="button" data-act="clear">Limpiar</button>
        <button type="button" data-act="close">Cerrar</button>
      </div>`,
  });

  const textEl = dialog.box.querySelector<HTMLElement>('#logText')!;
  const copyBtn = dialog.box.querySelector<HTMLButtonElement>('[data-act="copy"]')!;
  const refresh = (): void => { textEl.textContent = getLogText(); };
  refresh();

  dialog.box.querySelector('[data-act="refresh"]')!.addEventListener('click', refresh);
  dialog.box.querySelector('[data-act="clear"]')!.addEventListener('click', () => { clearLog(); refresh(); });
  dialog.box.querySelector('[data-act="close"]')!.addEventListener('click', dialog.close);
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getLogText());
      copyBtn.textContent = 'Copiado ✓';
    } catch {
      copyBtn.textContent = 'Error al copiar';
    }
    setTimeout(() => { copyBtn.textContent = 'Copiar log'; }, 1500);
  });
  return dialog;
}
