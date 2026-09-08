// The globe's mesh. Pure geometry: it knows nothing about elevation data,
// which body it is drawing, or how the surface is coloured -- the caller
// supplies a radius for each point, and both the terrain and the sea
// surface are built from this same function.
//
// This replaces the UV sphere (THREE.SphereGeometry) that V0.1-V0.5 used.
// A UV sphere has a genuine singularity at each pole: every vertex of its
// top and bottom ring sits at the *same* 3D point while carrying different
// longitudes, and the rings just below are crushed together
// circumferentially. That is what produced the radial streaks the user kept
// seeing -- a fan of sliver triangles each smearing a different column of
// the map across a wedge, plus wildly different elevation samples between
// vertices millimetres apart. Smoothing the source data only ever hid it.
//
// A spherified cube has no pole at all: six ordinary grids, every quad
// roughly the same size everywhere on the globe, no vertex shared by a
// whole ring. The poles land in the middle of an ordinary quad on the +Y
// and -Y faces and get no special treatment whatsoever.
import * as THREE from "three";
import { directionToLngLat } from "./geoConvert.js";

// [forward, right, up] per face, chosen so right x up === forward on all
// six. That makes one single winding order come out front-facing (outward)
// everywhere, with no per-face special cases.
const CUBE_FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

// Plain normalisation of an evenly-spaced cube grid bunches vertices up
// towards the face corners. Warping each axis through tan() first spreads
// them almost evenly over the sphere, which is the whole point of using a
// cube-sphere here.
function warpAxis(t) {
  return Math.tan(t * (Math.PI / 4));
}

// `segments` must be **odd**: with an even count a vertex lands exactly on
// the centre of the +Y/-Y face, which is exactly a pole -- the one place on
// an equirectangular map where longitude is undefined. Odd puts the pole in
// the middle of a quad instead, so every vertex has a well-defined
// longitude.
//
// With `radiusAt` the result is displaced terrain carrying equirectangular
// UVs; without it, a plain unit sphere, which needs neither UVs nor the
// per-vertex trigonometry they require.
export function buildCubeSphere(segments, { radiusAt = null } = {}) {
  const perFace = (segments + 1) * (segments + 1);
  const vertexCount = perFace * CUBE_FACES.length;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = radiusAt ? new Float32Array(vertexCount * 2) : null;
  const indices = new Uint32Array(segments * segments * 6 * CUBE_FACES.length);

  let vi = 0;
  let ii = 0;

  for (let f = 0; f < CUBE_FACES.length; f++) {
    const [forward, right, up] = CUBE_FACES[f];
    const faceStart = f * perFace;

    for (let j = 0; j <= segments; j++) {
      const wv = warpAxis(-1 + (2 * j) / segments);
      for (let i = 0; i <= segments; i++) {
        const wu = warpAxis(-1 + (2 * i) / segments);

        let x = forward[0] + right[0] * wu + up[0] * wv;
        let y = forward[1] + right[1] * wu + up[1] * wv;
        let z = forward[2] + right[2] * wu + up[2] * wv;
        const inv = 1 / Math.hypot(x, y, z);
        x *= inv;
        y *= inv;
        z *= inv;

        if (radiusAt) {
          const { lng, lat } = directionToLngLat(x, y, z);
          const radius = radiusAt(lng, lat);
          positions[vi * 3] = x * radius;
          positions[vi * 3 + 1] = y * radius;
          positions[vi * 3 + 2] = z * radius;
          uvs[vi * 2] = (lng + 180) / 360;
          uvs[vi * 2 + 1] = (lat + 90) / 180;
        } else {
          positions[vi * 3] = x;
          positions[vi * 3 + 1] = y;
          positions[vi * 3 + 2] = z;
        }
        vi++;
      }
    }

    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = faceStart + j * (segments + 1) + i;
        const b = a + 1;
        const c = a + (segments + 1);
        const d = c + 1;
        indices[ii++] = a;
        indices[ii++] = b;
        indices[ii++] = d;
        indices[ii++] = a;
        indices[ii++] = d;
        indices[ii++] = c;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  if (uvs) {
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }
  // Normals are computed here, *before* the seam split below, so the
  // duplicated seam vertices inherit an identical normal from their
  // original and the antimeridian shows no lighting discontinuity.
  geometry.computeVertexNormals();

  if (uvs) {
    splitSeamVertices(geometry);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

// A triangle straddling the antimeridian has corners at u ~ 0.99 and
// u ~ 0.01, so interpolating between them runs the texture backwards
// across the entire map in one triangle. Give those corners a private copy
// carrying u + 1 instead (the texture must be set to wrap -- see the
// material's wrapS in globe3d.js). Only a few hundred vertices along one
// meridian are affected, and position and normal are copied verbatim so
// nothing moves or re-shades.
function splitSeamVertices(geometry) {
  const position = geometry.attributes.position.array;
  const normal = geometry.attributes.normal.array;
  const uv = geometry.attributes.uv.array;
  const index = geometry.index.array;

  const extraPositions = [];
  const extraNormals = [];
  const extraUvs = [];
  const copies = new Map();
  let nextIndex = geometry.attributes.position.count;

  for (let t = 0; t < index.length; t += 3) {
    const u0 = uv[index[t] * 2];
    const u1 = uv[index[t + 1] * 2];
    const u2 = uv[index[t + 2] * 2];
    if (Math.max(u0, u1, u2) - Math.min(u0, u1, u2) <= 0.5) continue;

    for (let k = 0; k < 3; k++) {
      const original = index[t + k];
      if (uv[original * 2] >= 0.5) continue;

      let copy = copies.get(original);
      if (copy === undefined) {
        copy = nextIndex++;
        extraPositions.push(
          position[original * 3],
          position[original * 3 + 1],
          position[original * 3 + 2]
        );
        extraNormals.push(
          normal[original * 3],
          normal[original * 3 + 1],
          normal[original * 3 + 2]
        );
        extraUvs.push(uv[original * 2] + 1, uv[original * 2 + 1]);
        copies.set(original, copy);
      }
      index[t + k] = copy;
    }
  }

  if (copies.size === 0) return;

  geometry.setAttribute("position", concatAttribute(position, extraPositions, 3));
  geometry.setAttribute("normal", concatAttribute(normal, extraNormals, 3));
  geometry.setAttribute("uv", concatAttribute(uv, extraUvs, 2));
  geometry.index.needsUpdate = true;
}

function concatAttribute(base, extra, itemSize) {
  const merged = new Float32Array(base.length + extra.length);
  merged.set(base, 0);
  merged.set(extra, base.length);
  return new THREE.BufferAttribute(merged, itemSize);
}
