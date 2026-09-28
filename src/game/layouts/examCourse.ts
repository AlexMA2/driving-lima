import { buildExamCourse, COURSE } from '../../world/examCourse';
import { RB } from '../../world/roundabout';
import { checkRoundaboutRules, resetRoundaboutRules } from '../../systems/roundaboutRules';
import { initExamCourse, updateExamCourse } from '../../systems/examCourse';
import { updateAutoplay, stopAutoplay, toggleAutoplay } from '../../systems/examAutopilot';
import type { LayoutRuntime } from './types';

// The "Examen Oficial MTC" circuit: a fixed course, graded like the tutorial but chaining both
// parking styles, a roundabout and a U-turn into one run.
export const layout: LayoutRuntime = {
  build: () => buildExamCourse(),

  init(_scenario, { endGame }) {
    resetRoundaboutRules();
    initExamCourse({ onDone: () => { stopAutoplay(); endGame('¡CIRCUITO COMPLETADO!'); } });
  },

  update(dt) {
    updateExamCourse(dt);
    updateAutoplay(dt);
    checkRoundaboutRules();
  },

  // off near the óvalo, both parking bays and the two curved bends, on for the straight avenues.
  // Radius-based (rather than the single corridor's old Z-band tests) since this loop's legs run
  // along both X and Z — a Z-band alone would also (wrongly) blank the assist out on the right
  // avenue at any z that happens to overlap a bay's z-range on the unrelated left avenue.
  steerAssistZone(p) {
    const zones: Array<{ x: number; z: number; r: number }> = [
      { x: RB.cx, z: RB.cz, r: RB.outerR + 30 },
      { x: COURSE.parkAveX, z: (COURSE.parallel.frontZ + COURSE.parallel.rearZ) / 2, r: 12 },
      { x: COURSE.parkAveX, z: COURSE.diagonal.cz, r: COURSE.diagonal.pitch + 6 },
      { x: COURSE.trocha.cx, z: COURSE.trocha.cz, r: COURSE.trocha.r + 10 },
      { x: COURSE.swBend.cx, z: COURSE.swBend.cz, r: COURSE.swBend.r + 10 },
      { x: COURSE.jogIn.cx, z: COURSE.jogIn.cz, r: COURSE.jogIn.r + 8 },
      { x: COURSE.jogOut.cx, z: COURSE.jogOut.cz, r: COURSE.jogOut.r + 8 },
    ];
    return !zones.some(z => Math.hypot(p.x - z.x, p.z - z.z) <= z.r);
  },

  autopilot: { toggle: toggleAutoplay, stop: stopAutoplay },
};
