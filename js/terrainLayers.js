import { toColorReliefExpression } from "./elevationColor.js";

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
        "color-relief-color": toColorReliefExpression(),
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
  map.setLayoutProperty("terrain-color-relief", "visibility", visible ? "visible" : "none");
}

export function setGlacierVisible(map, visible) {
  map.setLayoutProperty("glacier-fill", "visibility", visible ? "visible" : "none");
}
