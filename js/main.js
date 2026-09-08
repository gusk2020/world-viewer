import { initGlobe3D } from "./globe3d.js";
import { initMap2D } from "./map2d.js";

// Which worlds exist, and which one opens first. Everything else about a
// world -- its radius, its terrain data, its colours, its sea-level range --
// lives in that world's own config.json, so adding a body is adding data.
const WORLD_INDEX_URL = "./worlds/index.json";

async function main() {
  const index = await (await fetch(WORLD_INDEX_URL)).json();

  const appEl = document.getElementById("app");
  const map2dEl = document.getElementById("map2d");
  const toggleButton = document.getElementById("view-toggle");
  const controlPanel = document.getElementById("sea-level-control");
  const seaLevelLabel = document.getElementById("sea-level-label");
  const seaLevelSlider = document.getElementById("sea-level-slider");
  const seaLevelReadout = document.getElementById("sea-level-readout");
  const waterOpacitySlider = document.getElementById("water-opacity-slider");
  const waterOpacityReadout = document.getElementById("water-opacity-readout");
  const seabedRow = document.getElementById("seabed-row");
  const worldButtons = document.getElementById("world-switch");
  const virtualNote = document.getElementById("virtual-sea-note");
  const loading = document.getElementById("loading");

  // The 2D map is created lazily, the first time the user actually switches
  // to it -- OpenLayers measures its container's size at construction time,
  // and #map2d starts out hidden (display:none) since the app opens in 3D
  // mode; constructing it only once it's visible avoids that entirely,
  // rather than working around a 0x0-sized map.
  let map2d = null;
  let mode = "3d";

  let globe3d = null;
  let world = null;

  function applyMode() {
    appEl.hidden = mode !== "3d";
    map2dEl.hidden = mode !== "2d";
    // The sea-level and seabed controls only apply to the 3D view; the 2D
    // map has no sea-level concept.
    controlPanel.hidden = mode !== "3d";
    toggleButton.textContent = mode === "3d" ? "2Dに切替" : "3Dに切替";
  }

  // The slider carries steps, not metres, because the two directions can
  // want very different resolution and an <input type="range"> only has one
  // step. On Earth, up is where the interesting numbers are close together
  // (every ice sheet melting is about +65 m) so it runs in 2 m steps, while
  // down spans the shelves and abyssal plains in 20 m steps. Mars and the
  // Moon have their own ranges in their own configs -- Earth's -6000 m
  // would be meaningless on a body whose relief is shaped nothing like it.
  function seaLevelSettings() {
    return world.config.display.seaLevel;
  }

  function seaLevelMetres() {
    const steps = Number(seaLevelSlider.value);
    const sea = seaLevelSettings();
    return steps * (steps >= 0 ? sea.upStepMetres : sea.downStepMetres);
  }

  function applySeaLevel() {
    const metres = seaLevelMetres();
    globe3d.setSeaLevel(metres);
    seaLevelReadout.textContent =
      metres === 0 ? "±0m" : `${metres > 0 ? "+" : ""}${metres}m`;
  }

  function applyWaterOpacity() {
    const percent = Number(waterOpacitySlider.value);
    globe3d.setWaterOpacity(percent / 100);
    waterOpacityReadout.textContent = `${percent}%`;
  }

  // Repainting the seabed takes a fraction of a second, so let the pressed
  // state paint first -- otherwise the button appears not to respond until
  // the work is already finished.
  const seabedButtons = document.querySelectorAll("#seabed-style button");
  seabedButtons.forEach((button) => {
    button.addEventListener("click", () => {
      seabedButtons.forEach((other) => other.classList.toggle("selected", other === button));
      requestAnimationFrame(() => globe3d.setSeabedStyle(button.dataset.style));
    });
  });

  seaLevelSlider.addEventListener("input", applySeaLevel);
  waterOpacitySlider.addEventListener("input", applyWaterOpacity);

  async function loadWorld(entry) {
    loading.classList.remove("hidden");
    loading.textContent = `${entry.label}を読み込み中…`;

    // OpenStreetMap is a map of Earth, so the 2D view only makes sense for
    // Earth; leaving 2D mode selected while switching to Mars would show
    // the wrong planet.
    if (mode !== "3d") {
      mode = "3d";
      applyMode();
    }

    const config = await (await fetch(entry.config)).json();
    if (globe3d) globe3d.dispose();
    globe3d = await initGlobe3D("app", config);
    world = { entry, config };

    const sea = config.display.seaLevel;
    seaLevelLabel.textContent = sea.label;
    seaLevelSlider.min = String(Math.round(sea.downToMetres / sea.downStepMetres));
    seaLevelSlider.max = String(Math.round(sea.upToMetres / sea.upStepMetres));
    seaLevelSlider.value = "0";

    // Earth's seabed colours repaint a satellite photograph. Mars and the
    // Moon have no photograph -- they are already coloured by height -- so
    // the control would do nothing and is hidden rather than left dead.
    const hasPhoto = Boolean(config.globeTexture);
    seabedRow.hidden = !hasPhoto;
    toggleButton.hidden = !hasPhoto;
    // Say plainly that these oceans are not real. The point of the slider on
    // an airless body is "if there were water up to here, where would the
    // coast be" -- worth stating rather than implying.
    virtualNote.hidden = hasPhoto;

    worldButtons.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("selected", button.dataset.world === entry.id);
    });

    applySeaLevel();
    applyWaterOpacity();
    applyMode();
    loading.classList.add("hidden");
  }

  index.worlds.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.label;
    button.dataset.world = entry.id;
    button.addEventListener("click", () => {
      if (world && world.entry.id === entry.id) return;
      // Let the pressed state and the loading overlay paint before the mesh
      // build blocks the thread for a moment.
      requestAnimationFrame(() => {
        loadWorld(entry).catch((err) => {
          console.error("Failed to switch world:", err);
          loading.textContent = "読み込みに失敗しました。通信状況を確認してください。";
        });
      });
    });
    worldButtons.appendChild(button);
  });

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

  const first = index.worlds.find((entry) => entry.id === index.default) || index.worlds[0];
  await loadWorld(first);
}

main().catch((err) => {
  console.error("Failed to start map:", err);
  const loading = document.getElementById("loading");
  if (loading) {
    loading.textContent = "地図の読み込みに失敗しました。通信状況を確認してください。";
  }
});
