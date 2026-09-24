import '../styles/components/pause-dialog.scss';
import { openDialog, type DialogHandle } from './dialog';

// Shown over the game while its window is not in use (see game/session.ts). It has no button: the game carries on
// by itself when the window is focused again, so the dialog only closes from code.
let dialog: DialogHandle | null = null;

export function showPauseDialog(): void {
  if (dialog) return;
  dialog = openDialog({
    id: 'pauseDialog',
    dismissable: false,
    html: `
      <div class="pauseIcon" aria-hidden="true"><span></span><span></span></div>
      <h2>Juego en pausa</h2>
      <p>La ventana perdió el foco.</p>
      <p class="pauseHint">Haz clic en esta ventana para volver a jugar.</p>`,
    onClose: () => { dialog = null; },
  });
}

export function hidePauseDialog(): void {
  dialog?.close();
}
