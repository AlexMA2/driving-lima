import { buildParkingLot } from '../../world/parkingLot';
import { initParking, updateParking } from '../../systems/parking';
import { updateAutoplay, stopAutoplay, toggleAutoplay } from '../../systems/parkingAutopilot';
import type { LayoutRuntime } from './types';

// The parallel, perpendicular and diagonal parking exercises.
export const layout: LayoutRuntime = {
  build: buildParkingLot,

  init(scenario, { endGame }) {
    initParking(scenario, { onDone: () => { stopAutoplay(); endGame('¡ESTACIONADO!'); } });
  },

  update(dt) {
    updateParking(dt);
    updateAutoplay(dt);
  },

  // no straight roads to align to
  steerAssistZone: () => false,

  autopilot: { toggle: toggleAutoplay, stop: stopAutoplay },
};
