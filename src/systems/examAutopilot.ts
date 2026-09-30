import * as THREE from 'three';
import { chassisBody, carYaw, forwardSpeed } from '../entities/player';
import { COURSE } from '../world/examCourse';
import { currentExamStepId } from './examCourse';
import {
  examChunk, playerDiagPath, playerOvalo2Path, playerFinishPath, progressOn, turnAhead, vmaxAt,
  type ExamRouteId, type RoutePath,
} from '../world/examRoutes';
import { RB, ringInfo, sampleRoute, type RouteSample } from '../world/roundabout';
import { trafficLightAhead, mustStopFor } from '../world/trafficLights';
import { examTrafficAhead, examTrafficMovingNear, ringBusyAt, playerBay } from '../entities/examTraffic';
import { controlState } from './input';
import { AutopilotController } from './autopilotKit';

// The "AI" button for the Examen Oficial MTC circuit (world/examCourse.ts / systems/examCourse.ts).
// It drives the same lane-centre paths as the other candidates on the course (world/examRoutes.ts)
// for whichever route this run drew, with a pure-pursuit follower that keeps its place along the
// path, and like them it stops at red lights, gives way on the óvalo, keeps its distance to the
// car ahead and signals its turns. It parks in whichever bays the exam drew for this run
// (entities/examTraffic.ts), with a simple pursuit-then-settle approach rather than a full
// reverse-park choreography.

const ap = new AutopilotController();
export const isAutoplayOn = (): boolean => ap.isOn();
export const stopAutoplay = (): void => ap.stop();
export const toggleAutoplay = (): void => ap.toggle();

let route: ExamRouteId = 'A';
export function setAutoplayRoute(r: ExamRouteId): void { route = r; }

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const L = COURSE.lanes;
const sample: RouteSample = { x: 0, z: 0, hx: 0, hz: 0 };

interface Ctx { x: number; z: number; yaw: number; kmh: number; hx: number; hz: number }
function ctxNow(): Ctx {
  const p = chassisBody.position, yaw = carYaw();
  return { x: p.x, z: p.z, yaw, kmh: Math.abs(forwardSpeed() * 3.6), hx: -Math.sin(yaw), hz: -Math.cos(yaw) };
}

// -1 left, 0 off, 1 right — taps the stalk only when the lamps don't already show it.
function setSignal(side: -1 | 0 | 1): void {
  if (side < 0 && !controlState.signalLeft) ap.tap('signalLeft');
  else if (side > 0 && !controlState.signalRight) ap.tap('signalRight');
  else if (side === 0) {
    if (controlState.signalLeft) ap.tap('signalLeft');
    if (controlState.signalRight) ap.tap('signalRight');
  }
}

// The most this car may do right now (km/h) for the lights, the óvalo and the traffic ahead.
function trafficCap(ctx: Ctx): number {
  let cap = Infinity;
  const tl = trafficLightAhead(ctx.x, ctx.z, ctx.hx, ctx.hz, 40);
  if (tl && mustStopFor(tl.light, tl.dist)) cap = Math.min(cap, THREE.MathUtils.clamp((tl.dist - 3.2) / 12, 0, 1) * 30);

  const { r, theta } = ringInfo(ctx.x, ctx.z);
  const inward = ((ctx.x - RB.cx) * ctx.hx + (ctx.z - RB.cz) * ctx.hz) / Math.max(r, 0.1) < -0.3;
  if (inward && r > RB.outerR + 0.3 && r < RB.outerR + 9 && ringBusyAt(theta, undefined, false)) {
    cap = Math.min(cap, THREE.MathUtils.clamp((r - RB.outerR - 2.5) / 5, 0, 1) * 20);
  }

  const lead = examTrafficAhead(ctx.x, ctx.z, ctx.hx, ctx.hz);
  if (lead) cap = Math.min(cap, (lead.speed + THREE.MathUtils.clamp((lead.gap - 3) * 0.6, 0, 9)) * 3.6);
  return cap;
}

// Pure pursuit along `path`, remembering progress in `prog[name]` so a path that passes the same
// place twice (the óvalo) keeps its place. The speed looks a second ahead so the car has braked
// before a bend, not in it. `look` shortens the pursuit point for tight manoeuvres. Returns true
// once the end is reached.
interface FollowOpts { signals?: boolean; look?: number; maxKmh?: number }
function follow(ctx: Ctx, dt: number, prog: Record<string, number>, name: string, path: RoutePath, { signals = true, look, maxKmh = Infinity }: FollowOpts = {}): boolean {
  const prev = prog[name];
  const s = prev === undefined
    ? progressOn(path, ctx.x, ctx.z, ctx.hx, ctx.hz)
    : progressOn(path, ctx.x, ctx.z, ctx.hx, ctx.hz, prev, 15);
  prog[name] = s;
  const v = ctx.kmh / 3.6;
  const vmax = Math.min(vmaxAt(path, s), vmaxAt(path, s + v * 1.2), vmaxAt(path, s + v * 0.6));
  const bend = vmax < 7; // slower and on a shorter lead through bends, so it doesn't cut across the kerb
  sampleRoute(path, s + (look ?? (bend ? 2.5 + v * 0.35 : 4 + v * 0.6)), sample);
  const kmh = Math.min(vmax * 3.6 * (bend ? 0.75 : 0.95), maxKmh, trafficCap(ctx));
  ap.driveToward(sample.x, sample.z, kmh, dt, 0.3);

  if (signals) {
    // on the ring: right as soon as the exit is coming up, otherwise whatever the next turn is
    const inRing = ringInfo(ctx.x, ctx.z).r < RB.outerR + 0.5;
    sampleRoute(path, s + 9, sample);
    const exiting = inRing && ringInfo(sample.x, sample.z).r > RB.outerR - 0.5;
    setSignal(exiting ? 1 : turnAhead(path, s));
  }
  return s >= path.length - 0.5;
}

