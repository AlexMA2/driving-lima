import { buildTutorialCourse } from '../../world/tutorialCourse';
import { RB } from '../../world/roundabout';
import { initBreakdowns, updateBreakdowns } from '../../entities/breakdowns';
import { updateScriptedCars } from '../../entities/scriptedCars';
import { updatePedestrians } from '../../entities/pedestrians';
import { checkLaneChangeRule, checkSpeedBumpRule } from '../../systems/rules';
import { checkRoundaboutRules, resetRoundaboutRules } from '../../systems/roundaboutRules';
import { initTutorial, updateTutorial, laneRuleActive } from '../../systems/tutorial';
import type { LayoutRuntime } from './types';

// The guided tutorial course.
export const layout: LayoutRuntime = {
  build: () => buildTutorialCourse(),

  init(_scenario, { endGame }) {
    resetRoundaboutRules();
    initBreakdowns({ hazards: 'off' }); // the course stalls its one car itself, on cue
    initTutorial({ onDone: () => endGame('¡TUTORIAL COMPLETADO!') });
  },

  update(dt) {
    updateScriptedCars(dt);
    updatePedestrians(dt);
    updateBreakdowns();
    updateTutorial(dt);
    if (laneRuleActive()) checkLaneChangeRule();
    checkSpeedBumpRule();
    checkRoundaboutRules();
  },

  // the course also has a roundabout, which the assist keeps out of
  steerAssistZone: (p) => Math.hypot(p.x - RB.cx, p.z - RB.cz) > RB.outerR + 30,
};
