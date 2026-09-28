import { buildReverseCourse } from '../../world/reverseCourse';
import { initReverse, updateReverse } from '../../systems/reverse';
import { updateAutoplay, stopAutoplay, toggleAutoplay } from '../../systems/reverseAutopilot';
import type { LayoutRuntime } from './types';

// The straight-then-curved reversing exercise.
export const layout: LayoutRuntime = {
  build: buildReverseCourse,

  init(_scenario, { endGame }) {
    initReverse({ onDone: () => { stopAutoplay(); endGame('¡MANIOBRA COMPLETADA!'); } });
  },

  update(dt) {
    updateReverse(dt);
    updateAutoplay(dt);
  },

  // no straight road to align to, and the player spends the whole exercise in reverse anyway
  steerAssistZone: () => false,

  autopilot: { toggle: toggleAutoplay, stop: stopAutoplay },
};
