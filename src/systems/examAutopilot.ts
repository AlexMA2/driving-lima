import { chassisBody, carYaw, forwardSpeed, CAR_HALF_LENGTH, CAR_HALF_WIDTH } from '../entities/player';
import { CONFIG } from '../config';
import { COURSE } from '../world/examCourse';
import { currentExamStepId } from './examCourse';
import { getRoute, sampleRoute } from '../world/roundabout';
import { arcPoints, buildPathFromPoints, type Path } from '../world/curves';
import { AutopilotController } from './autopilotKit';

// The "AI" button for the Examen Oficial MTC circuit (world/examCourse.ts / systems/examCourse.ts):
// chains the same manoeuvres systems/parkingAutopilot.ts and systems/tutorialAutopilot.ts already
// know how to drive — a parallel bay, a roundabout, a diagonal bay, a couple of U-turns, and now
// two curved bends (Trocha, the SW corner) — but each parking bay here is graded as a single step
// (systems/examCourse.ts has no per-sub-step id to switch on the way systems/parking.ts does), so
// those two manoeuvres run their own little phase machine inline instead of following an
// externally-advancing step list.

const ap = new AutopilotController();
export const isAutoplayOn = (): boolean => ap.isOn();
export const stopAutoplay = (): void => ap.stop();
export const toggleAutoplay = (): void => ap.toggle();

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const toRad = (deg: number): number => (deg * Math.PI) / 180;

interface Ctx { x: number; z: number; yaw: number; kmh: number }
function ctxNow(): Ctx {
  const p = chassisBody.position;
  return { x: p.x, z: p.z, yaw: carYaw(), kmh: Math.abs(forwardSpeed() * 3.6) };
}

function nearestArcLength(path: Path, x: number, z: number): number {
  let bestS = 0, bestD = Infinity;
  for (let i = 0; i < path.pts.length; i++) {
    const d = (path.pts[i].x - x) ** 2 + (path.pts[i].z - z) ** 2;
    if (d < bestD) { bestD = d; bestS = path.cum[i]; }
  }
  return bestS;
}

// ---- the left avenue's own baseline heading is south (yaw PI), with its kerb on the -X side —
// the mirror image of the original single-corridor course's north/+X convention. xm/zm/thetaLocal
// re-express world coordinates in that original convention (verified algebraically to produce the
// exact same inSlot/gapOk tests systems/examCourse.ts's direct grading code uses) so the rest of
// this phase machine can stay a straight port of systems/parkingAutopilot.ts's own parallel-bay
// logic instead of being re-derived sign by sign.
const xm = (x: number): number => COURSE.leftAveX - x; // self-inverse (a reflection)
const zm = (z: number): number => -z; // self-inverse
const thetaLocal = (yaw: number): number => wrap(yaw - Math.PI);

// ---- the two parking bays: the same 3-phase reverse manoeuvre / straight-in-then-settle
// systems/parkingAutopilot.ts drives, just against COURSE's own geometry instead of PARKING's.

function examParallelParked(ctx: Ctx): boolean {
  const { frontZ, rearZ } = COURSE.parallel;
  const lz = zm(ctx.z), lx = xm(ctx.x), lyaw = thetaLocal(ctx.yaw);
  const localFrontZ = zm(rearZ), localRearZ = zm(frontZ); // roles swap under zm — see the comment above xm/zm
  const inSlot = lz < localRearZ && lz > localFrontZ && lx > 0.8 && lx < CONFIG.LANE_WIDTH;
  const angleOk = Math.abs(lyaw) < toRad(10);
  const gapOk = CONFIG.LANE_WIDTH - (lx + CAR_HALF_WIDTH) < 0.7;
  return inSlot && angleOk && gapOk && ctx.kmh < 1.5;
}

