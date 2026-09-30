import * as THREE from 'three';
import { chassisBody, carYaw, CAR_HALF_LENGTH } from './player';
import { createTrafficVehicle, placeTrafficVehicle, removeTrafficVehicle, type TrafficVehicle } from './aiVehicles';
import {
  examChunk, diagLegs, parLegs, turnAhead, vmaxAt, ROUTE_SEGMENTS,
  type ExamRouteId, type Leg,
} from '../world/examRoutes';
import { COURSE, showPlayerBay } from '../world/examCourse';
import { RB, ringInfo, sampleRoute, wrapAngle, type RouteSample } from '../world/roundabout';
import { trafficLightAhead, mustStopFor } from '../world/trafficLights';
import { occupiedCrosswalkGap } from '../world/crosswalks';

// The other candidates on the "Examen Oficial MTC" circuit: cars that drive the same exam the
// player does, each on Ruta A or Ruta B at random (world/examRoutes.ts), from ENTRADA to SALIDA —
// the PARE, both óvalo passes, a diagonal and a parallel park in a free bay, then out. They stop
// at red lights and for pedestrians, give way on the óvalo, keep their distance to whatever is
// ahead (the player included) and signal their turns.
//
// They're also who fills the parking rows: the cars standing in the bays when the exam starts are
// candidates halfway through, who pull out after a while and carry on; arriving ones park in a
// free bay at random and leave again. The player's own bay is picked here too, at random among
// the free ones, only once their parking step starts — and kept for them until they've left it.

export interface ExamCar extends TrafficVehicle {
  route: ExamRouteId;
  seg: number;        // index into ROUTE_SEGMENTS
  legs: Leg[];        // the current segment, expanded
  leg: number;
  s: number;          // arc length along the current leg
  speed: number;      // m/s along the leg (backwards on a reversing leg)
  wait: number;       // seconds left standing at the end of a leg (the PARE, a bay)
  dwelt: boolean;
  x: number; z: number;
  mx: number; mz: number; // direction of travel
  fx: number; fz: number; // direction it faces (opposite to travel when reversing)
  inRing: boolean;
  theta: number;
  stuck: number;      // seconds held up by other candidates (not lights, not the player)
  pushOn: number;     // seconds left going ahead regardless of them, to break a stand-off
}

export const examCars: ExamCar[] = [];
const reservedBays = new Set<string>();
// One manoeuvre at a time per parking row: a car arriving holds its row's lock from the moment it
// picks a bay until it's parked (if the row is busy it just drives past), and a parked car takes it
// to pull out, until it's back in the lane. Nobody ever waits in the lane for a lock, so no one can
// end up blocking the car that holds it.
type RowKind = 'diag' | 'par';
const rowLock: Partial<Record<RowKind, ExamCar>> = {};
const rowOf = (bay: string): RowKind => (bay.startsWith('diag') ? 'diag' : 'par');
const holdsLock = (c: ExamCar): boolean => rowLock.diag === c || rowLock.par === c;
function releaseLock(c: ExamCar, row?: RowKind): void {
  (row ? [row] : (['diag', 'par'] as RowKind[])).forEach(r => { if (rowLock[r] === c) delete rowLock[r]; });
}
const sample: RouteSample = { x: 0, z: 0, hx: 0, hz: 0 };
const MAX_MOVING = 4; // candidates on the move at once, not counting the parked ones
let spawnTimer = 0;
let nextSpawn = 8;

const playerPos = (): { x: number; z: number } => chassisBody.position;
const playerNear = (x: number, z: number, r: number): boolean => Math.hypot(playerPos().x - x, playerPos().z - z) < r;

// ---- bays -------------------------------------------------------------------------------------------
type BayKind = 'diag' | 'par';
const bayKey = (kind: BayKind, i: number): string => `${kind}${i}`;
const DIAG_BAYS = Array.from({ length: COURSE.diagonal.count }, (_, k) => k);           // k, west->east
const PAR_BAYS = Array.from({ length: COURSE.parallel.count }, (_, n) => n + 1);          // 1..7, west->east
function bayCentre(kind: BayKind, i: number): { x: number; z: number } {
  return kind === 'diag'
    ? { x: COURSE.diagonal.bayCx(i), z: COURSE.diagonal.cz }
    : { x: COURSE.parallel.bayCx(i), z: COURSE.parallel.kerbZ + 1.25 };
}

