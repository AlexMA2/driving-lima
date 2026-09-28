import { buildExamCourse, COURSE } from '../../world/examCourse';
import { RB } from '../../world/roundabout';
import { checkRoundaboutRules, resetRoundaboutRules } from '../../systems/roundaboutRules';
import { initExamCourse, updateExamCourse } from '../../systems/examCourse';
import type { LayoutRuntime } from './types';

// The "Examen Oficial MTC" circuit: a fixed course, graded like the tutorial but chaining both
// parking styles, a roundabout and a U-turn into one run.
export const layout: LayoutRuntime = {
  build: () => buildExamCourse(),

  init(_scenario, { endGame }) {
    resetRoundaboutRules();
    initExamCourse({ onDone: () => endGame('¡CIRCUITO COMPLETADO!') });
  },

  update(dt) {
    updateExamCourse(dt);
    checkRoundaboutRules();
  },

  // off near the roundabout and both parking bays, on for the connecting straights
  steerAssistZone(p) {
    const nearRing = Math.hypot(p.x - RB.cx, p.z - RB.cz) <= RB.outerR + 30;
    const nearParallel = p.z < COURSE.parallel.rearZ + 10 && p.z > COURSE.parallel.frontZ - 10;
    const nearDiagonal = Math.abs(p.z - COURSE.diagonal.cz) < COURSE.diagonal.pitch + 4;
    return !nearRing && !nearParallel && !nearDiagonal;
  },
};
