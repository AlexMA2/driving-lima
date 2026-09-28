import { CONFIG } from '../../config';
import { buildRoundabout, RB, ARMS } from '../../world/roundabout';
import { barrier } from '../../world/streetKit';
import { initRoundaboutAi, updateRoundaboutAi } from '../../entities/roundaboutAi';
import { updatePedestrians } from '../../entities/pedestrians';
import { checkRoundaboutRules, resetRoundaboutRules } from '../../systems/roundaboutRules';
import type { LayoutRuntime } from './types';

// "Rotondas": one roundabout with four arms.
export const layout: LayoutRuntime = {
  build: scenario => {
    const spawn = buildRoundabout(scenario);
    // Unlike the exam course (which chains the arms into the rest of its fixed circuit), each
    // arm here really does just run out into open ground at its tip — cap them, same convention
    // as every other course (gridCity.ts, tutorialCourse.ts, road.ts, ...).
    const span = scenario.laneCountPerSide * CONFIG.LANE_WIDTH * 2 + 4;
    const tip = RB.outerR + RB.armLength;
    ARMS.forEach(arm => {
      const x = RB.cx + arm.ux * tip, z = RB.cz + arm.uz * tip;
      if (arm.ux === 0) barrier(x, z, span, 2); else barrier(x, z, 2, span);
    });
    return spawn;
  },

  init(scenario) {
    resetRoundaboutRules();
    initRoundaboutAi(scenario); // after the player exists so spawns keep clear of it
  },

  update(dt) {
    updateRoundaboutAi(dt);
    updatePedestrians(dt);
    checkRoundaboutRules();
  },

  // the ring is not a straight road along the world axes
  steerAssistZone: () => false,

  intro: { title: 'Rotondas', text: 'Cede el paso a quien ya circula y señaliza tu salida a la derecha.' },
};
