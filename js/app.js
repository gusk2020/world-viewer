import {
  MapLibreMap,
  NavigationControl,
  GlobeControl,
} from "https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs";

const WORLD_CONFIG_URL = "./worlds/kasoku-sekai/config.json";

async function main() {
  const response = await fetch(WORLD_CONFIG_URL);
  const world = await response.json();

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

  map.on("load", () => {
    document.getElementById("loading").classList.add("hidden");
  });

  map.on("error", (e) => {
    console.error("Map error:", e && e.error ? e.error : e);
  });
}

main().catch((err) => {
  console.error("Failed to start map:", err);
  const loading = document.getElementById("loading");
  loading.textContent = "地図の読み込みに失敗しました。通信状況を確認してください。";
});