// The player's bay for each parking step: reserved from the step's start until they've driven off.
interface PlayerBay { bay: number; keys: string[]; done: boolean }
const playerBays: Partial<Record<BayKind, PlayerBay>> = {};
const playerHolds = (key: string): boolean => Object.values(playerBays).some(b => b?.keys.includes(key));
const bayTaken = (key: string): boolean => reservedBays.has(key) || playerHolds(key);

const isParkedNow = (c: ExamCar): boolean => !!c.legs[c.leg]?.parked && c.dwelt && c.wait > 0;
// The car standing parked in `key`, if that's all that holds it (not one on its way in or out).
const parkedIn = (key: string): ExamCar | undefined => examCars.find(c => isParkedNow(c) && c.legs[c.leg].bay === key);
const pick = <T>(xs: T[]): T | null => (xs.length ? xs[Math.floor(Math.random() * xs.length)] : null);

// A parking segment picks its bay on arrival: a random free one away from the player, taking the
// row's lock — or none, and the car drives on, when nothing's free or someone is already manoeuvring.
function segmentLegs(route: ExamRouteId, seg: number, car?: ExamCar): Leg[] {
  const id = ROUTE_SEGMENTS[seg];
  if (id === 'diag' || id === 'par') {
    const bays = id === 'diag' ? DIAG_BAYS : PAR_BAYS;
    // a car waiting to pull out of this row goes first
    const exitWaiting = examCars.some(c => { const l = c.legs[c.leg]; return !!l?.startsInBay && !!l.bay && rowOf(l.bay) === id && c.s < 0.3 && c.wait <= 0; });
    const i = car && !rowLock[id] && !exitWaiting
      ? pick(bays.filter(b => !bayTaken(bayKey(id, b)) && !playerNear(bayCentre(id, b).x, bayCentre(id, b).z, id === 'diag' ? 7 : 11)))
      : null;
    if (i !== null) { reservedBays.add(bayKey(id, i)); rowLock[id] = car; }
    const dwell = 8 + Math.random() * 17;
    return id === 'diag' ? diagLegs(i, dwell) : parLegs(i, dwell);
  }
  return [{ path: examChunk(route, id), reverse: false, dwell: id === 'entry' ? 2.2 : 0 }];
}

// Sends the player to a bay picked at random among the free ones and keeps it for them. A parallel
// bay also needs the one behind it (east) free, to swing in through. When none is free, cars that
// are only standing parked are asked to leave. Returns the bay (diagonal k / parallel n) or null.
export function claimPlayerBay(kind: BayKind): number | null {
  const held = playerBays[kind];
  if (held) return held.bay;
  const needs = (b: number): string[] => (kind === 'diag' ? [bayKey('diag', b)] : [bayKey('par', b), bayKey('par', b + 1)]);
  const options = kind === 'diag' ? DIAG_BAYS : PAR_BAYS.filter(n => n < COURSE.parallel.count);
  let bay = pick(options.filter(b => needs(b).every(k => !bayTaken(k))));
  if (bay === null) {
    bay = pick(options.filter(b => needs(b).every(k => !playerHolds(k) && (!reservedBays.has(k) || parkedIn(k)))));
    if (bay === null) return null;
    needs(bay).forEach(k => { const c = parkedIn(k); if (c) c.wait = Math.min(c.wait, 0.3); });
  }
  playerBays[kind] = { bay, keys: needs(bay), done: false };
  showPlayerBay(kind, bay);
  return bay;
}

export function playerBay(kind: BayKind): number | null { return playerBays[kind]?.bay ?? null; }

// The player has parked there: the bay is let go as soon as they've driven away from it.
export function playerParked(kind: BayKind): void {
  const held = playerBays[kind];
  if (held) held.done = true;
}