function tickParallelBay(ctx: Ctx, dt: number): void {
  const { frontZ, rearZ } = COURSE.parallel;
  const localFrontZ = zm(rearZ), localRearZ = zm(frontZ);
  const frontCarSideX = CONFIG.LANE_WIDTH - 0.3 - 2 * CAR_HALF_WIDTH;
  const s = ap.scratch('exam-parallel', () => ({ phase: 'align', signaled: false }));

  if (examParallelParked(ctx)) { s.phase = 'settle'; }

  const lz = zm(ctx.z), lyaw = thetaLocal(ctx.yaw);

  switch (s.phase) {
    case 'align': {
      const targetXLocal = frontCarSideX - 0.8 - CAR_HALF_WIDTH;
      const targetZLocal = localFrontZ - CAR_HALF_LENGTH;
      ap.driveToward(xm(targetXLocal), zm(targetZLocal), lz - targetZLocal > 8 ? 8 : 1.5, dt);
      if (Math.abs(lz - targetZLocal) < 0.9 && ctx.kmh < 2) s.phase = 'reverse';
      break;
    }
    case 'reverse':
      if (!s.signaled) { ap.tap('signalRight'); s.signaled = true; }
      ap.setHeld('steerRight', true); ap.setHeld('steerLeft', false);
      ap.driveSpeed(-3, dt);
      if (lyaw > 0.7) s.phase = 'straight';
      break;
    case 'straight': {
      ap.setHeld('steerRight', false); ap.setHeld('steerLeft', false);
      ap.driveSpeed(-3, dt);
      // the front corner clearing the framing car's rear bumper, same test as PARALLEL_STEPS's own
      const frZlocal = lz - CAR_HALF_LENGTH * Math.cos(lyaw) - CAR_HALF_WIDTH * Math.sin(lyaw);
      if (frZlocal > localFrontZ + 0.4) s.phase = 'left';
      break;
    }
    case 'left':
      ap.setHeld('steerLeft', true); ap.setHeld('steerRight', false);
      ap.driveSpeed(-2.5, dt);
      if (Math.abs(lyaw) < 0.14) s.phase = 'settle';
      break;
    case 'settle': {
      ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
      if (examParallelParked(ctx)) { ap.driveSpeed(0, dt); break; }
      const errZlocal = lz - (localFrontZ + localRearZ) / 2;
      ap.driveSpeed(Math.abs(errZlocal) > 0.3 ? Math.max(-2, Math.min(2, errZlocal * 1.2)) : 0, dt);
      break;
    }
  }
}

function examDiagonalParked(ctx: Ctx): boolean {
  const { cz, angle, pitch } = COURSE.diagonal;
  const diagYaw = Math.PI + angle; // see world/examCourse.ts's comment on diagYaw — this lane's baseline is south, not the original corridor's north
  const c = Math.cos(diagYaw), sn = Math.sin(diagYaw);
  const dx = ctx.x - (COURSE.leftKerb + 1.0), dz = ctx.z - cz;
  const u = dx * c - dz * sn, v = dx * sn + dz * c;
  const inside = Math.abs(u) <= 1.6 && Math.abs(v) <= pitch / 2 - 0.3;
  const angleOk = Math.abs(wrap(ctx.yaw - diagYaw)) < toRad(10);
  return inside && angleOk && ctx.kmh < 1.5;
}

function tickDiagonalBay(ctx: Ctx, dt: number): void {
  const { cz, pitch } = COURSE.diagonal;
  const diagCx = COURSE.leftKerb + 1.0;
  const s = ap.scratch('exam-diagonal', () => ({ signaled: false }));
  if (!s.signaled) { ap.tap('signalRight'); s.signaled = true; }

  if (examDiagonalParked(ctx)) {
    ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
    ap.driveSpeed(0, dt);
  } else {
    ap.driveToward(diagCx, cz + pitch / 2 - 1, 7, dt);
  }
}

// ---- the óvalo leg: identical idea to systems/tutorialAutopilot.ts's own 'roundabout' case —
// this circuit's ring is now entered from the E arm (the top avenue) and left at the S arm (the
// left avenue).
function tickRoundabout(dt: number): void {
  const p = chassisBody.position;
  const route = getRoute('E', 'S');
  const s = ap.scratch('exam-roundabout', () => ({ s: undefined as number | undefined }));
  if (s.s === undefined) s.s = nearestArcLength(route, p.x, p.z);
  s.s = Math.min(route.length, s.s + (16 / 3.6) * dt);
  const sample = sampleRoute(route, Math.min(route.length - 0.1, s.s + 14));
  ap.driveToward(sample.x, sample.z, 16, dt);
}

