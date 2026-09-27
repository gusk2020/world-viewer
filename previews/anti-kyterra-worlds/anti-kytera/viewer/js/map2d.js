// The 2D map (OpenLayers), as in v1s -- same view carry-over to and from the
// globe -- but the picture is not OpenStreetMap: it is the same display the
// globe shows (標準 photo or an Anti-KyTerra stage), drawn per pixel in Web
// Mercator by a callback, so 2D and 3D show the same conditions.
const NEAR_POLE_LATITUDE = 80;
const NEAR_POLE_MIN_ZOOM = 6;
const MAX_PIXELS = 4.2e6;   // cap on one rendered frame (a Pixel 7a screen at ratio 2 is ~3.9e6)

export function initMap2D(targetId, draw) {
  const source = new ol.source.ImageCanvas({
    ratio: 1,
    canvasFunction: (extent, resolution, pixelRatio, size) => {
      let [w, h] = size.map(Math.round);
      const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
      w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
      return draw(extent, w, h);
    },
  });
  const graticuleSource = new ol.source.Vector();
  const graticuleLayer = new ol.layer.Vector({ source: graticuleSource });
  const map = new ol.Map({
    target: targetId,
    layers: [new ol.layer.Image({ source }), graticuleLayer],
    view: new ol.View({ center: [0, 0], zoom: 2 }),
  });

  function getView() {
    const view = map.getView();
    const [lng, lat] = ol.proj.toLonLat(view.getCenter());
    return { lng: ((lng + 540) % 360) - 180, lat, zoom: view.getZoom() };
  }
  function setView({ lng, lat, zoom }) {
    const view = map.getView();
    const effectiveZoom = Math.abs(lat) > NEAR_POLE_LATITUDE ? Math.max(zoom, NEAR_POLE_MIN_ZOOM) : zoom;
    view.setCenter(ol.proj.fromLonLat([lng, lat]));
    view.setZoom(effectiveZoom);
  }

  // Graticule: the same four states and colours as the globe's.
  let gMode = "off", gColor = "#000000", gStep = 0;
  function buildGraticule() {
    graticuleSource.clear();
    if (gMode === "off") return;
    const step = map.getView().getZoom() >= 4 ? 10 : 30;
    gStep = step;
    const feats = [];
    if (gMode === "parallels" || gMode === "both") {
      for (let lat = -90 + step; lat < 90; lat += step) {
        if (Math.abs(lat) > 85) continue;
        feats.push(new ol.Feature(new ol.geom.LineString([[-540, lat], [540, lat]].map((p) => ol.proj.fromLonLat(p)))));
      }
    }
    if (gMode === "meridians" || gMode === "both") {
      for (let lng = -540; lng <= 540; lng += step) {
        feats.push(new ol.Feature(new ol.geom.LineString([[lng, -85], [lng, 85]].map((p) => ol.proj.fromLonLat(p)))));
      }
    }
    graticuleSource.addFeatures(feats);
  }
  function applyGraticuleStyle() {
    const rgb = gColor === "#ffffff" ? "255,255,255" : "0,0,0";
    graticuleLayer.setStyle(new ol.style.Style({ stroke: new ol.style.Stroke({ color: `rgba(${rgb},0.55)`, width: 1 }) }));
  }
  applyGraticuleStyle();
  map.getView().on("change:resolution", () => {
    if (gMode !== "off" && (map.getView().getZoom() >= 4 ? 10 : 30) !== gStep) buildGraticule();
  });
  function setGraticule(mode) { gMode = mode; buildGraticule(); }
  function setGraticuleColor(hex) { gColor = hex; applyGraticuleStyle(); }

  return { map, getView, setView, refresh: () => source.changed(), setGraticule, setGraticuleColor };
}
