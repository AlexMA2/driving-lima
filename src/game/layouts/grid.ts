import { buildGridCity, updateGridAi } from '../../world/gridCity';
import { updateTrafficLights } from '../../world/trafficLights';
import { checkRedLightRule } from '../../systems/rules';
import { updatePedestrians } from '../../entities/pedestrians';
import type { LayoutRuntime } from './types';

// "Ciudad con Giros": a street grid with a traffic light at every crossing.
export const layout: LayoutRuntime = {
  build: buildGridCity,

  init() {},

  update(dt) {
    updateGridAi(dt);
    updatePedestrians(dt);
    updateTrafficLights(dt);
    checkRedLightRule();
  },

  steerAssistZone: () => true,

  intro: { title: 'Ciudad con Giros', text: 'Gira libremente en cada cruce. Respeta los semáforos.' },
};
