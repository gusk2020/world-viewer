import {
  loadEraIndex,
  nearestKeyframe,
  createEraLoader,
  createHistoryDataSources,
  applyEraData,
  setHistoryVisible,
} from "./historyLayers.js";
import { createGlacierDataSource } from "./glacierLayer.js";
import {
  createGibsGeographicTilingScheme,
  GIBS_GEOGRAPHIC_MAX_LEVEL,
  GIBS_GEOGRAPHIC_MIN_LEVEL,
} from "./gibsGeographicTilingScheme.js";

const WORLD_CONFIG_URL = "./worlds/kasoku-sekai/config.json";

async function createTerrainProvider(config) {
  try {
    return await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(config.terrain.url);
  } catch (err) {
    console.error("Primary terrain source failed, trying fallback:", err);
  }
  try {
    return await Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(config.terrain.fallbackUrl);
  } catch (err) {
    console.error("Fallback terrain source also failed, using flat globe:", err);
    return new Cesium.EllipsoidTerrainProvider();
  }
}

// Full-coverage base layer, drawn UNDERNEATH createImageryProvider()'s
// detailed layer below. Requested over WMS (not WMTS/tile-template) so
// Cesium asks GIBS for an arbitrary bounding box using Cesium's own plain
// GeographicTilingScheme, instead of matching indices against GIBS's
// GIBS-specific irregular WMTS tile pyramid the detailed layer needs.
// There is no fixed tile grid here to misalign with, so this layer can't
// have the kind of coverage gap that pyramid math could -- whatever bbox
// Cesium asks for (poles included), GIBS renders it directly. Same source
// layer (BlueMarble_ShadedRelief_Bathymetry) as the detailed layer, so
// wherever it shows through it's the same photograph, not a visibly
// different fallback image.
function createBaseImageryProvider(config) {
  return new Cesium.WebMapServiceImageryProvider({
    url: config.imagery.wmsBaseUrl,
    layers: config.imagery.wmsLayer,
    parameters: {
      service: "WMS",
      version: "1.1.1",
      request: "GetMap",
      styles: "",
      format: "image/jpeg",
      transparent: false,
    },
    maximumLevel: GIBS_GEOGRAPHIC_MAX_LEVEL,
    credit: config.imagery.credit,
  });
}

// Detailed layer, drawn on top of the base layer above. Uses GIBS's WMTS
// tile pyramid directly (see gibsGeographicTilingScheme.js) for cheaper,
// more cacheable requests than WMS; wherever a tile here is unavailable
// (e.g. a level/index GIBS doesn't actually have), Cesium simply doesn't
// draw this layer there and the base layer underneath shows through
// instead of black.
function createImageryProvider(config) {
  return new Cesium.UrlTemplateImageryProvider({
    url: config.imagery.url,
    tilingScheme: createGibsGeographicTilingScheme(),
    minimumLevel: GIBS_GEOGRAPHIC_MIN_LEVEL,
    maximumLevel: GIBS_GEOGRAPHIC_MAX_LEVEL,
    credit: config.imagery.credit,
  });
}

async function main() {
  const world = await (await fetch(WORLD_CONFIG_URL)).json();
  const glaciersGeoJson = await (await fetch(world.glaciersUrl)).json();

  const terrainProvider = await createTerrainProvider(world);

  const viewer = new Cesium.Viewer("cesiumContainer", {
    terrainProvider,
    baseLayer: false,
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: true,
    navigationHelpButton: false,
    fullscreenButton: false,
  });
  // Base layer added first (bottom), detailed layer added second (drawn
  // on top) -- Cesium's ImageryLayerCollection stacks in add order.
  viewer.imageryLayers.addImageryProvider(createBaseImageryProvider(world));
  viewer.imageryLayers.addImageryProvider(createImageryProvider(world));

  const historySources = createHistoryDataSources();
  viewer.dataSources.add(historySources.territories);
  viewer.dataSources.add(historySources.cities);

  const glacierSource = createGlacierDataSource(glaciersGeoJson);
  viewer.dataSources.add(glacierSource);

  const state = { dataMode: "history", citiesOn: true, glacierOn: true };

  function applyVisibility() {
    setHistoryVisible(historySources, state.dataMode === "history", state.citiesOn);
    glacierSource.show = state.glacierOn;
  }

  applyVisibility();
  document.getElementById("loading").classList.add("hidden");

  setupHistoryPanel(historySources, world);
  setupModeToggle(state, applyVisibility);
  setupCityToggle(state, applyVisibility);
  setupGlacierToggle(state, applyVisibility);
  setupCompass(viewer);
  setupScaleBar(viewer);
}

