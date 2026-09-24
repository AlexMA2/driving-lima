// A ripple that spreads from the point of a click over the button that was pressed. One listener on the document
// covers every button, including the ones dialogs and the HUD create later. The circle lives in a host layer
// clipped to the button's shape, so the button's own overflow (the play button's pulsing ring) is left alone.

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || reducedMotion.matches) return;
  const button = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!button || button.disabled) return;

  const box = button.getBoundingClientRect();
  // a scaled button (the play button grows on hover) measures bigger on screen than in its own coordinates
  const scale = box.width ? button.offsetWidth / box.width : 1;
  const x = (e.clientX - box.left) * scale;
  const y = (e.clientY - box.top) * scale;
  const reach = Math.hypot(Math.max(x, button.offsetWidth - x), Math.max(y, button.offsetHeight - y));

  let host = button.querySelector<HTMLElement>(':scope > .rippleHost');
  if (!host) {
    host = document.createElement('span');
    host.className = 'rippleHost';
    button.append(host);
  }
  const wave = document.createElement('span');
  wave.className = 'ripple';
  wave.style.cssText = `left:${x - reach}px;top:${y - reach}px;width:${reach * 2}px;height:${reach * 2}px`;
  wave.addEventListener('animationend', () => wave.remove(), { once: true });
  host.append(wave);
});
