// Shared elevation -> color ramp, used by both the MapLibre globe/flat map
// (as a GL color-relief expression) and the OpenLayers polar maps (as a
// per-pixel canvas recolor of decoded Terrarium DEM tiles). Keeping one
// source of truth means the poles look the same as the rest of the world.
export const ELEVATION_STOPS = [
  [-10000, [5, 15, 44]],
  [-4000, [10, 42, 85]],
  [-1000, [18, 74, 122]],
  [-50, [42, 118, 168]],
  [0, [201, 217, 160]],
  [200, [169, 201, 122]],
  [800, [224, 195, 122]],
  [2000, [185, 139, 94]],
  [4000, [138, 106, 82]],
  [6000, [245, 245, 245]],
  [8849, [255, 255, 255]],
];

export function toColorReliefExpression() {
  const expr = ["interpolate", ["linear"], ["elevation"]];
  for (const [elevation, [r, g, b]] of ELEVATION_STOPS) {
    expr.push(elevation, `rgb(${r},${g},${b})`);
  }
  return expr;
}

export function elevationToRGB(elevation) {
  const stops = ELEVATION_STOPS;
  if (elevation <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (elevation <= stops[i][0]) {
      const [e0, c0] = stops[i - 1];
      const [e1, c1] = stops[i];
      const t = (elevation - e0) / (e1 - e0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// Terrarium PNG encoding (Mapzen/AWS Open Data): elevation in meters.
export function decodeTerrariumElevation(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}
