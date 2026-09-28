import { chassisBody, carYaw, forwardSpeed } from '../entities/player';
import { controlState, pressAction, releaseAction, nudgeThrottle, resetHeldInputs } from './input';
import { setInputLocked } from '../state/inputLock';
import { showAutoplayBar, hideAutoplayBar, setAutoplayPressed } from '../ui/autoplayBar';
import type { ActionId } from '../state/keybindings';

// Shared machinery behind the "AI drives it for me" button (game/hudTemplate.ts's #aiBtn) for the
// parking, reverse and exam-circuit scenarios: pressing/holding the same actions a human would
// (systems/input.ts's pressAction/releaseAction/nudgeThrottle), the pure-pursuit steer-toward-a-point
// systems/tutorialAutopilot.ts pioneered, and a per-step scratch slot for one-shot things like "tap
// the signal once". tutorialAutopilot.ts keeps its own older copy of this (it never had to reverse,
// so its driveSpeed only ever deals in speed magnitude); this version's driveSpeed takes a *signed*
// target so the parking/reverse manoeuvres — which spend most of their time backing up — can ask for
// "-3 km/h" and get the brake-then-throttle sequence that actually engages R, the same way a human
// holding the brake at a crawl would (see systems/input.ts's gear comment).
export class AutopilotController {
  private on = false;
  readonly held = new Set<ActionId>();
  throttleDir: 1 | 0 | -1 = 0;
  private throttleTimer = 0;
  private scratchState: object = {};
  private scratchKey: string | null = null;

  isOn(): boolean { return this.on; }

  // Per-step scratch storage, reset the moment `key` (typically the current step's id) changes —
  // the same idea as tutorialAutopilot.ts's `scratch`/`lastStepId`, just reusable across modules.
  scratch<T extends object>(key: string, init: () => T): T {
    if (key !== this.scratchKey) { this.scratchState = init(); this.scratchKey = key; }
    return this.scratchState as T;
  }

  setHeld(action: ActionId, want: boolean): void {
    const has = this.held.has(action);
    if (want && !has) { pressAction(action); this.held.add(action); }
    else if (!want && has) { releaseAction(action); this.held.delete(action); }
  }

  tap(action: ActionId): void { pressAction(action); }

  // Plain pure-pursuit steering: hold left/right depending on which side of the nose (in the car's
  // own frame) the target point falls on.
  steerToward(targetX: number, targetZ: number, dead = 0.5): void {
    const p = chassisBody.position, yaw = carYaw();
    const dx = targetX - p.x, dz = targetZ - p.z;
    const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    this.setHeld('steerLeft', localX < -dead);
    this.setHeld('steerRight', localX > dead);
  }

  private rampThrottle(dir: 1 | 0 | -1, dt: number): void {
    this.throttleTimer -= dt;
    if (dir !== 0 && this.throttleTimer <= 0) { nudgeThrottle(dir); this.throttleTimer = 0.1; }
    this.throttleDir = dir;
  }

  // `targetKmh` is signed: positive drives forward, negative reverses, ~0 brakes to a stop in
  // whichever gear is current. Going from a forward target to a reverse one (or vice-versa) takes
  // a couple of frames, exactly like a real driver: brake to a near-stop first, which is what
  // actually flips the gear (systems/input.ts), then the accelerator can push the new way.
  driveSpeed(targetKmh: number, dt: number): void {
    const signedKmh = forwardSpeed() * 3.6;
    if (targetKmh > 0.05) {
      if (controlState.gear === 'R') this.tap('drive');
      const err = targetKmh - Math.max(0, signedKmh);
      this.setHeld('brake', err < -4);
      this.rampThrottle(err > 1.5 ? 1 : err < -1.5 ? -1 : 0, dt);
    } else if (targetKmh < -0.05) {
      if (controlState.gear !== 'R' || signedKmh > 0.3) { this.setHeld('brake', true); this.rampThrottle(0, dt); return; }
      const back = -signedKmh, wantBack = -targetKmh;
      const err = wantBack - back;
      this.setHeld('brake', err < -4);
      this.rampThrottle(err > 1.5 ? 1 : err < -1.5 ? -1 : 0, dt);
    } else {
      this.setHeld('brake', true);
      this.rampThrottle(0, dt);
    }
  }

  driveToward(targetX: number, targetZ: number, targetKmh: number, dt: number, dead = 0.5): void {
    this.steerToward(targetX, targetZ, dead);
    this.driveSpeed(targetKmh, dt);
  }

  releaseAll(): void {
    this.held.forEach(a => releaseAction(a));
    this.held.clear();
    this.throttleDir = 0;
  }

  start(): void {
    if (this.on) return;
    this.on = true;
    this.scratchKey = null;
    resetHeldInputs(); // no stray real key-hold should fight the autopilot
    setInputLocked(true);
    showAutoplayBar();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.releaseAll();
    setInputLocked(false);
    hideAutoplayBar();
  }

  toggle(): void { this.on ? this.stop() : this.start(); }

  // Refreshes the bottom-middle "which keys are pressed" readout — call once per tick.
  publish(): void { setAutoplayPressed(this.held, this.throttleDir); }
}
