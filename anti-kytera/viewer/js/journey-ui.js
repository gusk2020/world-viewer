// グレートジャーニー mode: the controls and what they drive. The model is
// journey.js, the arrows journey-view.js, the range colouring the stage
// shader ("journey" stage). main.js owns the page and calls in here only in
// journey mode; `host` hands over the pieces it owns.
//
// One journey = one fixed environment (the stage fields at the sliders'
// conditions when it started), one start cell and one seed. Changing the
// conditions, the body, the start or the seed starts a new journey from 0.
import * as J from "./journey.js";
import { journeyArrows, shownCount, eras, buildArrowMesh, drawArrows2D, buildStartMarker, maxArrowArea } from "./journey-view.js";
import { ramp, JOURNEY_PASSED } from "./stage-draw.js";
import { centreText } from "./stage-panel.js";
import { decodeElevationGrid } from "./elevation.js";

export const JOURNEY_DEFAULT = { seaMetres: -120, tempC: 8 };
const STORE = "akJourney";
// what is drawn: arrows alone over the trip's background (the default), or
// the reached/settled range filled in under them
const DISPLAYS = [["arrows", "表示 矢印のみ"], ["fill", "表示 塗り＋矢印"]];
const PLAY_SECONDS = 24;            // a whole journey plays in about this long
const fmtYears = (y) => `${Math.round(y).toLocaleString("ja-JP")}年`;
const fmtArea = (km2) => km2 >= 1e4 ? `${Math.round(km2 / 1e4).toLocaleString("ja-JP")}万km²` : `${Math.round(km2).toLocaleString("ja-JP")}km²`;

function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
function save(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode: fine */ } }

