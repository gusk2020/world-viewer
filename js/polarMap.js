// Dedicated flat polar-stereographic maps for the Arctic and Antarctic,
// built with OpenLayers instead of MapLibre. MapLibre's globe projection
// drapes Web-Mercator raster tiles onto a sphere, which is mathematically
// degenerate right at the poles (see CLAUDE.md) -- there is no fix for
// that within MapLibre's globe renderer. A polar-stereographic projection
// has no singularity at its own pole, which is why real polar science
// tools (NASA GIBS, NSIDC/PolarView) use exactly this kind of map for
// close-up ice/coastline work. OpenLayers was chosen because it natively
// supports arbitrary projections (via proj4) and can reproject an
// ordinary Web Mercator tile source into that projection on the fly.
import { elevationToRGB, decodeTerrariumElevation } from "./elevationColor.js";

const TILE_SIZE = 256;

const POLE_DEFS = {
  north: {
    epsg: "EPSG:3413",
    proj4: "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
  },
  south: {
    epsg: "EPSG:3031",
    proj4: "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
  },
};

let proj4Registered = false;
function ensureProjectionsRegistered() {
  if (proj4Registered) return;
  proj4.defs(POLE_DEFS.north.epsg, POLE_DEFS.north.proj4);
  proj4.defs(POLE_DEFS.south.epsg, POLE_DEFS.south.proj4);
  ol.proj.proj4.register(proj4);
  proj4Registered = true;
}

function decodeTerrariumTileToCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE);
  const imgData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const elevation = decodeTerrariumElevation(data[i], data[i + 1], data[i + 2]);
    const [r, g, b] = elevationToRGB(elevation);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function createColorizedTerrainSource(config) {
  return new ol.source.XYZ({
    projection: "EPSG:3857",
    url: config.terrain.tiles[0],
    maxZoom: config.terrain.maxzoom,
    crossOrigin: "anonymous",
    attributions: config.terrain.attribution || "",
    tileLoadFunction: (imageTile, src) => {
      const loader = new Image();
      loader.crossOrigin = "anonymous";
      loader.onload = () => {
        try {
          const canvas = decodeTerrariumTileToCanvas(loader);
          imageTile.getImage().src = canvas.toDataURL();
        } catch (err) {
          console.error("Polar terrain tile decode failed:", err);
        }
      };
      loader.onerror = () => imageTile.setState(3); // ol.TileState.ERROR
      loader.src = src;
    },
  });
}

function createGlacierLayer(glaciersGeoJson, viewProjection) {
  const source = new ol.source.Vector({
    features: new ol.format.GeoJSON().readFeatures(glaciersGeoJson, {
      dataProjection: "EPSG:4326",
      featureProjection: viewProjection,
    }),
  });
  return new ol.layer.Vector({
    source,
    style: new ol.style.Style({
      fill: new ol.style.Fill({ color: "rgba(234, 246, 255, 0.85)" }),
    }),
  });
}

export function createPolarMap(containerId, pole, config, glaciersGeoJson) {
  ensureProjectionsRegistered();
  const def = POLE_DEFS[pole];

  const terrainLayer = new ol.layer.Tile({ source: createColorizedTerrainSource(config) });
  const glacierLayer = createGlacierLayer(glaciersGeoJson, def.epsg);

  const map = new ol.Map({
    target: containerId,
    layers: [terrainLayer, glacierLayer],
    view: new ol.View({
      projection: def.epsg,
      center: [0, 0],
      zoom: 1,
      minZoom: 0,
      maxZoom: 8,
    }),
    controls: [],
  });

  return {
    map,
    setGlacierVisible(visible) {
      glacierLayer.setVisible(visible);
    },
    updateSize() {
      map.updateSize();
    },
  };
}
