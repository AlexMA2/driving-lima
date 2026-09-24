import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Draw-call batching. The scenes are built from hundreds of small boxes, each its own mesh with its own
// material, and every mesh costs a draw call in the main view, again in the shadow pass and again in each
// mirror. The GPU handles the triangles easily; what limits the frame rate is the CPU issuing that many
// calls. Meshes that look identical and never change are welded into one mesh, so the same picture is
// drawn with a fraction of the calls.

// Anything carrying one of these flags is changed while the game runs (light colours, blinking lamps,
// animated wheels, a toggled guide), so it is left exactly as it was built.
const KEEP_FLAGS = ['keep', 'lights', 'indicators', 'tailLights', 'wheels'];

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

type StandardMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

function isBatchable(o: THREE.Object3D): o is StandardMesh {
  const mesh = o as THREE.Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };
  if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh || o.children.length) return false;
  const m = mesh.material as THREE.Material | THREE.Material[];
  const g = mesh.geometry;
  if (Array.isArray(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return false;
  const std = m as THREE.MeshStandardMaterial;
  if (std.map || std.alphaMap || std.transparent || std.polygonOffset || !std.depthWrite) return false;
  if (o.layers.mask !== 1 || !o.frustumCulled || o.renderOrder !== 0) return false;
  if (!g.index || !g.attributes.position || !g.attributes.normal || !g.attributes.uv || g.morphAttributes.position) return false;
  return o.matrixWorld.determinant() > 0; // a mirrored mesh has flipped winding, which welding would lose
}

// Meshes that draw identically share a key (and, once welded, one material).
function styleKey(o: StandardMesh): string {
  const m = o.material;
  return [m.color.getHex(), m.roughness, m.metalness, m.emissive.getHex(), m.emissiveIntensity,
    m.side, m.flatShading, o.castShadow, o.receiveShadow].join('|');
}

// Welds `meshes` (all in `root`'s subtree) into one mesh placed in `root`'s local space, using the first
// mesh's material. The originals are removed and their GPU buffers released.
export function weldMeshes<M extends THREE.Material>(
  meshes: Array<THREE.Mesh<THREE.BufferGeometry, M>>,
  root: THREE.Object3D,
): THREE.Mesh<THREE.BufferGeometry, M> | null {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const geometries = meshes.map(o => {
    const g = o.geometry.clone();
    g.applyMatrix4(_rel.multiplyMatrices(_inv, o.matrixWorld));
    return g;
  });
  const merged = mergeGeometries(geometries, false);
  geometries.forEach(g => g.dispose());
  if (!merged) return null;

  const first = meshes[0];
  const out = new THREE.Mesh(merged, first.material);
  out.castShadow = first.castShadow;
  out.receiveShadow = first.receiveShadow;
  out.matrixAutoUpdate = false; // welded parts sit still relative to their parent: no per-frame matrix work
  root.add(out);

  const disposed = new Set<unknown>();
  meshes.forEach(o => {
    o.parent?.remove(o);
    if (!disposed.has(o.geometry)) { o.geometry.dispose(); disposed.add(o.geometry); }
    if (o.material !== first.material && !disposed.has(o.material)) { o.material.dispose(); disposed.add(o.material); }
  });
  return out;
}

export interface BatchOptions {
  cell?: number;
  protect?: Set<THREE.Object3D> | null;
}

// Welds every batchable mesh under `root`, except what sits in a KEEP_FLAGS subtree or in `protect`.
// `cell` (metres) splits the welding by area, so a long street becomes many chunks that can still be
// culled when off screen; without it everything alike under `root` becomes a single mesh.
export function batchStatic(root: THREE.Object3D, { cell = 0, protect = null }: BatchOptions = {}): number {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, StandardMesh[]>();
  const pos = new THREE.Vector3();

  const visit = (o: THREE.Object3D): void => {
    if ((o as THREE.Camera).isCamera || !o.visible || (protect && protect.has(o)) || KEEP_FLAGS.some(k => o.userData[k])) return;
    if (isBatchable(o)) {
      let key = styleKey(o);
      if (cell > 0) {
        pos.setFromMatrixPosition(o.matrixWorld);
        key += `|${Math.floor(pos.x / cell)},${Math.floor(pos.z / cell)}`;
      }
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = []);
      bucket.push(o);
    }
    o.children.forEach(visit);
  };
  root.children.slice().forEach(visit);

  let welded = 0;
  buckets.forEach(list => {
    if (list.length < 2) return;
    if (weldMeshes(list, root)) welded += list.length;
  });
  return welded;
}
