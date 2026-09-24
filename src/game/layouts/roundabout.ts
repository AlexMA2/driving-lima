import { buildRoundabout } from '../../world/roundabout';
import { initRoundaboutAi, updateRoundaboutAi } from '../../entities/roundaboutAi';
import { updatePedestrians } from '../../entities/pedestrians';
import { checkRoundaboutRules, resetRoundaboutRules } from '../../systems/roundaboutRules';
import type { LayoutRuntime } from './types';

// "Rotondas": one roundabout with four arms.
export const layout: LayoutRuntime = {
  build: scenario => buildRoundabout(scenario),

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
