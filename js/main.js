import { initGlobe3D } from "./globe3d.js";
import { initMap2D } from "./map2d.js";

// V0.3: a 3D/2D toggle button, mounting both views on this one page (the
// standalone map2d.html from V0.2 is retired -- everything lives here
// now). The only per-world data point right now is which texture the 3D
// globe uses, so a second world (later) just needs its own config.json
// pointing at its own image.
const WORLD_CONFIG_URL = "./worlds/kasoku-sekai/config.json";

async function main() {
  const world = await (await fetch(WORLD_CONFIG_URL)).json();

  const globe3d = await initGlobe3D("app", world);
  // The 2D map is created lazily, the first time the user actually
  // switches to it -- OpenLayers measures its container's size at
  // construction time, and #map2d starts out hidden (display:none) since
  // the app opens in 3D mode; constructing it only once it's visible
  // avoids that entirely, rather than working around a 0x0-sized map.
  let map2d = null;

  const appEl = document.getElementById("app");
  const map2dEl = document.getElementById("map2d");
  const toggleButton = document.getElementById("view-toggle");
  const seaLevelControl = document.getElementById("sea-level-control");
  const seaLevelSlider = document.getElementById("sea-level-slider");
  const seaLevelReadout = document.getElementById("sea-level-readout");
  const waterOpacitySlider = document.getElementById("water-opacity-slider");
  const waterOpacityReadout = document.getElementById("water-opacity-readout");

  let mode = "3d";

  function applyMode() {
    appEl.hidden = mode !== "3d";
    map2dEl.hidden = mode !== "2d";
    // V0.5's sea-level control only applies to the 3D view -- the 2D map
    // has no sea-level concept yet.
    seaLevelControl.hidden = mode !== "3d";
    toggleButton.textContent = mode === "3d" ? "2Dに切替" : "3Dに切替";
  }

  // The slider is in real metres now that the terrain carries real GEBCO
  // elevations: +0 m is today's coastline, and the top of the range is
  // roughly what melting every ice sheet on Earth would add.
  function applySeaLevel() {
    const metres = Number(seaLevelSlider.value);
    globe3d.setSeaLevel(metres);
    seaLevelReadout.textContent = `+${metres}m`;
  }
  seaLevelSlider.addEventListener("input", applySeaLevel);
  applySeaLevel();

  function applyWaterOpacity() {
    const percent = Number(waterOpacitySlider.value);
    globe3d.setWaterOpacity(percent / 100);
    waterOpacityReadout.textContent = `${percent}%`;
  }
  waterOpacitySlider.addEventListener("input", applyWaterOpacity);
  applyWaterOpacity();

  toggleButton.addEventListener("click", () => {
    if (mode === "3d") {
      const view = globe3d.getView();
      mode = "2d";
      applyMode();
      if (!map2d) {
        map2d = initMap2D("map2d");
      } else {
        map2d.map.updateSize();
      }
      map2d.setView(view);
    } else {
      const view = map2d.getView();
      mode = "3d";
      applyMode();
      globe3d.setView(view);
    }
  });

  applyMode();
  document.getElementById("loading").classList.add("hidden");
}

main().catch((err) => {
  console.error("Failed to start map:", err);
  const loading = document.getElementById("loading");
  if (loading) {
    loading.textContent = "地図の読み込みに失敗しました。通信状況を確認してください。";
  }
});
