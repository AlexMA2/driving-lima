import * as CANNON from 'cannon-es';
import { chassisBody, vehicle, carYaw } from '../entities/player';
import { logEvent } from './debugLog';

// The car must ALWAYS be drivable. A hard crash can leave it on its side or roof, perched on a bumper with its
// wheels in the air, or (rarely) with a broken physics state — the raycast wheels only push against the ground
// when they are pointing at it, so in any of those the throttle and steering would do nothing. Instead of leaving
// the player stuck, the car is put back on its wheels, where the crash happened.

const TILT_LIMIT = 0.6;       // chassis up-vector · world up below this (~53° of lean) counts as flipped; driving over a curb stays far above it
const FLIPPED_AFTER = 0.7;    // seconds spent flipped before the car is righted (long enough to not fight a bump)
const STRANDED_AFTER = 1.5;   // seconds with no wheel touching anything (and not on the way up or down) before it is set back down
const LOW_Y = 0.2;            // a chassis centre this close to the road means it is embedded in it (it rests at ~0.65)
const HIGH_Y = 6;             // ...and this far above it, launched off something
const DROP_HEIGHT = 1.0;      // where a recovered car is put back: just above the road, the suspension does the rest
const MAX_SPEED = 60;         // m/s; anything beyond this is a physics glitch, not driving
const MAX_SPIN = 12;          // rad/s

const _up = new CANNON.Vec3(0, 1, 0);
const _carUp = new CANNON.Vec3();
const _nose = new CANNON.Vec3(0, 0, -1); // the car's own front, as in entities/player.ts
const _noseDir = new CANNON.Vec3();

// Where the car last was sitting properly on its wheels: the place to go back to if it ends up somewhere it cannot drive from.
const lastGood = { x: 0, z: 0, yaw: 0, valid: false };
let flippedFor = 0;
let strandedFor = 0;

function isFinitePose(): boolean {
  const { position: p, velocity: v, angularVelocity: w, quaternion: q } = chassisBody;
  return [p.x, p.y, p.z, v.x, v.y, v.z, w.x, w.y, w.z, q.x, q.y, q.z, q.w].every(Number.isFinite);
}

function wheelsOnGround(): number {
  return vehicle.wheelInfos.filter(w => w.isInContact).length;
}

// Puts the car upright at (x, z) facing `yaw`, keeping a fraction of its speed: whatever hit it took most of it anyway.
function setDown(x: number, z: number, yaw: number, reason: string, keepVelocity: boolean): void {
  const { velocity: v } = chassisBody;
  const keep = keepVelocity && isFinitePose() ? 0.3 : 0;
  chassisBody.position.set(x, DROP_HEIGHT, z);
  chassisBody.quaternion.setFromEuler(0, yaw, 0);
  chassisBody.velocity.set(v.x * keep, 0, v.z * keep);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.force.set(0, 0, 0);
  chassisBody.torque.set(0, 0, 0);
  flippedFor = 0;
  strandedFor = 0;
  logEvent('CAR_RECOVERED', { reason, x, z, yaw });
}

// Call once per frame, right after the physics step.
export function keepCarDrivable(dt: number): void {
  if (!isFinitePose()) {
    // a NaN in the body never heals by itself (and poisons the camera and the mirrors with it)
    if (lastGood.valid) setDown(lastGood.x, lastGood.z, lastGood.yaw, 'invalid_state', false);
    return;
  }

  const { position: p, velocity: v, angularVelocity: w } = chassisBody;

  // a wild spin or speed is what a collision with a kinematic body can throw the chassis into: rein it in
  const speed = v.length();
  if (speed > MAX_SPEED) v.scale(MAX_SPEED / speed, v);
  const spin = w.length();
  if (spin > MAX_SPIN) w.scale(MAX_SPIN / spin, w);

  chassisBody.quaternion.vmult(_up, _carUp);
  const upright = _carUp.y;
  const grounded = wheelsOnGround();

  if (upright > 0.9 && grounded >= 3 && p.y > LOW_Y) {
    lastGood.x = p.x; lastGood.z = p.z; lastGood.yaw = carYaw(); lastGood.valid = true;
  }

  // Fell through the road, or was thrown far above it.
  if ((p.y < LOW_Y || p.y > HIGH_Y) && lastGood.valid) {
    setDown(lastGood.x, lastGood.z, lastGood.yaw, 'out_of_bounds', false);
    return;
  }

  // On its side or its roof: back on the wheels, facing the way the nose points along the ground (or the way it
  // last drove when the nose is pointing straight up or down and says nothing about it).
  flippedFor = upright < TILT_LIMIT ? flippedFor + dt : 0;
  if (flippedFor > FLIPPED_AFTER) {
    chassisBody.quaternion.vmult(_nose, _noseDir);
    const yaw = Math.hypot(_noseDir.x, _noseDir.z) > 0.3 ? Math.atan2(-_noseDir.x, -_noseDir.z) : lastGood.yaw;
    setDown(p.x, p.z, yaw, 'flipped', true);
    return;
  }

  // Wheels in the air while barely moving up or down (perched on something): put it back where it was last on the road.
  strandedFor = grounded === 0 && Math.abs(v.y) < 1 ? strandedFor + dt : 0;
  if (strandedFor > STRANDED_AFTER && lastGood.valid) setDown(lastGood.x, lastGood.z, lastGood.yaw, 'stranded', false);
}
