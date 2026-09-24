import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { scene } from '../core/scene.js';
import { world, vehicleMaterial } from '../core/physics.js';
import { buildSedan } from '../assets/vehicles.js';

// Populated by createPlayer(); other modules import these as live bindings and only
// touch them from inside functions that run after createPlayer() has executed.
export let chassisBody;
export let vehicle;
export let playerMesh;
export let playerWheelMeshes;

// The chassis box's centre rides this high above the road once the suspension has settled
// (wheel radius 0.4 + suspension length ~0.25). The car models are authored with y=0 at road level, so
// the player's mesh is dropped by this much, and eye/mirror heights are given above the road
// and converted with it (see entities/cabin.js).
export const CHASSIS_REST_Y = 0.65;

// The body's footprint (half extents in metres) — parking uses the same numbers the physics does.
export const CAR_HALF_WIDTH = 0.95;
export const CAR_HALF_LENGTH = 2.3;

// spawn: { x, z, rotY } — each scenario builder computes where the player starts.
export function createPlayer(spawn) {
  const chassisShape = new CANNON.Box(new CANNON.Vec3(CAR_HALF_WIDTH, 0.4, CAR_HALF_LENGTH));
  chassisBody = new CANNON.Body({ mass: 155, material: vehicleMaterial });
  chassisBody.addShape(chassisShape);
  chassisBody.position.set(spawn.x, 1.2, spawn.z);
  chassisBody.quaternion.setFromEuler(0, spawn.rotY || 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.angularDamping = 0.6; // keeps the chassis from tumbling/spinning out at high speed
  chassisBody.linearDamping = 0.02;
  chassisBody.userData = { isPenalized: false, type: 'player' };

  vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
  });

  const wheelOptions = {
    radius: 0.4,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 32,
    suspensionRestLength: 0.32,
    frictionSlip: 3.4,
    dampingRelaxation: 2.4,
    dampingCompression: 4.5,
    maxSuspensionForce: 100000,
    rollInfluence: 0.015,
    axleLocal: new CANNON.Vec3(1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(1, 0, 1),
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };

  const AXLE_WIDTH = 0.85;
  wheelOptions.chassisConnectionPointLocal.set(AXLE_WIDTH, 0, -1.55); vehicle.addWheel({ ...wheelOptions }); // 0 front-right (steer)
  wheelOptions.chassisConnectionPointLocal.set(-AXLE_WIDTH, 0, -1.55); vehicle.addWheel({ ...wheelOptions }); // 1 front-left (steer)
  wheelOptions.chassisConnectionPointLocal.set(AXLE_WIDTH, 0, 1.35); vehicle.addWheel({ ...wheelOptions });  // 2 rear-right (drive)
  wheelOptions.chassisConnectionPointLocal.set(-AXLE_WIDTH, 0, 1.35); vehicle.addWheel({ ...wheelOptions }); // 3 rear-left (drive)
  vehicle.addToWorld(world);

  playerMesh = buildSedan(0x1565c0);
  playerMesh.castShadow = true;
  // First-person cockpit camera sits inside this mesh's solid cabin geometry — put the whole
  // car on layer 1 so the driver's own camera (layer 0 only) doesn't see it from the inside;
  // the mirror cameras explicitly opt into layer 1 so the car still shows up behind/beside you.
  playerWheelMeshes = playerMesh.userData.wheels; // [FR, FL, RR, RL] matches wheelInfos order above
  // The wheels are placed from the physics' *world* wheel transforms, so they live in the scene
  // itself rather than inside the (moving) body mesh.
  playerWheelMeshes.forEach(w => { playerMesh.remove(w); scene.add(w); });
  playerMesh.traverse(o => o.layers.set(1));
  playerWheelMeshes.forEach(w => w.traverse(o => o.layers.set(1)));
  scene.add(playerMesh);
}

const _drop = new THREE.Vector3();

export function syncPlayerMesh() {
  // The body mesh's origin is the road under the chassis centre, not the centre itself.
  _drop.set(0, -CHASSIS_REST_Y, 0).applyQuaternion(chassisBody.quaternion);
  playerMesh.position.copy(chassisBody.position).add(_drop);
  playerMesh.quaternion.copy(chassisBody.quaternion);
  for (let i = 0; i < 4; i++) {
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    playerWheelMeshes[i].position.copy(t.position);
    playerWheelMeshes[i].quaternion.copy(t.quaternion);
  }
}

const _fwd = new CANNON.Vec3();
const _local = new CANNON.Vec3(0, 0, -1);

// Signed speed along the car's own nose in m/s: positive rolling forward, negative reversing.
export function forwardSpeed() {
  chassisBody.quaternion.vmult(_local, _fwd);
  return chassisBody.velocity.dot(_fwd);
}

// Heading of the nose on the ground plane in radians (three.js rotation.y convention):
// 0 = pointing toward -Z, positive = turned toward -X.
export function carYaw() {
  chassisBody.quaternion.vmult(_local, _fwd);
  return Math.atan2(-_fwd.x, -_fwd.z);
}