// Cesium's Viewer widget has no built-in compass; this is a minimal one:
// the arrow rotates to always point at true north, and tapping it resets
// the camera heading to 0 (north-up) without changing position/pitch.
function setupCompass(viewer) {
  const arrow = document.querySelector("#compass-btn .compass-arrow");

  function update() {
    const headingDegrees = Cesium.Math.toDegrees(viewer.camera.heading);
    arrow.style.transform = `rotate(${-headingDegrees}deg)`;
  }
  viewer.scene.postRender.addEventListener(update);
  update();

  document.getElementById("compass-btn").addEventListener("click", () => {
    viewer.camera.setView({
      destination: viewer.camera.position,
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
    });
  });
}

// Cesium's Viewer widget has no built-in scale bar either. Measures the
// real-world ground distance between two points 100 screen-pixels apart
// at the center of the view, then picks the largest "nice" round number
// of meters/km that fits within an ~80px-wide bar.
const SCALE_NICE_STEPS = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000,
  20000, 25000, 50000, 100000, 200000, 250000, 500000, 1000000, 2000000,
  5000000, 10000000, 20000000, 50000000,
];
const SCALE_TARGET_PIXEL_WIDTH = 80;

function setupScaleBar(viewer) {
  const el = document.getElementById("scale-bar");

  function update() {
    const canvas = viewer.scene.canvas;
    const centerY = canvas.clientHeight / 2;
    const centerX = canvas.clientWidth / 2;
    const ellipsoid = viewer.scene.globe.ellipsoid;
    const left = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(centerX - 50, centerY), ellipsoid);
    const right = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(centerX + 50, centerY), ellipsoid);
    if (!left || !right) {
      el.style.visibility = "hidden";
      return;
    }
    el.style.visibility = "visible";

    const metersPerPixel = Cesium.Cartesian3.distance(left, right) / 100;
    const targetMeters = metersPerPixel * SCALE_TARGET_PIXEL_WIDTH;
    let niceMeters = SCALE_NICE_STEPS[0];
    for (const step of SCALE_NICE_STEPS) {
      if (step > targetMeters) break;
      niceMeters = step;
    }
    el.style.width = `${Math.round(niceMeters / metersPerPixel)}px`;
    el.textContent = niceMeters >= 1000 ? `${niceMeters / 1000}km` : `${niceMeters}m`;
  }

  viewer.scene.postRender.addEventListener(update);
  update();
}

async function setupHistoryPanel(historySources, world) {
  const eraIndex = await loadEraIndex(world);
  const loadEra = createEraLoader(world);

  const slider = document.getElementById("year-slider");
  const yearLabel = document.getElementById("year-label");
  const eraNote = document.getElementById("era-note");

  slider.min = String(eraIndex.startYear);
  slider.max = String(eraIndex.presentYear);
  slider.step = String(eraIndex.stepYears);
  slider.value = String(eraIndex.presentYear);

  async function showYear(year) {
    const keyframe = nearestKeyframe(eraIndex, year);
    yearLabel.textContent = `${year}年`;
    eraNote.textContent = keyframe === year ? "" : `(データ: ${keyframe}年時点)`;
    const eraDoc = await loadEra(keyframe);
    applyEraData(historySources, eraDoc);
  }

  slider.addEventListener("input", () => showYear(Number(slider.value)));
  await showYear(Number(slider.value));
}

function setupModeToggle(state, applyVisibility) {
  const button = document.getElementById("mode-toggle");
  const historyPanel = document.getElementById("history-panel");
  const terrainPanel = document.getElementById("terrain-panel");

  function render() {
    const isHistory = state.dataMode === "history";
    historyPanel.hidden = !isHistory;
    terrainPanel.hidden = isHistory;
    button.textContent = isHistory ? "地形図に切替" : "歴史地図に切替";
  }

  button.addEventListener("click", () => {
    state.dataMode = state.dataMode === "history" ? "terrain" : "history";
    render();
    applyVisibility();
  });

  render();
}

function setupCityToggle(state, applyVisibility) {
  const button = document.getElementById("city-toggle");
  button.addEventListener("click", () => {
    state.citiesOn = !state.citiesOn;
    button.setAttribute("aria-pressed", String(state.citiesOn));
    button.textContent = state.citiesOn ? "都市を表示" : "都市を非表示";
    applyVisibility();
  });
}

function setupGlacierToggle(state, applyVisibility) {
  const button = document.getElementById("glacier-toggle");
  button.addEventListener("click", () => {
    state.glacierOn = !state.glacierOn;
    button.setAttribute("aria-pressed", String(state.glacierOn));
    button.textContent = state.glacierOn ? "氷河を表示" : "氷河を非表示";
    applyVisibility();
  });
}

main().catch((err) => {
  console.error("Failed to start map:", err);
  const loading = document.getElementById("loading");
  loading.textContent = "地図の読み込みに失敗しました。通信状況を確認してください。";
});
