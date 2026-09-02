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

import { createPolarMap } from "./polarMap.js";

const WORLD_CONFIG_URL = "./worlds/kasoku-sekai/config.json";

const VIEW_MODE_BUTTONS = {
  "view-globe": "globe",
  "view-flat": "flat",
  "view-arctic": "arctic",
  "view-antarctic": "antarctic",
};

function isMapLibreView(viewMode) {
  return viewMode === "globe" || viewMode === "flat";
}

async function main() {
  const world = await (await fetch(WORLD_CONFIG_URL)).json();
  const glaciersGeoJson = await (await fetch(world.glaciersUrl)).json();

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

  const state = { viewMode: "globe", dataMode: "history", citiesOn: true, glacierOn: true };
  const polarMaps = { arctic: null, antarctic: null };

  function ensurePolarMap(pole) {
    if (polarMaps[pole]) return polarMaps[pole];
    const containerId = pole === "arctic" ? "map-arctic" : "map-antarctic";
    const hemisphere = pole === "arctic" ? "north" : "south";
    const instance = createPolarMap(containerId, hemisphere, world, glaciersGeoJson);
    instance.setGlacierVisible(state.glacierOn);
    polarMaps[pole] = instance;
    return instance;
  }

  function applyVisibility() {
    const isHistory = state.dataMode === "history";
    setTerritoriesVisible(map, isHistory);
    setCitiesVisible(map, isHistory && state.citiesOn);
    setTerrainVisible(map, !isHistory);
    setGlacierVisible(map, !isHistory && state.glacierOn);

    if (polarMaps.arctic) polarMaps.arctic.setGlacierVisible(state.glacierOn);
    if (polarMaps.antarctic) polarMaps.antarctic.setGlacierVisible(state.glacierOn);
  }

  function renderViewMode() {
    document.getElementById("map").hidden = !isMapLibreView(state.viewMode);
    document.getElementById("map-arctic").hidden = state.viewMode !== "arctic";
    document.getElementById("map-antarctic").hidden = state.viewMode !== "antarctic";

    if (isMapLibreView(state.viewMode)) {
      map.setProjection({ type: state.viewMode === "globe" ? "globe" : "mercator" });
    } else if (state.viewMode === "arctic") {
      ensurePolarMap("arctic").updateSize();
    } else if (state.viewMode === "antarctic") {
      ensurePolarMap("antarctic").updateSize();
    }

    const historyPanel = document.getElementById("history-panel");
    const terrainPanel = document.getElementById("terrain-panel");
    const modeToggleBtn = document.getElementById("mode-toggle");

    if (isMapLibreView(state.viewMode)) {
      const isHistory = state.dataMode === "history";
      historyPanel.hidden = !isHistory;
      terrainPanel.hidden = isHistory;
      modeToggleBtn.hidden = false;
      modeToggleBtn.textContent = isHistory ? "地形図に切替" : "歴史地図に切替";
    } else {
      historyPanel.hidden = true;
      terrainPanel.hidden = false;
      modeToggleBtn.hidden = true;
    }

    for (const [id, mode] of Object.entries(VIEW_MODE_BUTTONS)) {
      document.getElementById(id).setAttribute("aria-pressed", String(state.viewMode === mode));
    }
  }

  function setupViewModeButtons() {
    for (const [id, mode] of Object.entries(VIEW_MODE_BUTTONS)) {
      document.getElementById(id).addEventListener("click", () => {
        state.viewMode = mode;
        renderViewMode();
        applyVisibility();
      });
    }
  }

  map.on("load", async () => {
    addHistoryLayers(map);
    addTerrainLayers(map, world);
    addGlacierLayer(map, glaciersGeoJson);

    applyVisibility();
    renderViewMode();
    document.getElementById("loading").classList.add("hidden");

    setupHistoryPanel(map, world);
    setupModeToggle(state, renderViewMode, applyVisibility);
    setupCityToggle(state, applyVisibility);
    setupGlacierToggle(state, applyVisibility);
    setupViewModeButtons();
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

function setupModeToggle(state, renderViewMode, applyVisibility) {
  const button = document.getElementById("mode-toggle");
  button.addEventListener("click", () => {
    state.dataMode = state.dataMode === "history" ? "terrain" : "history";
    renderViewMode();
    applyVisibility();
  });
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
