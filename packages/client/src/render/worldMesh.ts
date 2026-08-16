import * as THREE from 'three';
import { CHUNK } from '@mineshoot/shared';
import type { World } from '@mineshoot/shared';
import { createAtlasTexture } from './atlas';
import { meshRegion } from './mesher';

/** Builds one static mesh per 16×sy×16 chunk. Returns a group + dispose. */
export function buildWorldMeshes(world: World): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const texture = createAtlasTexture();
  const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
  const geometries: THREE.BufferGeometry[] = [];

  for (let cz = 0; cz < world.sz; cz += CHUNK) {
    for (let cx = 0; cx < world.sx; cx += CHUNK) {
      const m = meshRegion(world, cx, Math.min(cx + CHUNK, world.sx), cz, Math.min(cz + CHUNK, world.sz));
      if (m.faceCount === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(m.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
      geo.computeBoundingSphere();
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = true;
      group.add(mesh);
    }
  }

  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
