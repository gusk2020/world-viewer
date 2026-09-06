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

  // Web Mercator can't represent latitudes near +-90 at all, but
  // OpenLayers's View compounds that: at a LOW zoom, it silently
  // repositions the center to whatever latitude fits the current
  // viewport rectangle inside the projection's valid extent -- e.g. at
  // zoom 3 on a typical phone-sized viewport, *any* requested latitude
  // past about -70.7 lands at exactly -70.7, nowhere near the pole and
  // not obviously related to what was asked for (confirmed directly:
  // requesting -80, -85, and -89.9999 at zoom 3 all produced the exact
  // same -70.7 result). Since this app's whole focus is the poles, a
  // silent jump to an unrelated latitude would be confusing -- so a
  // near-polar request first forces a higher zoom, landing much closer
  // to the true target (confirmed: zoom 6 gets within ~1 degree of
  // Mercator's real ~85.05 degree limit) at the cost of not carrying the
  // exact 3D zoom level in this one edge case.
  const NEAR_POLE_LATITUDE = 80;
  const NEAR_POLE_MIN_ZOOM = 6;

  function setView({ lng, lat, zoom }) {
    const view = map.getView();
    const effectiveZoom = Math.abs(lat) > NEAR_POLE_LATITUDE
      ? Math.max(zoom, NEAR_POLE_MIN_ZOOM)
      : zoom;
    view.setCenter(ol.proj.fromLonLat([lng, lat]));
    view.setZoom(effectiveZoom);
  }

  return { map, getView, setView };
}