function releasePlayerBays(): void {
  (['diag', 'par'] as BayKind[]).forEach(kind => {
    const held = playerBays[kind];
    if (!held?.done) return;
    const c = bayCentre(kind, held.bay);
    if (playerNear(c.x, c.z, 10)) return;
    delete playerBays[kind];
    showPlayerBay(kind, null);
  });
}

// A candidate who's already parked in `bay` when the exam starts, halfway through their own run.
function spawnParked(kind: BayKind, bay: number): void {
  const v = createTrafficVehicle('car');
  const legs = kind === 'diag' ? diagLegs(bay, 15 + Math.random() * 90) : parLegs(bay, 15 + Math.random() * 90);
  const leg = legs.findIndex(l => l.parked);
  const car: ExamCar = {
    ...v, route: Math.random() < 0.5 ? 'A' : 'B', seg: ROUTE_SEGMENTS.indexOf(kind), legs, leg,
    s: legs[leg].path.length - 0.05, speed: 0, wait: legs[leg].dwell, dwelt: true,
    x: 0, z: 0, mx: 0, mz: -1, fx: 0, fz: -1, inRing: false, theta: 0, stuck: 0, pushOn: 0,
  };
  reservedBays.add(bayKey(kind, bay));
  place(car);
  examCars.push(car);
}

function place(car: ExamCar): void {
  const leg = car.legs[car.leg];
  sampleRoute(leg.path, car.s, sample);
  car.x = sample.x; car.z = sample.z;
  car.mx = sample.hx; car.mz = sample.hz;
  const f = leg.reverse ? -1 : 1;
  car.fx = sample.hx * f; car.fz = sample.hz * f;
  placeTrafficVehicle(car, sample.x, sample.z, sample.hx * f, sample.hz * f, car.speed * f);
}

function spawnCar(route: ExamRouteId, seg: number, s: number): ExamCar {
  const v = createTrafficVehicle('car');
  const car: ExamCar = {
    ...v, route, seg, legs: segmentLegs(route, seg), leg: 0, s, speed: 0, wait: 0, dwelt: false,
    x: 0, z: 0, mx: 0, mz: -1, fx: 0, fz: -1, inRing: false, theta: 0, stuck: 0, pushOn: 0,
  };
  place(car);
  examCars.push(car);
  return car;
}

function clearOf(x: number, z: number, player: number, cars: number): boolean {
  return !playerNear(x, z, player) && examCars.every(c => Math.hypot(c.x - x, c.z - z) > cars);
}

function removeCar(i: number): void {
  const car = examCars[i];
  car.legs.forEach(l => { if (l.bay) reservedBays.delete(l.bay); });
  releaseLock(car);
  removeTrafficVehicle(car);
  examCars.splice(i, 1);
}

export function clearExamTraffic(): void {
  for (let i = examCars.length - 1; i >= 0; i--) removeCar(i);
  reservedBays.clear();
  delete rowLock.diag; delete rowLock.par;
  (['diag', 'par'] as BayKind[]).forEach(kind => { delete playerBays[kind]; showPlayerBay(kind, null); });
}

// Both parking rows about half full, a couple of candidates already out on the course, then one
// more through ENTRADA every so often.
export function initExamTraffic(): void {
  clearExamTraffic();
  const someOf = (xs: number[], n: number): number[] => [...xs].sort(() => Math.random() - 0.5).slice(0, n);
  someOf(DIAG_BAYS, 3 + Math.floor(Math.random() * 2)).forEach(k => spawnParked('diag', k));
  someOf(PAR_BAYS, 3 + Math.floor(Math.random() * 2)).forEach(n => spawnParked('par', n));
  spawnTimer = 0;
  nextSpawn = 10;
  const midSegments = [1, 2, 4, 5]; // plain drives, not the parking segments
  for (let tries = 0, placed = 0; tries < 20 && placed < 2; tries++) {
    const route: ExamRouteId = Math.random() < 0.5 ? 'A' : 'B';
    const seg = midSegments[Math.floor(Math.random() * midSegments.length)];
    const path = examChunk(route, ROUTE_SEGMENTS[seg] as Parameters<typeof examChunk>[1]);
    const s = path.length * (0.2 + Math.random() * 0.6);
    sampleRoute(path, s, sample);
    if (!clearOf(sample.x, sample.z, 40, 20)) continue;
    const car = spawnCar(route, seg, s);
    car.speed = vmaxAt(path, s) * 0.6;
    placed++;
  }
}

