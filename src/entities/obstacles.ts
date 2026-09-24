// Stalled vehicles currently blocking a lane (see entities/breakdowns.ts). Kept in its own
// module so the traffic AI can route around them without importing the module that spawns them.
// Each entry: { x, z, halfZ, halfX, mesh, body, cones }
import type * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import type { VehicleParts } from '../assets/vehicles';

export interface StalledVehicle {
  x: number;
  z: number;
  halfZ: number;
  halfX: number;
  mesh: THREE.Object3D & { userData: VehicleParts };
  body: CANNON.Body;
  cones: THREE.Object3D[];
}
export const stalledVehicles: StalledVehicle[] = [];
