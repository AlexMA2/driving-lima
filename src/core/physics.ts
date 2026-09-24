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
  friction: 0.3, restitution: 0.15,
}));
