import * as THREE from 'three';
import { CONFIG } from '../config';
import { scene } from '../core/scene';
import { box, cyl } from '../assets/primitives';
import { buildTrafficLightPole, buildStopSign, buildUTurnPermittedPlate, buildNoUTurnPlate, buildSignPost, type TrafficLightLamps } from '../assets/props';
import type { Spawn } from '../entities/player';
import type { LightState } from './intersections';
import { buildGround, buildStreet, barrier, scatterBlockBuildings, updateLightMesh } from './streetKit';
import { setLaneLayout } from './road';
import { buildRoundabout } from './roundabout';
import { SPEED_BUMPS, buildSpeedBumps } from './speedBumps';
import { addCrosswalk, flushZebras } from './crosswalks';

// The tutorial course: one fixed route, nothing random. Seen from above (north = -Z):
//
//   start (z=+70) -> straight avenue A (2 lanes each way) with a speed bump, a zebra and a
//   stalled car -> traffic-light T-junction with cross street B at z=-610 -> turn right, east
//   along B -> STOP sign at the crossing with C (x=300) -> turn left onto C -> roundabout
//   at (300, -850) -> leave by any exit but the one you came in by (the 2nd exit is ahead).
//
// Every coordinate the tutorial script needs lives in COURSE.
export const COURSE = {
  lanes: { left: 1.75, right: 5.25 },
  start: { x: 5.25, z: 70 },
  driveGateZ: -90,
  bumpZ: -205,
  zebraZ: -275,
  hazardTriggerZ: -340,
  stalledZ: -430,
  uturnZ: -510,                            // marked U-turn point, between the stalled car and the light
  light: { z: -610, stopZ: -598 },        // I1: cross street B centre line and the north-bound stop line
  stop: { lineX: 289.5, laneZ: -608.25 }, // STOP line on B, east-bound lane
  ring: { cx: 300, cz: -850 },
  finishZ: -940,
};

let trafficLight: TrafficLightLamps | null = null;

// Sets the tutorial traffic light ('GREEN' | 'YELLOW' | 'RED').
export function setTutorialLight(state: LightState): void {
  if (trafficLight) updateLightMesh(trafficLight, state);
}

function buildFinishGantry(x: number, z: number): void {
  [-7, 7].forEach(dx => {
    const p = cyl(0.25, 0.25, 7, 0x444444, 8); p.position.set(x + dx, 3.5, z);
    scene.add(p);
  });
  const cvs = document.createElement('canvas'); cvs.width = 512; cvs.height = 96;
  const ctx = cvs.getContext('2d')!;
  const size = 48;
  for (let i = 0; i < 512 / size; i++) for (let j = 0; j < 2; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
    ctx.fillRect(i * size, j * size, size, size);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(96, 22, 320, 52);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('META', 256, 48);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(14, 1.5, 0.15), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cvs) }));
  banner.position.set(x, 6.6, z);
  scene.add(banner);
}

