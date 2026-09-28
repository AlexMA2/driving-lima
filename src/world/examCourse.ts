import { box } from '../assets/primitives';
import { scene } from '../core/scene';
import { CONFIG } from '../config';
import { buildStopSign, buildNoParkingPlate, buildPedestrianWarningPlate, buildUTurnPermittedPlate, buildSignPost } from '../assets/props';
import { buildGround, buildStreet, barrier, scatterBlockBuildings, annulus, arcCurbColliders } from './streetKit';
import { setLaneLayout } from './road';
import { buildRoundabout, RB } from './roundabout';
import { addCrosswalk, flushZebras, resetCrosswalks } from './crosswalks';
import { parkedCar, paint, paintAngled, paintLetter, targetZone, targetZoneAngled } from './parkingLot';
import type { Spawn } from '../entities/player';

// The "Examen Oficial MTC" circuit: a rectangular LOOP modelled on the real Peru MTC "Categoría
// A-Uno" practical-exam course (photo supplied by the user) rather than a single straight corridor:
// entrance and exit sit next to each other at the south end, a small roundabout ("óvalo") turns the
// flow at the NW corner, a curved loop-back ("Trocha") turns it again at the NE corner, and both
// parking bays sit kerb-side along the west avenue in between. North is -Z throughout, same
// convention as every other course; right-hand traffic, so every corner here is a LEFT turn (the
// loop is driven counter-clockwise, same rotational sense as the óvalo's own S->E->N->W circulation
// order — see world/roundabout.ts's comment on ARMS).
//
// Coordinates below are derived from a handful of named constants rather than hand-picked
// literals, so the geometry stays internally consistent (every straight run's own-lane line meets
// the next bend's own arc exactly, tangent to tangent) even though the numbers themselves are a
// judgment call (course size, bend radii) with no exact real-world scale to match.

const OWN = CONFIG.LANE_WIDTH / 2; // 1.75 — a course's own-lane centreline offset from whichever road centreline it's built on
const BEND_R = 25; // turn radius for the two new bends — same order of magnitude as the óvalo's own ring (RB.outerR=20, RB.laneR=18.25)

const entrance = { x: OWN, z: 90 };
const crossingZ = entrance.z - 12;
const stopLineZ = entrance.z - 40;

const rightAveX = 0; // the entrance avenue's centreline; own (northbound) lane sits at rightAveX..+LANE_WIDTH, kerb on the +X side
const trochaStartZ = -140; // where the straight right avenue ends and the Trocha bend begins

// Trocha bend (NE corner): a left turn, north-heading -> west-heading. Its pivot sits BEND_R due
// west of the right avenue's own lane at the point the straight run ends (see world/curves.ts's
// arcPoints — theta is the usual world atan2 angle, same convention as ringInfo/ARMS elsewhere).
const trocha = { cx: rightAveX + OWN - BEND_R, cz: trochaStartZ, r: BEND_R, theta0: 0, theta1: -Math.PI / 2 };

const topAveOwnZ = trocha.cz - BEND_R; // where the bend hands off to the top avenue's own (westbound) lane
const topAveZ = topAveOwnZ + OWN; // the top avenue's own centreline (its own lane sits OWN north of it)

const ovaloCx = -170; // the óvalo's centre x; its centre z sits on the top avenue's own centreline
const armTipE = ovaloCx + RB.outerR + 50; // the óvalo's short E-arm stub, before a separate outer street continues to the Trocha bend
const speedGateX = -70; // partway down the speed-demonstration straight between the Trocha bend and the óvalo

const leftAveX = ovaloCx; // the óvalo's S arm shares the left avenue's centreline
const armTipS = topAveZ + RB.outerR + 50; // the óvalo's short S-arm stub, before a separate outer street continues to the SW bend
const leftAveBendStartZ = 65; // where the straight left avenue ends and the SW bend begins

// The left avenue is travelled southbound, so its own lane — and the kerb the parking bays sit
// against — is on the -X side of its centreline, mirroring the right avenue's +X convention.
const leftKerb = leftAveX - CONFIG.LANE_WIDTH;
const parallel = { frontZ: -10, rearZ: -2.5 };
// angle's sign is flipped vs. a +X-kerb bay (the diagonal step's shared grading math in
// systems/examCourse.ts always applies "-angle", so flipping the sign here — instead of touching
// that formula — is what actually mirrors the bay onto this kerb).
const diagonal = { cz: 25, angle: -Math.PI / 4, pitch: 4.6 };
const uturnZ = 50;

// SW bend: a left turn, south-heading -> east-heading, funnelling back toward the exit.
const swA = { x: leftAveX - OWN, z: leftAveBendStartZ };
const swBend = { cx: swA.x + BEND_R, cz: swA.z, r: BEND_R, theta0: -Math.PI, theta1: -1.5 * Math.PI };

const bottomAveOwnZ = swBend.cz + BEND_R; // where the bend hands off to the bottom avenue's own (eastbound) lane
const bottomAveZ = bottomAveOwnZ - OWN; // the bottom avenue's own centreline (its own lane sits OWN south of it)
const finishX = -6; // the bottom avenue's dead end, near (but not on top of) the entrance

