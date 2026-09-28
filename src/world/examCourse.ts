import { box } from '../assets/primitives';
import { scene } from '../core/scene';
import { buildStopSign, buildNoParkingPlate, buildPedestrianWarningPlate, buildUTurnPermittedPlate, buildSignPost } from '../assets/props';
import { buildGround, buildStreet, barrier, scatterBlockBuildings } from './streetKit';
import { setLaneLayout } from './road';
import { buildRoundabout, RB } from './roundabout';
import { addCrosswalk, flushZebras, resetCrosswalks } from './crosswalks';
import { parkedCar, paint, paintAngled, paintLetter, targetZone, targetZoneAngled } from './parkingLot';
import type { Spawn } from '../entities/player';

// The "Examen Oficial MTC" circuit: one fixed route modelled on Lima's real Touring Conchán
// practical-exam course (confirmed by web search — see the plan doc) — a single-lane loop
// chaining a stop-sign intersection, a kerbside parallel-parking bay, a roundabout ("óvalo"), a
// speed-demonstration straight, a kerbside diagonal-parking bay and a U-turn, in that order.
// North is -Z throughout, same convention as every other course.
export const COURSE = {
  ownLane: 1.75,
  kerbX: 3.5,      // this course runs a single lane each way, so the kerb IS the road's own edge
  start: { x: 1.75, z: 82 },
  stopLineZ: 42,
  parallel: { frontZ: -5, rearZ: 2.5 },      // the framing cars' reference bumpers (see parkingLot.ts's comment on the same idea)
  ring: { cx: 0, cz: -90 },
  speedGateZ: -180,
  diagonal: { cz: -215, angle: Math.PI / 4, pitch: 4.6 },
  uturnZ: -250,
  finishZ: -282,
};

function buildFinishGate(x: number, z: number): void {
  [-4.5, 4.5].forEach(dx => {
    const post = box(0.3, 3.6, 0.3, 0x444444);
    post.position.set(x + dx, 1.8, z);
    scene.add(post);
  });
  const banner = box(9.6, 0.8, 0.15, 0x2ecc71);
  banner.position.set(x, 3.6, z);
  scene.add(banner);
}

export function buildExamCourse(): Spawn {
  setLaneLayout(1);
  const { start, stopLineZ, parallel, ring, diagonal, uturnZ, finishZ, kerbX, ownLane } = COURSE;

  buildGround(ring.cx, (start.z + finishZ) / 2, 260, start.z - finishZ + 200);

  // ---- the roundabout first, so its arms' actual tip coordinates are known below
  buildRoundabout({ laneCountPerSide: 1, zebras: 'off' }, {
    cx: ring.cx, cz: ring.cz, ground: false, buildings: false,
    armLengths: { S: 50, N: 40, E: 40, W: 40 },
  });
  barrier(ring.cx + RB.outerR + 40, ring.cz, 2, 10); // cap the E stub
  barrier(ring.cx - RB.outerR - 40, ring.cz, 2, 10); // cap the W stub

  const avenue1End = ring.cz + RB.outerR + 50; // the S arm's own outer tip
  buildStreet('z', 0, avenue1End, start.z, 1, []);
  const avenue2Start = ring.cz - RB.outerR - 40; // the N arm's own outer tip
  buildStreet('z', 0, finishZ - 10, avenue2Start, 1, []);

  barrier(0, start.z + 3, 22, 2);
  barrier(0, finishZ - 10, 22, 2);

  // ---- stop-sign intersection
  const stopSign = buildStopSign();
  stopSign.position.set(kerbX + 1.2, 0, stopLineZ + 1.5); // just before the line (approached from larger z)
  scene.add(stopSign);
  const stopLine = box(kerbX, 0.02, 0.35, 0xffffff);
  stopLine.position.set(kerbX / 2, 0.113, stopLineZ);
  scene.add(stopLine);

  // ---- parallel parking, tucked against the kerb of avenue 1 (no separate parking lane: this
  // is a narrow one-lane street, so you park in the lane itself, same as many streets in Lima)
  const carX = kerbX - 0.3 - 0.95;
  parkedCar(carX, parallel.frontZ - 2.3, 0);
  parkedCar(carX, parallel.rearZ + 2.3, 0);
  paint(carX + 0.9, parallel.frontZ + 0.1, kerbX - 1.3, 0.12);
  paint(carX + 0.9, parallel.rearZ - 0.1, kerbX - 1.3, 0.12);
  paintLetter(carX + 0.9, (parallel.frontZ + parallel.rearZ) / 2, 1.4);
  targetZone(ownLane - 0.1, kerbX, parallel.frontZ + 0.15, parallel.rearZ - 0.15);

  const noParking = buildSignPost([{ plate: buildNoParkingPlate(), y: 2.2 }], 2.6);
  noParking.position.set(kerbX + 1.2, 0, parallel.rearZ + 14);
  scene.add(noParking);

  // ---- pedestrian crossing right after the start, its own warning sign (item 6's diamond plate)
  resetCrosswalks();
  addCrosswalk({ cx: 0, cz: start.z - 12, axis: 'x', roadHalf: kerbX, walkHalf: kerbX + 2.7, build: true });
  flushZebras();
  const pedSign = buildSignPost([{ plate: buildPedestrianWarningPlate(), y: 2.3 }], 2.8);
  pedSign.position.set(kerbX + 1.2, 0, start.z - 6); // before the crossing (approached from larger z)
  scene.add(pedSign);

  // ---- diagonal parking, tucked against the kerb of avenue 2 the same way
  const { cz: diagCz, angle: bayAngle, pitch } = diagonal;
  const diagCx = kerbX - 1.0;
  parkedCar(diagCx, diagCz - pitch, -bayAngle);
  parkedCar(diagCx, diagCz + pitch, -bayAngle);
  paintAngled(diagCx, diagCz - pitch / 2, 5.2, 0.14, -bayAngle);
  paintAngled(diagCx, diagCz + pitch / 2, 5.2, 0.14, -bayAngle);
  targetZoneAngled(diagCx, diagCz, 2.6, pitch - 0.4, -bayAngle);

  // ---- U-turn point, same sign the tutorial course uses
  const uturnSign = buildSignPost([{ plate: buildUTurnPermittedPlate(), y: 2.3 }], 2.7);
  uturnSign.position.set(kerbX + 1.2, 0, uturnZ + 6);
  scene.add(uturnSign);

  buildFinishGate(0, finishZ);

  scatterBlockBuildings(kerbX + 3 + 40, (start.z + finishZ) / 2, start.z - finishZ + 40, 10, [6, 12]);
  scatterBlockBuildings(-kerbX - 3 - 40, (start.z + finishZ) / 2, start.z - finishZ + 40, 10, [6, 12]);

  return { x: start.x, y: 1.2, z: start.z, rotY: 0 };
}
