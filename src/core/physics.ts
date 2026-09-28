import * as CANNON from 'cannon-es';

export const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.defaultContactMaterial.friction = 0.35;
world.allowSleep = false;

export const groundMaterial = new CANNON.Material('ground');
export const wheelMaterial = new CANNON.Material('wheel');
export const vehicleMaterial = new CANNON.Material('vehicle');
export const propMaterial = new CANNON.Material('prop');

world.addContactMaterial(new CANNON.ContactMaterial(groundMaterial, wheelMaterial, {
  friction: 0.32, restitution: 0, contactEquationStiffness: 1000,
}));
world.addContactMaterial(new CANNON.ContactMaterial(vehicleMaterial, propMaterial, {
  // Softer than cannon-es's very stiff default (1e7/3): AI cars are kinematic and the player
  // can close on them fast (a rear-end, or being cut off from the side), so the boxes often
  // start a step already deeply overlapped. At default stiffness the penetration-correction
  // impulse is enormous, launching the chassis skyward or flinging it sideways across the
  // road — this keeps the same push but spread over more of a step instead of one shove.
  friction: 0.3, restitution: 0.15, contactEquationStiffness: 1000, contactEquationRelaxation: 4,
}));