// host: { $, stages(), globe(), worldConfig(), map2d(), is2d(), refresh2d(), refreshLegend(), conditions() -> {sea, temp} }
export function createJourneyUI(host) {
  const { $ } = host;
  const saved = load();
  let seed = Number.isInteger(saved.seed) ? saved.seed : J.newSeed();
  let requested = saved.lng != null ? { lng: saved.lng, lat: saved.lat } : null;   // what the user chose
  let start = null, env = null, journey = null, t = 0, playing = false, armed = !requested;
  let display = 0, message = "", lastOverlayKey = "", last2d = 0, lastLegend = 0;
  let arrows = [], arrowMesh = null;           // every arrow of this journey, and its globe mesh
  const persist = () => save({ seed, lng: requested?.lng, lat: requested?.lat });

  const els = {
    panel: $("journey-panel"), play: $("journey-play"), time: $("journey-time"), timeText: $("journey-time-readout"),
    start: $("journey-start"), pick: $("journey-pick"), seed: $("journey-seed"), reseed: $("journey-reseed"),
    display: $("journey-display"), status: $("journey-status"),
  };

  // ------------------------------------------------ running a journey
  // The terrain that decides land and water is bedrock: Earth declares its
  // sub-ice bedrock (terrain.journeyBedrock), never the ice-surface display
  // terrain; a body without ice sheets uses its probe DEM, which is the same
  // source as its stage bedrock. Fetched once per URL.
  const bedrockCache = new Map();
  function bedrockFor(config) {
    const spec = config.terrain.journeyBedrock;
    if (!spec) return Promise.resolve(host.globe().getElevation());
    if (!bedrockCache.has(spec.url)) {
      bedrockCache.set(spec.url, new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(decodeElevationGrid(image, config.terrain.encoding));
        image.onerror = () => { bedrockCache.delete(spec.url); reject(new Error(`failed to load ${spec.url}`)); };
        image.src = spec.url;
      }));
    }
    return bedrockCache.get(spec.url);
  }
  // The model runs in a worker (journey-worker.js) when the browser allows it,
  // else here; either way the same journey.js. calc(kind, payload) -> result.
  const JOURNEY_FIELDS = ["bed", "T_fit", "P_fit", "E_fit", "H_fit", "veg_fit", "seaice"];
  let worker = null, workerSeq = 0;
  const pending = new Map();
  // in the page: the same code, blocking while it runs (runs use the page's
  // copy of the environment, which rebuild() always keeps)
  function local(kind, payload) {
    if (kind === "env") return { env: J.buildEnvironment(payload.inputs) };
    return { journey: J.runJourney(env, payload.cell, payload.seed) };
  }
  try {
    worker = new Worker(new URL("./journey-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); data.error ? p.reject(new Error(data.error)) : p.resolve(data); };
    worker.onerror = () => {                                    // e.g. workers not allowed here: finish what was asked in the page
      worker = null;
      const left = [...pending.values()]; pending.clear();
      for (const p of left) { try { p.resolve(local(p.kind, p.payload)); } catch (e) { p.reject(e); } }
    };
  } catch { worker = null; }
  function calc(kind, payload) {
    if (!worker) { try { return Promise.resolve(local(kind, payload)); } catch (e) { return Promise.reject(e); } }
    const id = ++workerSeq;
    let msg = { id, kind, ...payload };
    if (kind === "env") {
      const F = payload.inputs.fields, fields = {};
      for (const k of JOURNEY_FIELDS) if (F[k]) fields[k] = { data: F[k].slice(), meta: F[k].meta };   // copy just this field, not the buffer it views
      msg = { id, kind, inputs: { ...payload.inputs, fields } };
    }
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, kind, payload }); worker.postMessage(msg); });
  }

  let rebuildToken = 0, runToken = 0;
  async function rebuild() {                 // new environment (conditions or body changed)
    const stages = host.stages(), globe = host.globe(), config = host.worldConfig();
    if (!stages || !globe || !config) return;
    const token = ++rebuildToken;
    pause(); journey = null; env = null; arrows = []; stages.setJourney(null);
    message = "地形を読み込み中…"; render();
    let fine;
    try { fine = await bedrockFor(config); }
    catch { if (token === rebuildToken) { message = "岩盤の地形を読み込めませんでした。通信状況を確認してください。"; render(); } return; }
    if (token !== rebuildToken || host.stages() !== stages) return;      // superseded
    message = "旅の環境を計算中…"; render();
    let built;
    try { built = await calc("env", { inputs: { ...stages.journeyInputs(), fine } }); }
    catch { if (token === rebuildToken) { message = "旅の環境を計算できませんでした。"; render(); } return; }
    if (token !== rebuildToken || host.stages() !== stages) return;
    env = built.env;
    message = "";
    return run();
  }
  async function run() {
    pause();
    const token = ++runToken;
    journey = null; start = null; t = 0; arrows = [];
    host.stages()?.setJourney(null);
    if (!env) return;
    if (!requested) { message = "地図をタップして出発点を選んでください（地球ではアフリカ上の1点）。"; armed = true; render(); return; }
    const r = J.resolveStart(env, requested.lng, requested.lat);
    if (r.cell < 0) {
      message = `選んだ地点（${r.reason}）の近くに定住できる陸がありません。地図をタップして別の出発点を選んでください。`;
      armed = true; render(); return;
    }
    const moved = r.movedKm > 0
      ? `選んだ地点は${r.reason}のため、${r.direction}へ${Math.round(r.movedKm).toLocaleString("ja-JP")} km の定住できる陸へ移しました。`
      : "";
    message = "旅を計算中…"; render();
    const runEnv = env;
    let done;
    try { done = await calc("run", { cell: r.cell, seed }); }
    catch { if (token === runToken) { message = "旅を計算できませんでした。"; render(); } return; }
    if (token !== runToken || env !== runEnv) return;                       // superseded
    start = r; message = moved;
    journey = done.journey;
    arrows = journeyArrows(journey);
    host.stages().setJourney(journey);
    setTime(0);
    play();
  }

  // ------------------------------------------------ time
  function setTime(years) {
    t = Math.max(0, Math.min(journey ? journey.endYear : 0, years));
    host.stages()?.setJourneyTime(t);
    render();
    const now = performance.now();
    if (host.is2d() && (now - last2d > 250 || !playing)) { last2d = now; host.refresh2d(); }
  }
  let raf = 0, prev = 0;
  function frame(now) {
    if (!playing) return;
    const rate = Math.max(1000, (journey?.endYear || 0) / PLAY_SECONDS);
    setTime(t + rate * Math.min(0.1, (now - prev) / 1000));
    prev = now;
    if (!journey || t >= journey.endYear) { pause(); return; }
    raf = requestAnimationFrame(frame);
  }
  function play() {
    if (!journey) return;
    if (t >= journey.endYear) setTime(0);
    playing = true; prev = performance.now(); raf = requestAnimationFrame(frame); render();
  }
  function pause() { playing = false; cancelAnimationFrame(raf); if (host.is2d()) host.refresh2d(); render(); }

  // ------------------------------------------------ what is on screen
  // The globe overlay (start marker + every arrow) is built once per journey;
  // moving in time only changes how many arrows the mesh draws.
  function updateOverlay() {
    const globe = host.globe();
    if (!globe) return;
    host.stages()?.setJourneyFill(DISPLAYS[display][0] === "fill");
    const key = journey ? `${journey.seed}|${journey.startCell}|${env?.seaLevel}|${journey.endYear}` : "none";
    if (key !== lastOverlayKey) {
      lastOverlayKey = key;
      arrowMesh = null;
      if (!journey) { globe.setOverlay(null); return; }
      const group = buildStartMarker(start.lng, start.lat, globe.surfaceRadiusAt);
      arrowMesh = buildArrowMesh(arrows, globe.surfaceRadiusAt);
      group.add(arrowMesh.mesh);
      globe.setOverlay(group);
    }
    arrowMesh?.setTime(t);
  }
  function render() {
    els.play.textContent = playing ? "❚❚ 停止" : "▶ 再生";
    els.play.disabled = !journey;
    const end = journey ? Math.ceil(journey.endYear / 100) * 100 : 0;
    els.time.max = String(end); els.time.value = String(Math.round(t));
    els.time.disabled = !journey;
    els.timeText.textContent = `出発から ${fmtYears(t)}`;
    els.start.textContent = start ? `出発点 ${centreText(start.lng, start.lat).replace("中央 ", "")}` : "出発点 未選択";
    els.pick.classList.toggle("active", armed);
    els.pick.textContent = armed ? "タップ待ち…" : "出発点を選ぶ";
    els.seed.textContent = `乱数の種 ${seed}`;
    els.display.textContent = DISPLAYS[display][1];
    els.status.textContent = message;
    els.status.hidden = !message;
    updateOverlay();
    const now = performance.now();
    if (!playing || now - lastLegend > 400) { lastLegend = now; host.refreshLegend(); }
  }

  // ------------------------------------------------ controls
  els.play.addEventListener("click", () => (playing ? pause() : play()));
  els.time.addEventListener("input", () => { pause(); setTime(Number(els.time.value)); });
  els.pick.addEventListener("click", () => { armed = !armed; message = armed ? "地図をタップして出発点を選んでください。" : ""; render(); });
  els.reseed.addEventListener("click", () => { seed = J.newSeed(); persist(); run(); });
  els.display.addEventListener("click", () => { display = (display + 1) % DISPLAYS.length; render(); host.refreshLegend(); if (host.is2d()) host.refresh2d(); });

  // A tap on the globe or the map, already turned into lng/lat.
  function onTap(lng, lat) {
    if (!armed) return false;
    requested = { lng, lat }; armed = false; persist(); run();
    return true;
  }

  // ------------------------------------------------ readout, legend, 2D
  function readout(lng, lat) {
    const head = `${centreText(lng, lat)}　<span class="k">グレートジャーニー</span>`;
    if (!journey || !env) return `${head}<br>${start ? "" : "出発点を選ぶと旅が始まります"}`;
    const k = J.cellOf(lng, lat), s = J.cellState(journey, env, k, t);
    let what;
    const onIce = env.land[k] && env.ice[k];
    if (s.state === "none") what = onIce ? "陸氷（未到達）" : env.land[k] ? "未到達" : env.permIce[k] ? "通年の海氷（未到達）" : "海（未到達）";
    else if (s.state === "settled") what = `定住（初到達 ${fmtYears(s.arrival)}・定住 ${fmtYears(s.settle)}）`;
    else what = `${onIce ? "陸氷の上を通過" : env.land[k] ? "通過のみ" : env.permIce[k] ? "海氷の上を通過" : "海を渡った"}（初到達 ${fmtYears(s.arrival)}）`;
    const land = env.land[k] && !env.ice[k]
      ? `<br><span class="k">住みやすさ ${env.habit[k].toFixed(2)}・歩く速さ ${env.speed[k].toFixed(2)} km/年・気温 ${env.T[k].toFixed(0)}℃・降水 ${Math.round(env.P[k])} mm/年</span>` : "";
    return `${head}<br><b class="m">${what}</b>${land}`;
  }
  function legend() {
    const end = journey ? journey.endYear : 1;
    let reach = "";
    if (journey && env) {
      let n = 0, r = 0, sN = 0;
      for (let k = 0; k < env.W * env.H; k++) if (J.settleable(env, k)) { n++; if (journey.arrival[k] <= t) r++; if (journey.settleStart[k] <= t) sN++; }
      reach = `・定住できる陸の ${(100 * r / n).toFixed(0)}% に到達、${(100 * sN / n).toFixed(0)}% に定住`;
    }
    const c = host.conditions();
    const isDefault = c.sea === JOURNEY_DEFAULT.seaMetres && c.temp === JOURNEY_DEFAULT.tempC;
    const fill = DISPLAYS[display][0] === "fill";
    const eraList = eras(journey ? journey.endYear : 1);
    const k = (y) => y >= 1000 ? `${(y / 1000).toLocaleString("ja-JP")}千` : `${y}`;
    const eraClasses = eraList.map((e) => [e.rgb, `矢印 ${k(e.from)}〜${k(e.to)}年`]);
    const arrowNote = `矢印：約1000年ごとの移動方向。色はその土地に初めて着いた時代、太さはその期間に新しく到達した土地の面積（最も太い矢印＝約${journey ? fmtArea(maxArrowArea(journey)) : "–"}）。過去の矢印は消さずに残す。人口や移動人数ではない。`;
    return {
      bar: fill ? { colours: Array.from({ length: 256 }, (_, i) => ramp("journey", i / 255)), lo: "0", hi: fmtYears(end), unit: "（定住地の色＝初到達）" } : null,
      classes: fill ? [[JOURNEY_PASSED, "通過のみ"], [[150, 150, 150], "未到達"], ...eraClasses] : eraClasses,
      score: journey ? `出発から ${fmtYears(t)}${reach}・乱数の種 ${seed}` : "出発点を選ぶと旅が始まります",
      note: arrowNote + (fill ? "塗り：定住地は初到達の年、通過のみは淡い色、未到達は旅の条件の植生・海・陸氷を下地に見せる。" : "塗りなし：下地は旅の条件の植生・海・陸氷。") + `旅の条件（旅の間は固定）：海面 ${c.sea > 0 ? "+" : ""}${c.sea} m・平均気温 ${c.temp}℃。` +
        (isDefault ? "約2万年前相当の固定背景を借りた比較実験で、人類拡散期の史実を再現した条件ではない。" : "") +
        " 条件・出発点・乱数の種・天体を変えると、旅は出発からやり直す。" +
        " 移動は0.5°格子の確率的な最短時間の広がり：歩く速さと住みやすさは標高・起伏・植生・気温・降水・湿度・陸氷・海までの距離から決め、" +
        "住めない土地は約700 kmまで、海は1回約180 kmまで渡れる。陸氷と通年の海氷の上は、住めない土地より遅く歩け、苛酷さの残量を使う。海と陸は一歩ごとに、その線上の岩盤（地球は氷床下の岩盤、約20 km格子）で測る。移動能力は一定で、寒さや渡海への適応は入っていない。" +
        "人の数は推定しない。地名・経度・天体名は使っていない。",
    };
  }
  function draw2d(canvas, extent) {
    if (!journey) return;
    drawArrows2D(canvas, extent, arrows.slice(0, shownCount(arrows, t)), start);
  }

  let shown = false;
  function show(on) {
    els.panel.hidden = !on;
    if (on === shown) return;
    shown = on;
    if (!on) { pause(); host.globe()?.setOverlay(null); lastOverlayKey = ""; }
  }

  // test hooks
  const api = {
    rebuild, onTap, readout, legend, draw2d, show, pause, play, setTime,
    worldChanged: () => { lastOverlayKey = ""; },
    state: () => ({ seed, requested, start, t, playing, endYear: journey?.endYear ?? null, armed, message, arrows: arrows.length, shown: shownCount(arrows, t), display: DISPLAYS[display][0], triangles: arrowMesh?.triangles ?? 0 }),
    startAt: (lng, lat) => { requested = { lng, lat }; armed = false; persist(); return run(); },
    setSeed: (s) => { seed = s; persist(); return run(); },
    journey: () => journey,
    env: () => env,
  };
  return api;
}
