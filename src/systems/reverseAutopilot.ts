import { chassisBody, carYaw } from '../entities/player';
import { currentReverseStepId, currentLegEnd } from './reverse';
import { AutopilotController } from './autopilotKit';

// The "AI" button for the reversing exercise (world/reverseCourse.ts / systems/reverse.ts): the
// player spends the whole thing backing up (the car starts nose-away, see reverseCourse.ts's own
// comment), so this drives a desired *yaw* rather than the usual steer-toward-a-point pure pursuit.

const ap = new AutopilotController();
export const isAutoplayOn = (): boolean => ap.isOn();
export const stopAutoplay = (): void => ap.stop();
export const toggleAutoplay = (): void => ap.toggle();

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

// While reversing, holding the wheel right always increases yaw and holding it left always
// decreases it, independent of the current heading (a plain fact of the bicycle model: yaw rate
// is proportional to speed times steer angle, and reversing just flips the sign of speed) — the
// same rule systems/parking.ts's own parallel-parking step teaches a human ("gira el volante a la
// derecha... retrocede"). So rather than pure-pursuit toward a point relative to the *nose* (which
// only makes sense for a target roughly ahead of it), this aims for the heading whose *rear* points
// at the target and closes that yaw error with a plain bang-bang controller.
function steerToBacked(targetX: number, targetZ: number): void {
  const p = chassisBody.position;
  const dx = p.x - targetX, dz = p.z - targetZ; // from the target back to the car: where the nose should end up pointing
  const yawDesired = Math.atan2(dx, dz);
  const err = wrap(yawDesired - carYaw());
  ap.setHeld('steerRight', err > 0.05);
  ap.setHeld('steerLeft', err < -0.05);
}

export function updateAutoplay(dt: number): void {
  if (!ap.isOn()) return;
  const stepId = currentReverseStepId();
  if (stepId === 'finish') {
    ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
    ap.driveSpeed(0, dt);
  } else if (stepId) {
    const target = currentLegEnd();
    steerToBacked(target.x, target.z);
    ap.driveSpeed(-3, dt);
  }
  ap.publish();
}
