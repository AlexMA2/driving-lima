import '../styles/components/dialog.scss';

// Dialogs are not part of any page's markup: one is created when it is opened and removed from the
// document when it is closed, so a closed dialog costs nothing. Each dialog module (in this folder) is
// itself loaded on first use.

export interface DialogOptions {
  id: string;        // also the overlay's element id
  boxId?: string;    // id for the dialog box, for styling
  html: string;      // the box's content
  onClose?: () => void;
}

export interface DialogHandle {
  overlay: HTMLElement;
  box: HTMLElement;
  close(): void;
}

const openDialogs = new Set<DialogHandle>();

// The open dialog with this id, if any (dialog modules use it to avoid opening the same dialog twice).
export function findDialog(id: string): DialogHandle | undefined {
  return [...openDialogs].find(d => d.overlay.id === id);
}

export function openDialog({ id, boxId, html, onClose }: DialogOptions): DialogHandle {
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'dialogOverlay';
  overlay.innerHTML = `<div class="dialogBox"${boxId ? ` id="${boxId}"` : ''}>${html}</div>`;
  const box = overlay.firstElementChild as HTMLElement;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || [...openDialogs].pop() !== handle) return;
    e.stopPropagation(); // Esc closes the dialog, it does not also leave the screen behind it
    handle.close();
  };

  const handle: DialogHandle = {
    overlay,
    box,
    close() {
      if (!openDialogs.delete(handle)) return;
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      onClose?.();
    },
  };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) handle.close(); });
  document.addEventListener('keydown', onKeyDown);
  openDialogs.add(handle);
  document.body.append(overlay);
  return handle;
}

export function closeAllDialogs(): void {
  [...openDialogs].forEach(d => d.close());
}
