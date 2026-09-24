import * as THREE from 'three';

export interface BoxOptions {
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
}

export type StdMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

export function box(w: number, h: number, d: number, color: THREE.ColorRepresentation, opts: BoxOptions = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function cyl(rt: number, rb: number, h: number, color: THREE.ColorRepresentation, radialSegments = 10) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(rt, rb, h, radialSegments),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  );
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