export const COURSE = {
  own: OWN,
  entrance, crossingZ, stopLineZ,
  rightAveX, trocha, topAveOwnZ,
  topAveZ, speedGateX,
  ovalo: { cx: ovaloCx, cz: topAveZ },
  leftAveX, leftKerb,
  parallel, diagonal, uturnZ,
  swBend, bottomAveZ, bottomAveOwnZ,
  salida: { x: finishX, z: bottomAveOwnZ },
};

function buildFinishGate(orientation: 'x' | 'z', x: number, z: number): void {
  [-4.5, 4.5].forEach(d => {
    const post = box(0.3, 3.6, 0.3, 0x444444);
    if (orientation === 'z') post.position.set(x + d, 1.8, z); else post.position.set(x, 1.8, z + d);
    scene.add(post);
  });
  const banner = orientation === 'z' ? box(9.6, 0.8, 0.15, 0x2ecc71) : box(0.15, 0.8, 9.6, 0x2ecc71);
  banner.position.set(x, 3.6, z);
  scene.add(banner);
}

// Pavement + drivable-width curb colliders for a single-lane bend (Trocha, the SW bend): a ring
// sector exactly one lane wide, centred on the bend's own arc radius, so it lines up seam-to-seam
// with the straight avenue's own-lane strip at each end (verified by construction: both ends sit
// exactly `r` from the pivot, same as the straight run's own-lane line).
//
// bend.theta0/theta1 are stored in physical start->end order (driving direction) for
// examAutopilot.ts's arcPoints() call, which handles either direction fine. annulus()/
// arcCurbColliders() do NOT: they require an increasing (theta0 < theta1) pair to sweep the minor
// arc (every call in world/roundabout.ts already respects this) — a decreasing pair makes them
// sweep the *major* 270-degree arc instead of the intended 90-degree turn. Sort before using them.
function buildBend(bend: { cx: number; cz: number; r: number; theta0: number; theta1: number }): void {
  const { cx, cz, r } = bend;
  const t0 = Math.min(bend.theta0, bend.theta1), t1 = Math.max(bend.theta0, bend.theta1);
  annulus(cx, cz, r - OWN, r + OWN, -0.05, 0.097, 0x3a3a3f, t0, t1);
  arcCurbColliders(cx, cz, r - OWN - 0.3, 0.3, t0, t1);
  arcCurbColliders(cx, cz, r + OWN + 0.3, 0.3, t0, t1);
}

const SCATTER_SIDE = CONFIG.LANE_WIDTH * 2 + 3 + 40;

function scatterAlongZ(x: number, zA: number, zB: number, skip?: { z: number; r: number }): void {
  const lo = Math.min(zA, zB), hi = Math.max(zA, zB);
  for (let z = lo + 40; z < hi; z += 80) {
    if (skip && Math.abs(z - skip.z) < skip.r) continue;
    scatterBlockBuildings(x + SCATTER_SIDE, z, 80, 12, [2, 4]);
    scatterBlockBuildings(x - SCATTER_SIDE, z, 80, 12, [2, 4]);
  }
}

function scatterAlongX(z: number, xA: number, xB: number, skip?: { x: number; r: number }): void {
  const lo = Math.min(xA, xB), hi = Math.max(xA, xB);
  for (let x = lo + 40; x < hi; x += 80) {
    if (skip && Math.abs(x - skip.x) < skip.r) continue;
    scatterBlockBuildings(x, z + SCATTER_SIDE, 80, 12, [2, 4]);
    scatterBlockBuildings(x, z - SCATTER_SIDE, 80, 12, [2, 4]);
  }
}

