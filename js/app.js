import {
  loadEraIndex,
  nearestKeyframe,
  createEraLoader,
  createHistoryDataSources,
  applyEraData,
  setHistoryVisible,
} from "./historyLayers.js";
import { createGlacierDataSource } from "./glacierLayer.js";

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

function createImageryProvider(config) {
  return new Cesium.UrlTemplateImageryProvider({
    url: config.imagery.url,
    tilingScheme: new Cesium.GeographicTilingScheme(),
    maximumLevel: config.imagery.maximumLevel,
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
