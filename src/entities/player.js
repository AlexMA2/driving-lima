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

// spawn: { x, z, rotY } — each scenario builder computes where the player starts.
export function createPlayer(spawn) {
  const chassisShape = new CANNON.Box(new CANNON.Vec3(0.95, 0.4, 2.2));
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
    frictionSlip: 1.5,
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
  wheelOptions.chassisConnectionPointLocal.set(AXLE_WIDTH, 0, -1.55); vehicle.addWheel({ ...wheelOptions }); // 0 front-left (steer)
  wheelOptions.chassisConnectionPointLocal.set(-AXLE_WIDTH, 0, -1.55); vehicle.addWheel({ ...wheelOptions }); // 1 front-right (steer)
  wheelOptions.chassisConnectionPointLocal.set(AXLE_WIDTH, 0, 1.35); vehicle.addWheel({ ...wheelOptions });  // 2 rear-left (drive)
  wheelOptions.chassisConnectionPointLocal.set(-AXLE_WIDTH, 0, 1.35); vehicle.addWheel({ ...wheelOptions }); // 3 rear-right (drive)
  vehicle.addToWorld(world);

  playerMesh = buildSedan(0x1565c0);
  playerMesh.castShadow = true;
  // First-person cockpit camera sits inside this mesh's solid cabin geometry — put the whole
  // car on layer 1 so the driver's own camera (layer 0 only) doesn't see it from the inside;
  // the mirror cameras explicitly opt into layer 1 so the car still shows up behind/beside you.
  playerMesh.traverse(o => o.layers.set(1));
  scene.add(playerMesh);
  playerWheelMeshes = playerMesh.userData.wheels; // [FL, FR, RL, RR] matches wheelInfos order above
}

export function syncPlayerMesh() {
  playerMesh.position.copy(chassisBody.position);
  playerMesh.quaternion.copy(chassisBody.quaternion);
  for (let i = 0; i < 4; i++) {
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    playerWheelMeshes[i].position.copy(t.position);
    playerWheelMeshes[i].quaternion.copy(t.quaternion);
  }
}
