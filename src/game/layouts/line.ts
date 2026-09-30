import { buildRoad, PLAYER_LANES, WORLD_Z_START } from '../../world/road';
import { buildBuildings } from '../../world/buildings';
import { buildIntersections } from '../../world/intersections';
import { updateTrafficLights } from '../../world/trafficLights';
import { buildSchoolZone } from '../../world/schoolZone';
import { buildDecorations } from '../../world/decorations';
import { buildSpeedBumps } from '../../world/speedBumps';
import { buildLineCrosswalks } from '../../world/lineCrosswalks';
import { initAiTraffic, updateAi } from '../../entities/aiTraffic';
import { initBreakdowns, updateBreakdowns } from '../../entities/breakdowns';
import { updatePedestrians } from '../../entities/pedestrians';
import { checkLaneChangeRule, checkRedLightRule, checkSpeedBumpRule, checkWrongWayRule } from '../../systems/rules';
import type { LayoutRuntime } from './types';

// The long avenue scenarios ("Recta Directa", "Autopista Densa"): traffic lights and speed bumps along one road.
export const layout: LayoutRuntime = {
  build(scenario) {
    buildRoad(scenario);
    buildBuildings(scenario);
    buildIntersections();
    buildSchoolZone(scenario.speedLimit);
    buildDecorations();
    buildSpeedBumps();
    buildLineCrosswalks(scenario.zebras);
    initAiTraffic(scenario);
    return { x: PLAYER_LANES[0], y: 1.2, z: WORLD_Z_START - 30, rotY: 0 };
  },

  init(scenario) {
    initBreakdowns(scenario);
  },

  update(dt) {
    updateAi(dt);
    updatePedestrians(dt);
    updateTrafficLights(dt);
    checkLaneChangeRule();
    checkRedLightRule();
    checkSpeedBumpRule();
    checkWrongWayRule();
    updateBreakdowns();
  },

  steerAssistZone: () => true,
};
