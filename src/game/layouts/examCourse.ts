import { buildExamCourse, COURSE } from '../../world/examCourse';
import { resetExamRoutes, type ExamRouteId } from '../../world/examRoutes';
import { updateTrafficLights } from '../../world/trafficLights';
import { RB } from '../../world/roundabout';
import { initExamTraffic, updateExamTraffic, ringBusyAt } from '../../entities/examTraffic';
import { checkRoundaboutRules, resetRoundaboutRules } from '../../systems/roundaboutRules';
import { checkRedLightRule } from '../../systems/rules';
import { initExamCourse, updateExamCourse } from '../../systems/examCourse';
import { updateAutoplay, stopAutoplay, toggleAutoplay, setAutoplayRoute } from '../../systems/examAutopilot';
import type { LayoutRuntime } from './types';

// The "Examen Oficial MTC" circuit: a fixed course, graded like the tutorial but chaining both
// parking styles and two passes through the óvalo into one run, on Ruta A or Ruta B drawn at
// random (world/examRoutes.ts) — with other candidates driving the course around the player.
let route: ExamRouteId = 'A';

export const layout: LayoutRuntime = {
  build() {
    route = Math.random() < 0.5 ? 'A' : 'B';
    const spawn = buildExamCourse(route);
    resetExamRoutes();
    return spawn;
  },

  init(_scenario, { endGame }) {
    resetRoundaboutRules(theta => ringBusyAt(theta, undefined, false));
    setAutoplayRoute(route);
    initExamTraffic();
    initExamCourse({ route, onDone: () => { stopAutoplay(); endGame('¡CIRCUITO COMPLETADO!'); } });
  },

  update(dt) {
    updateTrafficLights(dt);
    updateExamTraffic(dt);
    updateExamCourse(dt);
    updateAutoplay(dt);
    checkRedLightRule();
    checkRoundaboutRules();
  },

  // off near the óvalo, both corners, every junction and both parking rows; on for the straights
  steerAssistZone(p) {
    const { ne, sw } = COURSE.bends;
    const { XI, XS, XE, ZT, ZP, ZB } = COURSE.roads;
    const zones: Array<{ x: number; z: number; r: number }> = [
      { x: RB.cx, z: RB.cz, r: RB.outerR + 12 },
      { x: ne.cx, z: ne.cz, r: ne.r + 8 },
      { x: sw.cx, z: sw.cz, r: sw.r + 8 },
      { x: (COURSE.parallel.x0 + COURSE.parallel.x1) / 2, z: COURSE.parallel.kerbZ + 4, r: 26 },
      { x: (COURSE.diagonal.x0 + COURSE.diagonal.x1) / 2, z: COURSE.diagonal.cz, r: 20 },
      ...[[XI, ZT], [XI, ZP], [XI, ZB], [XS, ZB], [XE, ZP], [XE, ZB]].map(([x, z]) => ({ x, z, r: 12 })),
    ];
    return !zones.some(z => Math.hypot(p.x - z.x, p.z - z.z) <= z.r);
  },

  autopilot: { toggle: toggleAutoplay, stop: stopAutoplay },
};