// ---- diagonal bay k: nose in along the bay's own axis --------------------------------------------
function diagParked(ctx: Ctx, k: number): boolean {
  const { cz, yaw, pitch } = COURSE.diagonal;
  const cx = COURSE.diagonal.bayCx(k);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const dx = ctx.x - cx, dz = ctx.z - cz;
  const u = dx * c - dz * sn, v = dx * sn + dz * c;
  return Math.abs(u) <= 1.6 && Math.abs(v) <= pitch / 2 - 0.3 && Math.abs(wrap(ctx.yaw - yaw)) < toRad(10) && ctx.kmh < 1.5;
}

function tickDiagonal(ctx: Ctx, dt: number): void {
  const s = ap.scratch('exam-diagonal', () => ({ prog: {} as Record<string, number>, settle: false, signaled: false }));
  const k = playerBay('diag');
  if (k === null) { follow(ctx, dt, s.prog, 'toDiag', examChunk(route, 'toDiag')); return; } // no bay free yet: wait at the aisle
  const { cz, yaw } = COURSE.diagonal;
  const cx = COURSE.diagonal.bayCx(k);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw); // the bay's inward direction
  if (diagParked(ctx, k)) { ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false); ap.driveSpeed(0, dt); return; }
  const depth = (ctx.x - cx) * fx + (ctx.z - cz) * fz; // < 0 while still short of the bay centre
  if (!s.settle) {
    const path = playerDiagPath(k);
    const near = ctx.x > cx - 20 && ctx.z > L.aisleEB - 3;
    if (near && !s.signaled) { setSignal(1); s.signaled = true; }
    follow(ctx, dt, s.prog, 'diag', path, near ? { signals: false, look: 2.5, maxKmh: 6 } : {});
    if (depth > -1.2 && ctx.z > L.aisleEB + 2) s.settle = true;
    return;
  }
  ap.driveToward(cx + fx * 3, cz + fz * 3, 2, dt);
  if (depth > -0.2) ap.driveSpeed(0, dt);
}

// Leaving a bay: wait for a gap in the traffic before starting, then only for a car still on the
// move right beside (the others will have stopped for us).
function reverseClear(ctx: Ctx, started: boolean): boolean {
  return !examTrafficMovingNear(ctx.x, ctx.z, started ? 6 : 12);
}

// ---- back to the óvalo: back out of the bay swinging the nose round to the east, then on round
// the óvalo again -------------------------------------------------------------------------------------
function tickOvalo2(ctx: Ctx, dt: number): void {
  // the bay is let go once the car has driven off, so remember which one it backed out of
  const s = ap.scratch('exam-ovalo2', () => ({ phase: 'out' as 'out' | 'swing' | 'drive', prog: {} as Record<string, number>, t: 0, bay: playerBay('diag') ?? 0 }));
  if (s.phase !== 'drive' && !reverseClear(ctx, s.t > 0 || s.phase === 'swing')) { ap.driveSpeed(0, dt); return; }
  s.t += dt;
  if (s.phase === 'out') {
    // straight back until the nose is clear of the neighbouring cars
    ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
    setSignal(0);
    ap.driveSpeed(-4, dt);
    if (ctx.z < COURSE.roads.ZP + COURSE.roads.HALF + 0.3 || s.t > 8) { s.phase = 'swing'; s.t = 0; }
    return;
  }
  if (s.phase === 'swing') {
    // reversing with the wheel turned right swings the nose left, from south-east round to east
    ap.setHeld('steerLeft', false); ap.setHeld('steerRight', true);
    ap.driveSpeed(-3, dt);
    if (wrap(ctx.yaw + Math.PI / 2) > -0.12 || ctx.z < L.aisleWB + 1 || s.t > 8) { s.phase = 'drive'; ap.setHeld('steerRight', false); }
    return;
  }
  follow(ctx, dt, s.prog, 'ovalo2', playerOvalo2Path(s.bay));
}

// ---- parallel bay n: run west along the aisle, pull in to the kerb facing west, through the free
// bay n + 1 behind it (the exam keeps that one free too) ---------------------------------------------
function parParked(ctx: Ctx, n: number): boolean {
  const { kerbZ } = COURSE.parallel;
  const { frontX, rearX } = COURSE.parallel.bay(n);
  return ctx.x > frontX && ctx.x < rearX && ctx.z > kerbZ + 0.8 && ctx.z - 0.95 - kerbZ < 0.7
    && Math.abs(wrap(ctx.yaw - Math.PI / 2)) < toRad(10) && ctx.kmh < 1.5;
}

