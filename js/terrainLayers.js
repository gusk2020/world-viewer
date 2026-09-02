const ELEVATION_COLOR_RAMP = [
  "interpolate",
  ["linear"],
  ["elevation"],
  -10000, "#050f2c",
  -4000, "#0a2a55",
  -1000, "#124a7a",
  -50, "#2a76a8",
  0, "#c9d9a0",
  200, "#a9c97a",
  800, "#e0c37a",
  2000, "#b98b5e",
  4000, "#8a6a52",
  6000, "#f5f5f5",
  8849, "#ffffff",
];

// Web-Mercator raster-dem tiles are degenerate right at the poles (a tile's
// top/bottom edge is an infinitely-thin sliver in real-world terms), which
// MapLibre's globe renderer shows as a radial streak artifact when draped
// that close to 90/-90 -- confirmed on-device, unrelated to hillshade. A
// plain vector fill has no such issue, so a small polar cap patch hides the
// artifact instead of trying to render real elevation color there.
const POLE_MASK_LATITUDE = 83;

const POLE_MASK_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-180, POLE_MASK_LATITUDE],
            [180, POLE_MASK_LATITUDE],
            [180, 90],
            [-180, 90],
            [-180, POLE_MASK_LATITUDE],
          ],
        ],
      },
    },
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-180, -90],
            [180, -90],
            [180, -POLE_MASK_LATITUDE],
            [-180, -POLE_MASK_LATITUDE],
            [-180, -90],
          ],
        ],
      },
    },
  ],
};

export function addTerrainLayers(map, config) {
  map.addSource("terrain-dem", {
    type: "raster-dem",
    tiles: config.terrain.tiles,
    tileSize: config.terrain.tileSize,
    maxzoom: config.terrain.maxzoom,
    encoding: config.terrain.encoding,
    attribution: config.terrain.attribution || "",
  });

  map.addLayer(
    {
      id: "terrain-color-relief",
      type: "color-relief",
      source: "terrain-dem",
      paint: {
        "color-relief-color": ELEVATION_COLOR_RAMP,
      },
    },
    "countries-boundary"
  );

  map.addSource("terrain-pole-mask", { type: "geojson", data: POLE_MASK_GEOJSON });
  map.addLayer(
    {
      id: "terrain-pole-mask",
      type: "fill",
      source: "terrain-pole-mask",
      paint: {
        "fill-color": "#e3edf2",
        "fill-opacity": 1,
      },
    },
    "countries-boundary"
  );
}

export function addGlacierLayer(map, glaciersGeoJson) {
  map.addSource("glaciers", { type: "geojson", data: glaciersGeoJson });

  map.addLayer(
    {
      id: "glacier-fill",
      type: "fill",
      source: "glaciers",
      paint: {
        "fill-color": "#eaf6ff",
        "fill-opacity": 0.85,
      },
    },
    "countries-boundary"
  );
}

export function setTerrainVisible(map, visible) {
  const v = visible ? "visible" : "none";
  map.setLayoutProperty("terrain-color-relief", "visibility", v);
  map.setLayoutProperty("terrain-pole-mask", "visibility", v);
}

export function setGlacierVisible(map, visible) {
  map.setLayoutProperty("glacier-fill", "visibility", visible ? "visible" : "none");
}
