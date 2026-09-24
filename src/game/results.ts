import '../styles/game/results.scss';
import { PENALTIES, type PenaltyCode } from '../config';
import { gameState } from '../state/gameState';
import { reloadAndRestart, reloadToHome } from '../app/autostart';
import { formatMMSS } from '../utils/format';
import { escapeHtml } from '../utils/html';

// End-of-run results: every rule broken this run, its per-instance fine, a subtotal, and a grand total —
// built from gameState.infractionCounts rather than a running score/damage tally. The screen is created
// when the run ends (this module is only loaded then) and covers the game until the page is reloaded by
// one of its two buttons.
export function showResults(scenarioId: string, title = 'RESULTADOS'): void {
  const codes = (Object.keys(gameState.infractionCounts) as PenaltyCode[]).filter(code => (gameState.infractionCounts[code] ?? 0) > 0);
  let total = 0;

  const rows = codes.length === 0
    ? '<div class="resultRow"><span>Sin infracciones — ¡buen manejo!</span><b>S/ 0</b></div>'
    : codes.map(code => {
      const count = gameState.infractionCounts[code] ?? 0;
      const p = PENALTIES[code];
      const subtotal = p.fine * count;
      total += subtotal;
      return `<div class="resultRow"><span>${escapeHtml(p.label)}${count > 1 ? ` &times;${count}` : ''}</span><b>S/ ${subtotal}</b></div>`;
    }).join('');

  const screen = document.createElement('div');
  screen.id = 'gameOverScreen';
  screen.innerHTML = `
    <h1 id="resultsTitle">${escapeHtml(title)}</h1>
    <div class="resultRow"><span>Tiempo Jugado</span><b id="resultTime">${formatMMSS(gameState.elapsed)}</b></div>
    <div id="resultsStats">
      <h3>PAPELETAS EMITIDAS</h3>
      <div id="resultsInfractions">${rows}</div>
      <div id="resultsTotalRow"><span>TOTAL A PAGAR</span><b id="resultTotal">S/ ${total}</b></div>
    </div>
    <div id="resultsActions">
      <button id="homeBtn" type="button">VOLVER AL INICIO</button>
      <button id="restartBtn" type="button">REINTENTAR</button>
    </div>`;

  screen.querySelector('#restartBtn')!.addEventListener('click', () => reloadAndRestart(scenarioId));
  screen.querySelector('#homeBtn')!.addEventListener('click', reloadToHome);
  document.body.append(screen);
}
