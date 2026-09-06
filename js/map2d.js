// The 2D map (V0.2), wrapped as a self-contained module so V0.3 can mount
// it alongside the 3D globe and read/set its current view for the toggle
// button -- see getView()/setView() below.
//
// Loaded via OpenLayers's own bundled dist/ol.js (a global `ol`
// namespace), not its raw ESM source: the ESM source has several
// bare-specifier npm dependencies of its own (rbush, pbf, earcut, ...)
// that aren't resolvable through a plain browser import map without
// mapping each one individually -- see CLAUDE.md for detail. This file
// is still a plain ES module (for a clean `import` on the caller's side)
// even though the library it wraps isn't -- referencing the `ol` global
// from inside a module works fine, since `<script src=".../ol.js">` runs
// before any `type="module"` script regardless of tag order in the page.
export function initMap2D(targetId) {
  const map = new ol.Map({
    target: targetId,
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

  function getView() {
    const view = map.getView();
    const [lng, lat] = ol.proj.toLonLat(view.getCenter());
    return { lng, lat, zoom: view.getZoom() };
  }

  function setView({ lng, lat, zoom }) {
    const view = map.getView();
    view.setCenter(ol.proj.fromLonLat([lng, lat]));
    view.setZoom(zoom);
  }

  return { map, getView, setView };
}
