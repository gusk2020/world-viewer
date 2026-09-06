// V0.2: a standalone OpenLayers 2D map, kept separate from the 3D globe
// (index.html/js/main.js) -- no switch button yet, that's V0.3. Real
// OpenStreetMap tiles are used as a placeholder basemap, same "real data,
// not fake, until 過速世界's own map exists" convention as the 3D globe's
// placeholder Earth-photo texture. Pan/pinch-zoom/scroll-zoom all come
// from OpenLayers's own default interactions -- nothing custom needed.
//
// Loaded via OpenLayers's own bundled dist/ol.js (a global `ol` namespace,
// like the old Cesium build) rather than its raw ESM source files: the
// ESM source has several bare-specifier npm dependencies (rbush, pbf,
// earcut, ...) that aren't resolvable through a plain browser import map
// without mapping each one individually. The bundled build has everything
// already inlined.
const map = new ol.Map({
  target: "map2d",
  layers: [
    new ol.layer.Tile({
      source: new ol.source.OSM(),
    }),
  ],
  view: new ol.View({
    center: [0, 0],
    zoom: 2,
  }),
});

map.once("rendercomplete", () => {
  document.getElementById("loading").classList.add("hidden");
});
