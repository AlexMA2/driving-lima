import type * as THREE from 'three';
import type * as CANNON from 'cannon-es';

// cannon-es and three.js describe vectors and rotations with structurally different classes that share
// x/y/z(/w), so values are copied across by component instead of through `.copy()`.

export function setFromCannonVec(target: THREE.Vector3, v: CANNON.Vec3): THREE.Vector3 {
  return target.set(v.x, v.y, v.z);
}

export function distanceBetween(a: CANNON.Vec3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function setFromCannonQuat(target: THREE.Quaternion, q: CANNON.Quaternion): THREE.Quaternion {
  return target.set(q.x, q.y, q.z, q.w);
}
