import * as THREE from 'three';
import { CHASSIS_REST_Y } from './player';

// Where things sit inside the player's car. Positions are car-local (x right, y up from the
// chassis centre, -z toward the nose); heights are given above the road and converted.
// Shared by the camera rig (which places the eye and the mirror cameras) and the cockpit model
// (which draws the dashboard around that same eye), so the two can never drift apart.

// Render layers: 0 = the world, 1 = the player's own car (only the mirrors see it),
// 2 = the cockpit (only the driver's eye sees it).
export const LAYER_PLAYER_CAR = 1;
export const LAYER_COCKPIT = 2;

const aboveRoad = (h: number): number => h - CHASSIS_REST_Y;

// Driver's eye: LHD seat, left of the centreline, a little behind the mid-point of the cabin.
export const EYE_HEIGHT = 1.05;
export const EYE_IN_CAR = new THREE.Vector3(-0.38, aboveRoad(EYE_HEIGHT), -0.25);

// Mirror glass centres: the wing mirrors sit on the door skin at the front of each door (just
// outside the body, which is 0.95 half-width), the interior mirror hangs at the centre of the
// windscreen header.
export const MIRROR_POS = {
  rear: new THREE.Vector3(0, aboveRoad(1.2), -0.75),
  left: new THREE.Vector3(-1.05, aboveRoad(0.9), -1.0),
  right: new THREE.Vector3(1.05, aboveRoad(0.9), -1.0),
};

// Where each mirror is aimed (car-local, need not be normalised). The wing mirrors look
// backwards, slightly outward and down at the ground beside the rear wheels, leaving a sliver of
// the car's own flank in view at the inner edge — the classic reference for judging the
// distance to lines and kerbs.
export const MIRROR_AIM = {
  rear: new THREE.Vector3(0, -0.03, 1).normalize(),
  left: new THREE.Vector3(-0.26, -0.17, 1).normalize(),
  right: new THREE.Vector3(0.26, -0.17, 1).normalize(),
};

// car-local point -> camera space (the camera sits at the eye, so this is just a shift; the
// small downward camera pitch is ignored)
export const toCameraSpace = (carLocal: THREE.Vector3): THREE.Vector3 => carLocal.clone().sub(EYE_IN_CAR);
