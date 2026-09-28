import { refreshKbds } from '../state/keybindings';

// The instruction panel at the top of the screen for the guided scenarios (the tutorial and the
// parking exercises' step guide). It is only put in the page when the scenario has one: the game
// HUD adds `tutorialPanelHtml()` to its markup, then `bindTutorialPanel()` finds the elements. The
// systems that drive it (systems/tutorial.ts, systems/parking.ts) go through the functions below
// and never touch the DOM themselves.

export function tutorialPanelHtml(kind: string): string {
  return `
  <div id="tutorialPanel">
    <div id="tutMeta">
      <span id="tutStepNo"></span><span id="tutKind">${kind}</span>
      <button id="tutCloseBtn" type="button" title="Ocultar la guía">&times;</button>
    </div>
    <h3 id="tutTitle"></h3>
    <p id="tutText"></p>
    <p id="tutHint"></p>
    <div id="tutProgress"><i id="tutProgressFill"></i></div>
  </div>`;
}

interface PanelElements {
  panel: HTMLElement;
  stepNo: HTMLElement;
  title: HTMLElement;
  text: HTMLElement;
  hint: HTMLElement;
  fill: HTMLElement;
}

let els: PanelElements | null = null;

export function bindTutorialPanel(root: ParentNode): void {
  const get = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(`#${id}`);
  const panel = get('tutorialPanel');
  const stepNo = get('tutStepNo'), title = get('tutTitle'), text = get('tutText'), hint = get('tutHint'), fill = get('tutProgressFill');
  els = panel && stepNo && title && text && hint && fill ? { panel, stepNo, title, text, hint, fill } : null;
  get('tutCloseBtn')?.addEventListener('click', () => els?.panel.classList.add('tutorialPanel--closed'));
}

export interface StepView {
  label: string;     // e.g. "PASO 2 / 5"
  title: string;
  html: string;      // the instruction; may contain <b> and key caps (<kbd data-action>)
  progress: number;  // 0..1
}

export function showTutorialStep(view: StepView): void {
  if (!els) return;
  els.stepNo.textContent = view.label;
  els.title.textContent = view.title;
  els.text.innerHTML = view.html;
  refreshKbds(els.text); // key caps follow the player's own bindings
  els.fill.style.width = `${view.progress * 100}%`;
  els.hint.textContent = '';
}

// Only touches the DOM when the text actually changed (this is called every frame).
export function setTutorialHint(text: string): void {
  if (els && els.hint.textContent !== text) els.hint.textContent = text;
}
