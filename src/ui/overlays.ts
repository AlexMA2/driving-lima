// Dialogs and the results screen exist in the page only while they are open (see dialogs/dialog.ts and
// screens/results.ts), so "is an overlay showing?" is just "is there one in the DOM?". The driving input
// uses this to let the mouse wheel scroll them instead of working the accelerator.
export function isOverlayOpen(): boolean {
  return document.body.dataset.screen !== 'game' || document.querySelector('.dialogOverlay, #gameOverScreen') !== null;
}