// ---- who is where ---------------------------------------------------------------------------------
// A car standing in its bay (parked, or waiting to back out) isn't traffic to queue behind — it's
// what you park next to.
function standingInBay(c: ExamCar): boolean {
  const leg = c.legs[c.leg];
  if (!leg.bay || c.speed >= 0.1) return false;
  return (!!leg.parked && c.s > leg.path.length - 0.2) || (!!leg.startsInBay && c.s < 0.3 && !holdsLock(c));
}
// A car about to back up (or backing up) is given a few metres more room by whoever is behind it.
const aboutToReverse = (c: ExamCar): boolean => c.legs[c.leg].reverse || !!c.legs[c.leg + 1]?.reverse;

// The nearest car ahead of (x, z) along (hx, hz), in the same lane: gap between bumpers and how fast
// it's pulling away. A candidate car coming the other way isn't one to follow (it gives way to the
// player itself), unless it's right there; the player always counts, whichever way they face.
export function examTrafficAhead(x: number, z: number, hx: number, hz: number, self?: ExamCar, range = 25, cars = true): { gap: number; speed: number } | null {
  let best: { gap: number; speed: number } | null = null;
  const consider = (ox: number, oz: number, speed: number, oncoming: boolean, room = 0, wide = false): void => {
    const dx = ox - x, dz = oz - z;
    const along = dx * hx + dz * hz;
    if (along <= 0 || along > range) return;
    const lateral = Math.abs(dx * hz - dz * hx);
    if (lateral > (wide && !oncoming ? 6 : along < 8 ? 2.4 : 2.0)) return;
    const gap = along - 4.4 - room;
    if (oncoming && gap > 1) return;
    if (!best || gap < best.gap) best = { gap, speed };
  };
  if (cars) examCars.forEach(c => {
    if (c === self || standingInBay(c)) return;
    // a car backing out or in gets a few metres more room to finish its manoeuvre, and one in the
    // middle of parking or pulling out blocks the lane even before it's in it
    consider(c.x, c.z, Math.max(0, c.speed * (c.mx * hx + c.mz * hz)), c.fx * hx + c.fz * hz < -0.5, aboutToReverse(c) ? 3 : 0, holdsLock(c) && (c.speed > 0.1 || c.s > 0.3));
  });
  // the player's centre and both bumpers: backing out of a bay, their rear is in the lane first
  if (self) {
    const p = playerPos(), yaw = carYaw(), px = -Math.sin(yaw), pz = -Math.cos(yaw), v = chassisBody.velocity.length();
    consider(p.x, p.z, v, false);
    [-1, 1].forEach(e => consider(p.x + px * CAR_HALF_LENGTH * e, p.z + pz * CAR_HALF_LENGTH * e, v, false, -CAR_HALF_LENGTH));
  }
  return best;
}

// Is any candidate on the move within `r` of (x, z)? — for the player's own autopilot, before it
// backs out of a bay.
export function examTrafficMovingNear(x: number, z: number, r: number): boolean {
  return examCars.some(c => c.speed > 0.3 && Math.hypot(c.x - x, c.z - z) < r);
}

// Is anyone circling the óvalo towards `entryTheta` (about to pass the point where a car would
// join the ring)? Counter-clockwise flow runs to decreasing theta, so "upstream" is larger theta.
export function ringBusyAt(entryTheta: number, self?: ExamCar, includePlayer = true): boolean {
  const busy = (theta: number, speed: number): boolean => {
    const d = wrapAngle(theta - entryTheta);
    return speed > 0.5 && (d < 1.1 || d > Math.PI * 2 - 0.3);
  };
  if (examCars.some(c => c !== self && c.inRing && busy(c.theta, c.speed))) return true;
  if (!includePlayer) return false;
  const p = playerPos(), info = ringInfo(p.x, p.z);
  return info.r < RB.outerR && info.r > RB.innerR - 1 && busy(info.theta, chassisBody.velocity.length());
}

