// Dedicated flat polar-stereographic maps for the Arctic and Antarctic,
// built with OpenLayers instead of MapLibre. MapLibre's globe projection
// drapes raster tiles onto a sphere, which is mathematically degenerate
// right at the poles (see CLAUDE.md) -- there is no fix for that within
// MapLibre's globe renderer, and it applies to *any* tile content, not
// just our specific terrain data. A polar-stereographic projection has no
// singularity at its own pole, which is why real polar science tools
// (NASA GIBS, NSIDC/PolarView) use exactly this kind of map for close-up
// ice/coastline work.
//
// Terrain/bathymetry source: NASA GIBS's BlueMarble_ShadedRelief_Bathymetry
// layer, served *natively* in EPSG:3413/3031 (not reprojected from Web
// Mercator). An earlier version of this file reprojected the AWS Terrarium
// DEM tiles from Web Mercator instead -- that approach left a black hole
// covering the pole itself, because Web Mercator (the source tiles'
// native projection) cannot represent latitudes beyond about +-85.05 deg
// in the first place, so there was nothing to reproject there. GIBS's
// polar layer has no such gap since it's rendered directly in the polar
// projection. Trade-off: this is a pre-rendered image (real NASA imagery,
// not a rendering bug), not raw elevation numbers -- it cannot power a
// future sea-level slider by itself, and its colors won't exactly match
// this app's own elevation color ramp used elsewhere. See CLAUDE.md.

const GIBS_EXTENT = [-4194304, -4194304, 4194304, 4194304];
const GIBS_ORIGIN = [-4194304, 4194304];
// One fewer level than GIBS's confirmed 250m-matrixSet resolutions
// ([8192, 4096, 2048, 1024, 512, 256]) since 500m is one step coarser.
// Not independently confirmed against GIBS's capabilities document
// (network-blocked from this sandbox) -- if polar terrain tiles look
// blurry/misaligned/missing at some zoom levels, this array is the first
// thing to check.
const GIBS_500M_RESOLUTIONS = [8192, 4096, 2048, 1024, 512];

const POLE_DEFS = {
  north: {
    epsg: "EPSG:3413",
    proj4: "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    gibsPath: "epsg3413",
  },
  south: {
    epsg: "EPSG:3031",
    proj4: "+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs",
    gibsPath: "epsg3031",
  },
};

let proj4Registered = false;
function ensureProjectionsRegistered() {
  if (proj4Registered) return;
  proj4.defs(POLE_DEFS.north.epsg, POLE_DEFS.north.proj4);
  proj4.defs(POLE_DEFS.south.epsg, POLE_DEFS.south.proj4);
  ol.proj.proj4.register(proj4);
  for (const { epsg } of Object.values(POLE_DEFS)) {
    ol.proj.get(epsg).setExtent(GIBS_EXTENT);
  }
  proj4Registered = true;
}

function createTerrainSource(def) {
  return new ol.source.XYZ({
    projection: def.epsg,
    url: `https://gibs.earthdata.nasa.gov/wmts/${def.gibsPath}/best/BlueMarble_ShadedRelief_Bathymetry/default/500m/{z}/{y}/{x}.jpeg`,
    tileGrid: new ol.tilegrid.TileGrid({
      origin: GIBS_ORIGIN,
      resolutions: GIBS_500M_RESOLUTIONS,
      tileSize: 512,
    }),
    attributions: "Terrain/bathymetry: NASA Blue Marble (GIBS)",
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

  const terrainLayer = new ol.layer.Tile({
    source: createTerrainSource(def),
    extent: GIBS_EXTENT,
  });
  const glacierLayer = createGlacierLayer(glaciersGeoJson, def.epsg);

  const map = new ol.Map({
    target: containerId,
    layers: [terrainLayer, glacierLayer],
    view: new ol.View({
      projection: def.epsg,
      extent: GIBS_EXTENT,
      maxResolution: GIBS_500M_RESOLUTIONS[0],
      center: [0, 0],
      zoom: 1,
      minZoom: 0,
      maxZoom: GIBS_500M_RESOLUTIONS.length - 1,
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
