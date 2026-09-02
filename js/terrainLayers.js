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

  map.addLayer(
    {
      id: "terrain-hillshade",
      type: "hillshade",
      source: "terrain-dem",
      paint: {
        "hillshade-exaggeration": 0.6,
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
  map.setLayoutProperty("terrain-hillshade", "visibility", v);
}

export function setGlacierVisible(map, visible) {
  map.setLayoutProperty("glacier-fill", "visibility", visible ? "visible" : "none");
}