// ---- per frame ------------------------------------------------------------------------------------
// How fast `car` may go on `leg` right now. `cars`: whether to give way to the other candidates as
// well (always to lights, the óvalo's traffic and the player).
function targetSpeed(car: ExamCar, leg: Leg, cars: boolean): number {
  let target = vmaxAt(leg.path, car.s);
  // leaving a bay: wait for the row to be free and a gap in the traffic — nobody on the move close
  // by and nobody standing right in the way (the row's lock is taken once it actually goes)
  if (leg.startsInBay && !holdsLock(car) && car.s < 0.3 && car.speed < 0.1) {
    const busy = !!rowLock[rowOf(leg.bay!)] || (cars && examCars.some(c => {
      if (c === car || standingInBay(c)) return false;
      const d = Math.hypot(c.x - car.x, c.z - car.z);
      return (c.speed > 0.3 && d < 12) || d < 8;
    })) || (chassisBody.velocity.length() > 0.5 && playerNear(car.x, car.z, 12));
    if (busy) return 0;
  }
  if (leg.reverse) {
    // don't start backing out across a player driving past; once under way, only stop right beside them
    // still in the bay mouth: also hold for a player coming past (not one already stopped for us)
    if (leg.clearance && car.s < 0.3 && car.speed < 0.1 && playerNear(car.x, car.z, leg.clearance)) return 0;
    if (leg.clearance && car.s < leg.path.length * 0.6 && chassisBody.velocity.length() > 0.8 && playerNear(car.x, car.z, 9)) return 0;
    // nobody in the way behind (which way the other one faces doesn't matter)
    const inTheWay = (ox: number, oz: number): boolean => {
      const dx = ox - car.x, dz = oz - car.z, along = dx * car.mx + dz * car.mz;
      return along > 0 && along < 5.5 && Math.abs(dx * car.mz - dz * car.mx) < 2.4;
    };
    if (cars && examCars.some(c => c !== car && !standingInBay(c) && inTheWay(c.x, c.z))) return 0;
    return playerNear(car.x, car.z, 3.4) || inTheWay(playerPos().x, playerPos().z) ? 0 : target;
  }

  // red (or amber with room to stop) ahead: stop with the nose at the line
  const tl = trafficLightAhead(car.x, car.z, car.mx, car.mz, 30);
  if (tl && mustStopFor(tl.light, tl.dist)) target = Math.min(target, THREE.MathUtils.clamp((tl.dist - 3) / 10, 0, 1) * target);

  // give way on the óvalo to whoever is already circling
  const { r, theta } = ringInfo(car.x, car.z);
  const inward = ((car.x - RB.cx) * car.mx + (car.z - RB.cz) * car.mz) / Math.max(r, 0.1) < -0.3;
  if (inward && r > RB.outerR + 0.3 && r < RB.outerR + 9 && ringBusyAt(theta, car)) {
    target = Math.min(target, THREE.MathUtils.clamp((r - RB.outerR - 2) / 5, 0, 1) * target);
  }

  // pedestrians on a zebra ahead
  const zgap = occupiedCrosswalkGap(car.x, car.z, car.mx, car.mz, car.half.z);
  if (zgap < Infinity) target = Math.min(target, THREE.MathUtils.clamp(zgap / 8, 0, 1) * target);

  // following distance to the car (or player) ahead; never push into the player at close range
  const lead = examTrafficAhead(car.x, car.z, car.mx, car.mz, car, 25, cars);
  if (lead) target = lead.gap < 1.5 ? 0 : Math.min(target, lead.speed + THREE.MathUtils.clamp((lead.gap - 3) * 0.6, 0, target));
  if (playerNear(car.x + car.mx * 3, car.z + car.mz * 3, 3.2)) target = 0;
  // whatever else it ignores, never drive into a car right in front
  if (!cars && examCars.some(c => {
    if (c === car || standingInBay(c)) return false;
    const dx = c.x - car.x, dz = c.z - car.z, along = dx * car.mx + dz * car.mz;
    return along > 0 && along < 5 && Math.abs(dx * car.mz - dz * car.mx) < 2;
  })) target = 0;
  return target;
}