// ---- the two plain curved bends (Trocha, the SW corner): same lazily-cached-path/lookahead
// technique as tickRoundabout, just against an ad hoc arc instead of a roundabout's own route.
const bendPaths: Record<string, Path> = {};
function tickBend(id: string, bend: { cx: number; cz: number; r: number; theta0: number; theta1: number }, dt: number): void {
  const path = bendPaths[id] ?? (bendPaths[id] = buildPathFromPoints(arcPoints(bend.cx, bend.cz, bend.r, bend.theta0, bend.theta1, 1.5)));
  const p = chassisBody.position;
  const s = ap.scratch(`exam-bend-${id}`, () => ({ s: undefined as number | undefined }));
  if (s.s === undefined) s.s = nearestArcLength(path, p.x, p.z);
  s.s = Math.min(path.length, s.s + (16 / 3.6) * dt);
  const sample = sampleRoute(path, Math.min(path.length - 0.1, s.s + 14));
  ap.driveToward(sample.x, sample.z, 16, dt);
}

// ---- forward-motion U-turn: steer toward a target heading with the usual driving convention
// (steerRight turns the nose right/clockwise while moving forward — the opposite of
// systems/reverseAutopilot.ts's rule, which is for backing up).
function tickUturn(targetYaw: number, dt: number): void {
  const err = wrap(targetYaw - carYaw());
  ap.setHeld('steerLeft', err > 0.05);
  ap.setHeld('steerRight', err < -0.05);
  ap.driveSpeed(7, dt);
}

export function updateAutoplay(dt: number): void {
  if (!ap.isOn()) return;
  const stepId = currentExamStepId();
  const ctx = ctxNow();

  switch (stepId) {
    case 'stop': {
      const s = ap.scratch('stop', () => ({ resume: false, stopT: 0 }));
      const target = { x: COURSE.own, z: COURSE.stopLineZ };
      if (!s.resume) {
        const close = Math.hypot(ctx.x - target.x, ctx.z - target.z) < 20;
        if (close && ctx.kmh < 2) s.stopT += dt;
        if (s.stopT > 1.8) s.resume = true;
        ap.driveToward(target.x, target.z, close ? 0 : 10, dt);
      } else {
        ap.driveToward(target.x, target.z - 25, 12, dt);
      }
      break;
    }
    case 'speed':
      // this step covers the right avenue's tail end, the Trocha bend, and the top avenue's own
      // speed-demo straight — tickBend's long lead-in (same trick tickRoundabout relies on for its
      // own approach arm) handles cruising the straight run before the bend is actually reached.
      if (ctx.z > COURSE.topAveOwnZ + 5) tickBend('trocha', COURSE.trocha, dt);
      else ap.driveToward(ctx.x - 30, COURSE.topAveOwnZ, 32, dt);
      break;
    case 'roundabout':
      tickRoundabout(dt);
      break;
    case 'parallel':
      tickParallelBay(ctx, dt);
      break;
    case 'diagonal':
      tickDiagonalBay(ctx, dt);
      break;
    case 'uturn1': {
      const s = ap.scratch('uturn1', () => ({ signaled: false }));
      if (!s.signaled && ctx.z > COURSE.uturnZ - 25) { ap.tap('signalLeft'); s.signaled = true; }
      tickUturn(0, dt);
      break;
    }
    case 'uturn2': {
      const s = ap.scratch('uturn2', () => ({ signaled: false }));
      if (!s.signaled && ctx.z < COURSE.uturnZ + 25) { ap.tap('signalLeft'); s.signaled = true; }
      tickUturn(Math.PI, dt);
      break;
    }
    case 'finish':
      // same idea as the 'speed' case: covers the left avenue's tail end, the SW bend, and the
      // bottom avenue up to the finish gate.
      if (ctx.z < COURSE.bottomAveOwnZ - 5) tickBend('sw', COURSE.swBend, dt);
      else {
        const close = Math.hypot(ctx.x - COURSE.salida.x, ctx.z - COURSE.salida.z) < 15;
        ap.driveToward(COURSE.salida.x, COURSE.bottomAveOwnZ, close ? 4 : 14, dt);
      }
      break;
  }

  ap.publish();
}
