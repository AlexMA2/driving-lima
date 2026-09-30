import { chassisBody } from '../entities/player';
import { RB, ringInfo } from '../world/roundabout';
import { aiCirclingTowards } from '../entities/roundaboutAi';
import { controlState } from './input';
import { triggerInfraction } from './rules';

// ---- Roundabout (rotonda) rules ----
// Yield when stepping onto the ring while a circling car is about to reach the entry point,
// signal right when leaving it, and never circulate against the flow (clockwise).
let onRing = false;
// Who counts as circling traffic: the roundabout scenario's cars unless a layout brings its own
// (the exam circuit's candidates, entities/examTraffic.ts).
let circlingTowards: (entryTheta: number) => boolean = aiCirclingTowards;

export function resetRoundaboutRules(probe: (entryTheta: number) => boolean = aiCirclingTowards): void {
  onRing = false;
  circlingTowards = probe;
}

export function checkRoundaboutRules(): void {
  const p = chassisBody.position, v = chassisBody.velocity;
  const { r, theta } = ringInfo(p.x, p.z);
  const speedKmh = v.length() * 3.6;
  const inside = r < RB.outerR - 0.3 && r > RB.innerR - 1;

  if (inside !== onRing) {
    if (inside) {
      if (speedKmh > 5 && circlingTowards(theta)) triggerInfraction('RB_YIELD');
    } else if (r >= RB.outerR - 0.3 && speedKmh > 5 && !controlState.signalRight) {
      triggerInfraction('RB_SIGNAL');
    }
    onRing = inside;
  }

  if (inside && speedKmh > 8) {
    const alongFlow = v.x * Math.sin(theta) - v.z * Math.cos(theta); // counter-clockwise tangent
    if (alongFlow < -2) triggerInfraction('M12');
  }
}