function advanceLeg(car: ExamCar, i: number): boolean {
  const done = car.legs[car.leg];
  // parked, or back in the lane after leaving the bay: the row is free for the next manoeuvre
  if (done.bay && (done.parked || done.startsInBay)) releaseLock(car, rowOf(done.bay));
  car.leg++;
  car.s = 0; car.dwelt = false;
  if (car.leg >= car.legs.length) {
    car.seg++;
    if (car.seg >= ROUTE_SEGMENTS.length) { removeCar(i); return false; }
    car.legs = segmentLegs(car.route, car.seg, car);
    car.leg = 0;
  }
  if (done.bay && car.legs[car.leg]?.bay !== done.bay) reservedBays.delete(done.bay);
  return true;
}

export function updateExamTraffic(dt: number): void {
  const blinkOn = Math.floor(performance.now() / 350) % 2 === 0;
  examCars.forEach(c => {
    const info = ringInfo(c.x, c.z);
    c.theta = info.theta;
    c.inRing = info.r < RB.outerR + 0.3 && info.r > RB.innerR - 1;
  });

  for (let i = examCars.length - 1; i >= 0; i--) {
    const car = examCars[i];
    let leg = car.legs[car.leg];
    let target = 0;

    if (car.wait > 0) {
      car.wait -= dt;
      car.speed = 0;
    } else {
      // a stand-off with other candidates (each waiting for the other) is broken the way drivers do:
      // after a while one of them simply goes
      const free = targetSpeed(car, leg, false);
      target = car.pushOn > 0 ? free : targetSpeed(car, leg, true);
      car.pushOn = Math.max(0, car.pushOn - dt);
      car.stuck = target < 0.05 && free > 0.5 ? car.stuck + dt : 0;
      if (car.stuck > 8) { car.stuck = 0; car.pushOn = 3; }
      if (leg.startsInBay && target > 0 && !holdsLock(car)) rowLock[rowOf(leg.bay!)] = car;
      car.speed = Math.max(0, car.speed + THREE.MathUtils.clamp(target - car.speed, -6 * dt, 2.5 * dt));
      car.s += car.speed * dt;
      if (car.s >= leg.path.length - 0.05) {
        car.s = leg.path.length - 0.05;
        if (leg.dwell > 0 && !car.dwelt) { car.dwelt = true; car.wait = leg.dwell; car.speed = 0; }
        else if (!advanceLeg(car, i)) continue;
        leg = car.legs[car.leg];
      }
    }
    place(car);
    if (car.body.userData) car.body.userData.isParked = isParkedNow(car); // bumping one standing in a bay is a parking fault

    const braking = car.wait > 0 || target < car.speed - 0.3 || car.speed < 0.3;
    car.mesh.userData.tailLights?.forEach(t => { t.material.emissiveIntensity = braking ? 0.9 : 0.3; });
    const turn = leg.reverse ? 0 : turnAhead(leg.path, car.s);
    car.mesh.userData.indicators?.left.forEach(m => { m.material.emissiveIntensity = turn < 0 && blinkOn ? 1 : 0; });
    car.mesh.userData.indicators?.right.forEach(m => { m.material.emissiveIntensity = turn > 0 && blinkOn ? 1 : 0; });
  }

  // one more candidate through ENTRADA every so often, when the gate is clear
  spawnTimer += dt;
  releasePlayerBays();
  if (spawnTimer > nextSpawn && examCars.filter(c => !isParkedNow(c)).length < MAX_MOVING) {
    const route: ExamRouteId = Math.random() < 0.5 ? 'A' : 'B';
    const start = examChunk(route, 'entry').pts[0];
    if (clearOf(start.x, start.z, 14, 10)) {
      spawnCar(route, 0, 0);
      spawnTimer = 0;
      nextSpawn = 14 + Math.random() * 14;
    }
  }
}

