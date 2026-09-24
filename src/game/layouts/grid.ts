import { buildGridCity, updateGridTrafficLights, updateGridAi, checkGridRedLight } from '../../world/gridCity';
import { updatePedestrians } from '../../entities/pedestrians';
import type { LayoutRuntime } from './types';

// "Ciudad con Giros": a street grid with a traffic light at every crossing.
export const layout: LayoutRuntime = {
  build: buildGridCity,

  init() {},

  update(dt, speedKmh) {
    updateGridAi(dt);
    updatePedestrians(dt);
    updateGridTrafficLights(dt);
    checkGridRedLight(speedKmh);
  },

  steerAssistZone: () => true,

  intro: { title: 'Ciudad con Giros', text: 'Gira libremente en cada cruce. Respeta los semáforos.' },
};
