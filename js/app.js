import {
  MapLibreMap,
  NavigationControl,
  GlobeControl,
} from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";

import {
  loadEraIndex,
  nearestKeyframe,
  createEraLoader,
  addHistoryLayers,
  setTerritoriesVisible,
  setCitiesVisible,
  applyEraData,
} from "./historyLayers.js";

import {
  addTerrainLayers,
  addGlacierLayer,
  setTerrainVisible,
  setGlacierVisible,
} from "./terrainLayers.js";

const WORLD_CONFIG_URL = "./worlds/kasoku-sekai/config.json";

async function main() {
  const world = await (await fetch(WORLD_CONFIG_URL)).json();

  const map = new MapLibreMap({
    container: "map",
    style: world.styleUrl,
    center: world.center,
    zoom: world.zoom,
    minZoom: world.minZoom,
    maxZoom: world.maxZoom,
    attributionControl: { compact: true },
  });

  map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new GlobeControl(), "top-right");

  map.on("style.load", () => {
    map.setProjection({ type: world.defaultProjection || "mercator" });
  });

  const state = { mode: "history", citiesOn: true, glacierOn: true };

  function applyVisibility() {
    setTerritoriesVisible(map, state.mode === "history");
    setCitiesVisible(map, state.mode === "history" && state.citiesOn);
    setTerrainVisible(map, state.mode === "terrain");
    setGlacierVisible(map, state.mode === "terrain" && state.glacierOn);
  }

  map.on("load", async () => {
    addHistoryLayers(map);
    addTerrainLayers(map, world);

    const glaciers = await (await fetch(world.glaciersUrl)).json();
    addGlacierLayer(map, glaciers);

    applyVisibility();
    document.getElementById("loading").classList.add("hidden");

    setupHistoryPanel(map, world);
    setupModeToggle(map, state, applyVisibility);
    setupCityToggle(state, applyVisibility);
    setupGlacierToggle(state, applyVisibility);
  });

  map.on("error", (e) => {
    console.error("Map error:", e && e.error ? e.error : e);
  });
}

async function setupHistoryPanel(map, world) {
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
    applyEraData(map, eraDoc);
  }

  slider.addEventListener("input", () => showYear(Number(slider.value)));
  await showYear(Number(slider.value));
}

function setupModeToggle(map, state, applyVisibility) {
  const button = document.getElementById("mode-toggle");
  const historyPanel = document.getElementById("history-panel");
  const terrainPanel = document.getElementById("terrain-panel");

  function render() {
    const isHistory = state.mode === "history";
    historyPanel.hidden = !isHistory;
    terrainPanel.hidden = isHistory;
    button.textContent = isHistory ? "地形図に切替" : "歴史地図に切替";
  }

  button.addEventListener("click", () => {
    state.mode = state.mode === "history" ? "terrain" : "history";
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
