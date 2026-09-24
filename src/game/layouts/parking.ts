import { buildParkingLot } from '../../world/parkingLot';
import { initParking, updateParking } from '../../systems/parking';
import type { LayoutRuntime } from './types';

// The parallel and perpendicular parking exercises.
export const layout: LayoutRuntime = {
  build: buildParkingLot,

  init(scenario, { endGame }) {
    initParking(scenario, { onDone: () => endGame('¡ESTACIONADO!') });
  },

  update(dt) {
    updateParking(dt);
  },

  // no straight roads to align to
  steerAssistZone: () => false,
};