export function buildTutorialCourse(): Spawn {
  const { light, stop, ring } = COURSE;
  setLaneLayout(2); // avenue lanes: x = ±1.75 (inner) and ±5.25 (outer)

  buildGround(200, -450, 1000, 1500);

  // ---- streets. Avenue A is wider than B, so both are given two crossing points: each pair
  // opens a curb gap as wide as the other street, plus generous corners for turning.
  buildStreet('z', 0, light.z - 12, 110, 2, [light.z + 4, light.z - 4]); // avenue A
  buildStreet('x', light.z, -10, 440, 1, [-3.5, 3.5, ring.cx]);         // cross street B
  buildRoundabout({ laneCountPerSide: 1, zebras: 'off' }, {
    cx: ring.cx, cz: ring.cz, ground: false, buildings: false,
    armLengths: { S: 240, N: 110, E: 110, W: 110 },
    armCrossings: { S: [light.z] },                                      // arm S doubles as street C
  });

  // dead ends
  barrier(0, 113, 22, 2);                    // behind the start
  barrier(0, light.z - 14, 22, 2);           // north end of the avenue
  barrier(-11.5, light.z, 2, 30);            // west end of B
  barrier(442, light.z, 2, 14);              // east end of B
  barrier(ring.cx, light.z + 20, 14, 2);     // south stub of C
  barrier(ring.cx + 132, ring.cz, 2, 10);    // east arm
  barrier(ring.cx - 132, ring.cz, 2, 10);    // west arm
  barrier(ring.cx, ring.cz - 132, 10, 2);    // north arm

  // A "no U-turn" sign near the start, for contrast with the "U-turn permitted" one further
  // down the avenue (COURSE.uturnZ) — the lesson is that it's only legal where marked.
  const noUturnSign = buildSignPost([{ plate: buildNoUTurnPlate(), y: 2.3 }], 2.7);
  noUturnSign.position.set(7.3, 0, 50);
  scene.add(noUturnSign);

  // ---- lesson furniture
  SPEED_BUMPS.length = 0;
  SPEED_BUMPS.push({ z: COURSE.bumpZ, width: CONFIG.LANE_WIDTH * 4 - 0.4, triggered: false });
  buildSpeedBumps();

  addCrosswalk({ cx: 0, cz: COURSE.zebraZ, axis: 'x', roadHalf: 7, walkHalf: 7 + CONFIG.SIDEWALK_WIDTH - 0.3, sign: true });
  flushZebras();

  // traffic light + stop line for the north-bound lanes at the T-junction
  const stopLine = box(7, 0.02, 0.35, 0xffffff); stopLine.position.set(3.5, 0.113, light.stopZ + 0.6);
  scene.add(stopLine);
  const pole = buildTrafficLightPole(true);
  pole.position.set(7.3, 0, light.stopZ + 1.1);
  pole.rotation.y = Math.PI;
  scene.add(pole);
  trafficLight = pole.userData.lights as TrafficLightLamps;
  setTutorialLight('GREEN');

  // "Retorno permitido" sign marking the U-turn lesson's spot, on the near kerb — the plate
  // faces +Z by default (see props.ts), which is exactly what a driver approaching from the
  // south (larger z, heading north) needs, so it's planted here with no extra rotation.
  const uturnSign = buildSignPost([{ plate: buildUTurnPermittedPlate(), y: 2.3 }], 2.7);
  uturnSign.position.set(7.3, 0, COURSE.uturnZ + 6);
  scene.add(uturnSign);

  // STOP sign and line for the east-bound lane of B, before the crossing with C
  const sign = buildStopSign();
  sign.position.set(stop.lineX - 1.5, 0, light.z + 5);
  sign.rotation.y = -Math.PI / 2; // face the driver coming from the west
  scene.add(sign);
  const line = box(0.4, 0.02, 3.5, 0xffffff);
  line.position.set(stop.lineX, 0.113, light.z + 1.75);
  scene.add(line);

  buildFinishGantry(ring.cx, COURSE.finishZ);

  // ---- skyline: blocks along the avenue, along B and around the roundabout
  for (let z = 100; z > -470; z -= 80) {
    scatterBlockBuildings(-56, z, 80, 12, [2, 4]);
    scatterBlockBuildings(56, z, 80, 12, [2, 4]);
  }
  for (let x = 70; x < 440; x += 80) {
    if (Math.abs(x - ring.cx) < 60) continue;
    scatterBlockBuildings(x, light.z - 52, 80, 11, [2, 4]);
    if (x > 90) scatterBlockBuildings(x, light.z + 52, 80, 11, [2, 4]);
  }
  [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
    scatterBlockBuildings(ring.cx + sx * 130, ring.cz + sz * 130, 200, 30, [5, 9]);
  });

  return { x: COURSE.start.x, y: 1.2, z: COURSE.start.z, rotY: 0 };
}