function tickParallel(ctx: Ctx, dt: number): void {
  const s = ap.scratch('exam-parallel', () => ({ signaled: false, onAisle: false, straighten: false, retry: false, idle: 0, prog: {} as Record<string, number> }));
  if (!s.onAisle) {
    s.onAisle = follow(ctx, dt, s.prog, 'toParallel', examChunk(route, 'toParallel'));
    return;
  }
  const n = playerBay('par');
  if (n === null) { ap.driveSpeed(0, dt); return; } // no bay free yet: wait at the aisle
  const { kerbZ } = COURSE.parallel;
  const { frontX, rearX } = COURSE.parallel.bay(n);
  const midX = (frontX + rearX) / 2, targetZ = kerbZ + 1.05;
  const stopX = frontX + 2.45; // the car's nose just inside the bay's front line
  if (parParked(ctx, n)) { ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false); ap.driveSpeed(0, dt); return; }
  if (!s.signaled && Math.abs(ctx.x - midX) < 20) { setSignal(1); s.signaled = true; }
  if (s.retry) {
    // not square to the kerb: back up into the free bay behind and come in again
    ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
    ap.driveSpeed(-3, dt);
    if (ctx.x > rearX + 2.8) { s.retry = false; s.straighten = false; } // rear bumper still clear of bay n + 2
    return;
  }
  const clearOfNext = rearX + 5.5; // past whoever is in bay n + 2, beyond the free bay n + 1
  if (ctx.x > clearOfNext) {
    ap.driveToward(midX + 3, L.aisleWB - 0.3, ctx.x > midX + 16 ? 10 : 6, dt); // run west along the aisle
  } else if (!s.straighten) {
    ap.driveToward(midX + 0.5, kerbZ + 0.4, 4, dt);         // angle in towards the kerb through the free bay n + 1
    if (ctx.z < kerbZ + 1.9 || ctx.x < midX + 1) s.straighten = true;
  } else {
    ap.driveToward(midX - 8, targetZ, ctx.x > stopX ? 3 : 0, dt); // straighten along the kerb, stop inside the bay
    s.idle = ctx.kmh < 0.5 ? s.idle + dt : 0;
    if (s.idle > 2) { s.retry = true; s.idle = 0; }
  }
}

// ---- out: back up into the free bay behind, pull out onto the aisle, on to SALIDA ---------------
function tickFinish(ctx: Ctx, dt: number): void {
  const s = ap.scratch('exam-finish', () => ({ phase: 'back' as 'back' | 'pull' | 'drive', prog: {} as Record<string, number>, t: 0, bay: playerBay('par') ?? 1 }));
  const { rearX } = COURSE.parallel.bay(s.bay);
  if (s.phase !== 'drive' && !reverseClear(ctx, s.t > 0 || s.phase === 'pull')) { ap.driveSpeed(0, dt); return; }
  s.t += dt;
  if (s.phase === 'back') {
    ap.setHeld('steerLeft', false); ap.setHeld('steerRight', false);
    setSignal(-1);
    ap.driveSpeed(-3, dt);
    if (ctx.x > rearX + 2.5 || s.t > 6) { s.phase = 'pull'; s.t = 0; }
  } else if (s.phase === 'pull') {
    ap.driveToward(ctx.x - 8, L.aisleWB + 0.3, 5, dt);
    if (ctx.z > L.aisleWB - 0.8 || s.t > 8) s.phase = 'drive';
  } else {
    follow(ctx, dt, s.prog, 'finish', playerFinishPath(s.bay));
  }
}

export function updateAutoplay(dt: number): void {
  if (!ap.isOn()) return;
  const ctx = ctxNow();

  switch (currentExamStepId()) {
    case 'stop': {
      const s = ap.scratch('stop', () => ({ resume: false, stopT: 0, prog: {} as Record<string, number> }));
      if (!s.resume) {
        follow(ctx, dt, s.prog, 'entry', examChunk(route, 'entry'));
        if (ctx.kmh < 1.5 && ctx.z < COURSE.stopLineZ + 5) s.stopT += dt;
        if (s.stopT > 1.8) s.resume = true;
      } else {
        follow(ctx, dt, s.prog, 'toOvalo', examChunk(route, 'toOvalo'));
      }
      break;
    }
    case 'speed':
    case 'road3':
    case 'roundabout': {
      const s = ap.scratch('toOvalo', () => ({ prog: {} as Record<string, number> }));
      follow(ctx, dt, s.prog, 'toOvalo', examChunk(route, 'toOvalo'));
      break;
    }
    case 'diagonal':
      tickDiagonal(ctx, dt);
      break;
    case 'ovalo2':
      tickOvalo2(ctx, dt);
      break;
    case 'parallel':
      tickParallel(ctx, dt);
      break;
    case 'finish':
      tickFinish(ctx, dt);
      break;
  }

  ap.publish();
}
