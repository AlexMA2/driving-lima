import * as THREE from 'three';
import { chassisBody, CAR_HALF_WIDTH } from '../entities/player';
import { COURSE, type Pt } from '../world/reverseCourse';
import { triggerInfraction } from './rules';
import { showToast } from '../game/hud';
import { showTutorialStep, setTutorialHint } from '../ui/tutorialPanel';
import { kbdHtml } from '../state/keybindings';

// The reversing exercise: two legs judged one at a time (see world/reverseCourse.ts for why
// nothing but reverse gear can make progress), then a stop inside the finish box. Touching
// either row of cones on the active leg books an infraction, same idea as systems/parking.ts's
// step list but measuring distance to a line instead of to a kerb or a bay.

const kbd = kbdHtml;

interface Step { id: string; title: string; text: string; hint: () => string; done: () => boolean }

// Projects (x, z) onto segment a->b: how far along it (clamped to the segment, in metres) and
// the signed perpendicular distance from it.
function projectOnSegment(a: Pt, b: Pt, x: number, z: number): { along: number; lateral: number; len: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const raw = (x - a.x) * ux + (z - a.z) * uz;
  const along = THREE.MathUtils.clamp(raw, 0, len);
  const px = a.x + ux * along, pz = a.z + uz * along;
  const nx = -uz, nz = ux;
  const lateral = (x - px) * nx + (z - pz) * nz;
  return { along, lateral, len };
}

let leg: 0 | 1 = 0;
const activeLeg = (): [Pt, Pt] => (leg === 0 ? [COURSE.p0, COURSE.p1] : [COURSE.p1, COURSE.p2]);

const STEPS: Step[] = [
  {
    id: 'straight', title: '1. Retrocede en línea recta',
    text: `Mira por el espejo retrovisor y los espejos laterales, presiona ${kbd('brake')} para meter la reversa <b>R</b> y retrocede despacio (la rueda del mouse ↑ acelera hacia atrás) entre las dos filas de conos, sin tocarlos.`,
    hint: () => {
      const { lateral, along, len } = projectOnSegment(...activeLeg(), chassisBody.position.x, chassisBody.position.z);
      return `Avance: ${Math.round((along / len) * 100)}%   ·   Desvío: ${Math.round(Math.abs(lateral) * 100)} cm`;
    },
    done: () => {
      const { along, len } = projectOnSegment(...activeLeg(), chassisBody.position.x, chassisBody.position.z);
      return along > len - 1.5;
    },
  },
  {
    id: 'curve', title: '2. Retrocede girando',
    text: `El carril tuerce hacia la derecha. Sigue retrocediendo despacio y gira el volante para mantenerte entre los conos hasta el recuadro verde.`,
    hint: () => {
      const { lateral, along, len } = projectOnSegment(...activeLeg(), chassisBody.position.x, chassisBody.position.z);
      return `Avance: ${Math.round((along / len) * 100)}%   ·   Desvío: ${Math.round(Math.abs(lateral) * 100)} cm`;
    },
    done: () => {
      const p = chassisBody.position;
      return Math.abs(p.x - COURSE.p2.x) < COURSE.finishHalf && Math.abs(p.z - COURSE.p2.z) < COURSE.finishHalf;
    },
  },
  {
    id: 'finish', title: '3. Detente dentro del recuadro',
    text: `Quédate detenido unos segundos dentro del recuadro verde para terminar.`,
    hint: () => '',
    done: () => false,
  },
];

let stepIndex = 0;
let stillFor = 0;
let finished = false;
let onComplete: (() => void) | null = null;

// For systems/reverseAutopilot.ts: the id of the step it should be driving for, and the point it
// should be backing toward right now (the end of whichever leg is active).
export function currentReverseStepId(): string | null { return STEPS[stepIndex]?.id ?? null; }
export function currentLegEnd(): Pt { return activeLeg()[1]; }

function showStep(i: number): void {
  stepIndex = i;
  if (i === 1) leg = 1;
  const step = STEPS[i];
  showTutorialStep({ label: `PASO ${i + 1} / ${STEPS.length}`, title: step.title.replace(/^\d+\.\s*/, ''), html: step.text, progress: i / STEPS.length });
}

export function initReverse({ onDone }: { onDone?: () => void } = {}): void {
  onComplete = onDone ?? null;
  finished = false; stillFor = 0; leg = 0;
  showToast('Maniobras en reversa', 'Sigue los conos sin tocarlos, en línea recta y luego en curva.');
  showStep(0);
}

export function updateReverse(dt: number): void {
  if (finished) return;
  const p = chassisBody.position;

  const { lateral } = projectOnSegment(...activeLeg(), p.x, p.z);
  if (Math.abs(lateral) > COURSE.laneHalf - CAR_HALF_WIDTH - 0.05) triggerInfraction('REV_CONE');

  const step = STEPS[stepIndex];
  setTutorialHint(step.hint());
  if (step.done() && stepIndex < STEPS.length - 1) {
    showToast('✓ Bien hecho', step.title.replace(/^\d+\.\s*/, ''), 'good');
    showStep(stepIndex + 1);
  }

  const kmh = chassisBody.velocity.length() * 3.6;
  const inFinishBox = Math.abs(p.x - COURSE.p2.x) < COURSE.finishHalf && Math.abs(p.z - COURSE.p2.z) < COURSE.finishHalf;
  stillFor = stepIndex === STEPS.length - 1 && inFinishBox && kmh < 1.5 ? stillFor + dt : 0;
  if (stillFor > 1.5) {
    finished = true;
    onComplete?.();
  }
}
