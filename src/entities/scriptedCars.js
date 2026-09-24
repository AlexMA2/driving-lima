import * as THREE from 'three';
import { createTrafficVehicle, placeTrafficVehicle, removeTrafficVehicle } from './aiVehicles.js';
import { chassisBody } from './player.js';

// Cars whose entire behaviour is decided by the tutorial script: they spawn exactly when and
// where the lesson says, then drive straight up the avenue (toward -Z) at a set speed. Unlike
// the random traffic there is no state machine — only a safety rule so a scripted car never
// drives through the player when it catches up with them in the same lane.
export const scriptedCars = [];

export function spawnScriptedCar({ x, z, speed, type = 'car' }) {
  const v = createTrafficVehicle(type);
  const car = { ...v, x, z, speed, cruise: speed };
  placeTrafficVehicle(car, x, z, 0, -1, speed);
  scriptedCars.push(car);
  return car;
}

export function updateScriptedCars(dt) {
  const p = chassisBody.position;
  const playerSpeed = chassisBody.velocity.length();

  for (let i = scriptedCars.length - 1; i >= 0; i--) {
    const car = scriptedCars[i];
    let target = car.cruise;
    // ease off when the player is ahead of us in our own lane
    if (p.z < car.z && Math.abs(p.x - car.x) < 2) {
      const gap = car.z - p.z - 4.4;
      if (gap < 14) target = Math.min(target, playerSpeed * THREE.MathUtils.clamp((gap - 2) / 12, 0, 1));
    }
    car.speed += THREE.MathUtils.clamp(target - car.speed, -8 * dt, 3 * dt);
    car.z -= car.speed * dt;
    placeTrafficVehicle(car, car.x, car.z, 0, -1, car.speed);
    car.mesh.userData.tailLights?.forEach(t => { t.material.emissiveIntensity = target < car.cruise - 0.5 ? 0.9 : 0.3; });

    if (car.z < p.z - 350 || car.z > p.z + 300) {
      removeTrafficVehicle(car);
      scriptedCars.splice(i, 1);
    }
  }
}

export function clearScriptedCars() {
  scriptedCars.forEach(removeTrafficVehicle);
  scriptedCars.length = 0;
}