export function buildExamCourse(): Spawn {
  setLaneLayout(1);

  const minX = Math.min(ovaloCx, finishX) - 60, maxX = Math.max(rightAveX, entrance.x) + 60;
  const minZ = Math.min(trochaStartZ, topAveZ) - 60, maxZ = Math.max(entrance.z, leftAveBendStartZ) + 60;
  buildGround((minX + maxX) / 2, (minZ + maxZ) / 2, maxX - minX + 120, maxZ - minZ + 120);

  // ---- the óvalo first, so RB.outerR/its arm tips are known below; only E (in, from the top
  // avenue) and S (out, to the left avenue) run long — N and W are capped stubs, same convention
  // world/roundabout.ts's own arm-capping pattern uses elsewhere.
  buildRoundabout({ laneCountPerSide: 1, zebras: 'off' }, {
    cx: ovaloCx, cz: topAveZ, ground: false, buildings: true,
    armLengths: { E: 50, S: 50, N: 40, W: 40 },
  });
  barrier(ovaloCx - (RB.outerR + 40), topAveZ, 2, 10); // cap the unused W arm
  barrier(ovaloCx, topAveZ - (RB.outerR + 40), 10, 2); // cap the unused N arm

  // ---- the two new bends
  buildBend(trocha);
  buildBend(swBend);

  // ---- the four straight avenues
  buildStreet('z', rightAveX, trochaStartZ, entrance.z + 6, 1, []); // entrance -> Trocha bend
  buildStreet('x', topAveZ, armTipE, trocha.cx, 1, []); // Trocha bend -> óvalo's E-arm stub
  buildStreet('z', leftAveX, armTipS, leftAveBendStartZ, 1, []); // óvalo's S-arm stub -> SW bend
  buildStreet('x', bottomAveZ, swBend.cx, finishX + 10, 1, []); // SW bend -> finish

  barrier(rightAveX, entrance.z + 6, 9, 2); // behind the entrance
  barrier(finishX + 10, bottomAveZ, 2, 9); // past the finish gate

  // ---- stop-sign intersection, right after the entrance
  const stopSign = buildStopSign();
  stopSign.position.set(rightAveX + CONFIG.LANE_WIDTH + 1.2, 0, stopLineZ + 1.5); // just before the line (approached from larger z)
  scene.add(stopSign);
  const stopLine = box(CONFIG.LANE_WIDTH, 0.02, 0.35, 0xffffff);
  stopLine.position.set(rightAveX + OWN, 0.113, stopLineZ);
  scene.add(stopLine);

  // ---- pedestrian crossing right after the entrance, its own warning sign
  resetCrosswalks();
  addCrosswalk({ cx: rightAveX, cz: crossingZ, axis: 'x', roadHalf: CONFIG.LANE_WIDTH, walkHalf: CONFIG.LANE_WIDTH + 2.7, build: true });
  flushZebras();
  const pedSign = buildSignPost([{ plate: buildPedestrianWarningPlate(), y: 2.3 }], 2.8);
  pedSign.position.set(rightAveX + CONFIG.LANE_WIDTH + 1.2, 0, entrance.z - 6); // before the crossing (approached from larger z)
  scene.add(pedSign);

  // ---- parallel parking, tucked against the left avenue's kerb (no separate parking lane: a
  // narrow one-lane street, same as world/examCourse.ts's original right-avenue convention, just
  // mirrored onto this kerb)
  const parkCarX = leftKerb + 1.25;
  parkedCar(parkCarX, parallel.frontZ - 2.3, 0);
  parkedCar(parkCarX, parallel.rearZ + 2.3, 0);
  paint(parkCarX - 0.9, parallel.frontZ + 0.1, 2.2, 0.12);
  paint(parkCarX - 0.9, parallel.rearZ - 0.1, 2.2, 0.12);
  paintLetter(parkCarX - 0.9, (parallel.frontZ + parallel.rearZ) / 2, 1.4);
  targetZone(leftKerb, leftAveX - OWN + 0.1, parallel.frontZ + 0.15, parallel.rearZ - 0.15);

  const noParking = buildSignPost([{ plate: buildNoParkingPlate(), y: 2.2 }], 2.6);
  noParking.position.set(leftKerb - 1.2, 0, parallel.rearZ + 14);
  scene.add(noParking);

  // ---- diagonal parking, tucked against the same kerb further along. Unlike the original
  // single-corridor course (a northbound lane, baseline yaw 0), this lane runs southbound
  // (baseline yaw PI), so the bay's own facing is PI + angle, not the original's bare -angle —
  // systems/examCourse.ts and systems/examAutopilot.ts use this exact same expression to stay
  // in sync with however the cars/paint are actually oriented here.
  const { cz: diagCz, angle: bayAngle, pitch } = diagonal;
  const diagCx = leftKerb + 1.0;
  const diagYaw = Math.PI + bayAngle;
  parkedCar(diagCx, diagCz - pitch, diagYaw);
  parkedCar(diagCx, diagCz + pitch, diagYaw);
  paintAngled(diagCx, diagCz - pitch / 2, 5.2, 0.14, diagYaw);
  paintAngled(diagCx, diagCz + pitch / 2, 5.2, 0.14, diagYaw);
  targetZoneAngled(diagCx, diagCz, 2.6, pitch - 0.4, diagYaw);

  // ---- U-turn point, same sign the tutorial course uses
  const uturnSign = buildSignPost([{ plate: buildUTurnPermittedPlate(), y: 2.3 }], 2.7);
  uturnSign.position.set(leftKerb - 1.2, 0, uturnZ + 6);
  scene.add(uturnSign);

  buildFinishGate('x', finishX, bottomAveOwnZ);

  // filler skyline along each straight avenue, skipping the bends/óvalo's own quadrant filler
  scatterAlongZ(rightAveX, trochaStartZ, entrance.z, { z: trochaStartZ, r: 35 });
  scatterAlongX(topAveZ, armTipE, trocha.cx, { x: trocha.cx, r: 35 });
  scatterAlongZ(leftAveX, armTipS, leftAveBendStartZ, { z: leftAveBendStartZ, r: 35 });
  scatterAlongX(bottomAveZ, swBend.cx, finishX, { x: swBend.cx, r: 35 });

  return { x: entrance.x, y: 1.2, z: entrance.z, rotY: 0 };
}
