// グレートジャーニー mode: the controls and what they drive. The model is
// journey.js, the arrows journey-view.js, the range colouring the stage
// shader ("journey" stage). main.js owns the page and calls in here only in
// journey mode; `host` hands over the pieces it owns.
//
// One journey = one fixed environment (the stage fields at the sliders'
// conditions when it started), one start cell and one seed. Changing the
// conditions, the body, the start or the seed starts a new journey from 0.
import * as J from "./journey.js";
import { visibleArrows, buildArrowMesh, drawArrows2D, buildStartMarker } from "./journey-view.js";
import { ramp, JOURNEY_PASSED } from "./stage-draw.js";
import { centreText } from "./stage-panel.js";

export const JOURNEY_DEFAULT = { seaMetres: -120, tempC: 8 };
const STORE = "akJourney";
const ARROW_STYLES = [["recent", "矢印 直近"], ["all", "矢印 全期間"], ["none", "矢印 なし"]];
const PLAY_SECONDS = 24;            // a whole journey plays in about this long
const fmtYears = (y) => `${Math.round(y).toLocaleString("ja-JP")}年`;

function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } }
function save(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode: fine */ } }

// host: { $, stages(), globe(), map2d(), is2d(), refresh2d(), refreshLegend(), conditions() -> {sea, temp} }
export function createJourneyUI(host) {
  const { $ } = host;
  const saved = load();
  let seed = Number.isInteger(saved.seed) ? saved.seed : J.newSeed();
  let requested = saved.lng != null ? { lng: saved.lng, lat: saved.lat } : null;   // what the user chose
  let start = null, env = null, journey = null, t = 0, playing = false, armed = !requested;
  let arrowStyle = 0, message = "", lastOverlayKey = "", last2d = 0, lastLegend = 0;
  const persist = () => save({ seed, lng: requested?.lng, lat: requested?.lat });

  const els = {
    panel: $("journey-panel"), play: $("journey-play"), time: $("journey-time"), timeText: $("journey-time-readout"),
    start: $("journey-start"), pick: $("journey-pick"), seed: $("journey-seed"), reseed: $("journey-reseed"),
    arrows: $("journey-arrows"), status: $("journey-status"),
  };

  // ------------------------------------------------ running a journey
  function rebuild() {                       // new environment (conditions or body changed)
    const stages = host.stages(), globe = host.globe();
    if (!stages || !globe) return;
    const inputs = stages.journeyInputs();
    env = J.buildEnvironment({ ...inputs, fine: globe.getElevation() });
    run();
  }
  function run() {
    pause();
    journey = null; start = null; t = 0;
    host.stages()?.setJourney(null);
    if (!env) return;
    if (!requested) { message = "地図をタップして出発点を選んでください（地球ではアフリカ上の1点）。"; armed = true; render(); return; }
    const r = J.resolveStart(env, requested.lng, requested.lat);
    if (r.cell < 0) {
      message = `選んだ地点（${r.reason}）の近くに定住できる陸がありません。地図をタップして別の出発点を選んでください。`;
      armed = true; render(); return;
    }
    start = r;
    message = r.movedKm > 0
      ? `選んだ地点は${r.reason}のため、${r.direction}へ${Math.round(r.movedKm).toLocaleString("ja-JP")} km の定住できる陸へ移しました。`
      : "";
    journey = J.runJourney(env, r.cell, seed);
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
  function updateOverlay() {
    const globe = host.globe();
    if (!globe) return;
    const style = ARROW_STYLES[arrowStyle][0];
    const key = journey ? `${journey.seed}|${journey.startCell}|${Math.floor(t / J.ARROW_YEARS)}|${style}|${env?.seaLevel}` : "none";
    if (key === lastOverlayKey) return;
    lastOverlayKey = key;
    if (!journey) { globe.setOverlay(null); return; }
    const group = buildStartMarker(start.lng, start.lat, globe.surfaceRadiusAt);
    group.add(buildArrowMesh(visibleArrows(journey, t, style), globe.surfaceRadiusAt));
    globe.setOverlay(group);
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
    els.arrows.textContent = ARROW_STYLES[arrowStyle][1];
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
  els.arrows.addEventListener("click", () => { arrowStyle = (arrowStyle + 1) % ARROW_STYLES.length; render(); if (host.is2d()) host.refresh2d(); });

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
    if (s.state === "ice") what = "陸氷（通れない）";
    else if (s.state === "none") what = env.land[k] ? "未到達" : env.permIce[k] ? "通年の海氷（未到達）" : "海（未到達）";
    else if (s.state === "settled") what = `定住（初到達 ${fmtYears(s.arrival)}・定住 ${fmtYears(s.settle)}）`;
    else what = `${env.land[k] ? "通過のみ" : env.permIce[k] ? "海氷の上を通過" : "海を渡った"}（初到達 ${fmtYears(s.arrival)}）`;
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
    return {
      bar: { colours: Array.from({ length: 256 }, (_, i) => ramp("journey", i / 255)), lo: "0", hi: fmtYears(end), unit: "（定住地の色＝初到達）" },
      classes: [[JOURNEY_PASSED, "通過のみ（定住なし）"], [[150, 150, 150], "未到達（下地は旅の条件の植生・海・陸氷）"],
        [[24, 24, 38], "矢印：約1000年ごとの移動方向。太さは相対移動量（人数ではない）"]],
      score: journey ? `出発から ${fmtYears(t)}${reach}・乱数の種 ${seed}` : "出発点を選ぶと旅が始まります",
      note: `旅の条件（旅の間は固定）：海面 ${c.sea > 0 ? "+" : ""}${c.sea} m・平均気温 ${c.temp}℃。` +
        (isDefault ? "約2万年前相当の固定背景を借りた比較実験で、人類拡散期の史実を再現した条件ではない。" : "") +
        " 条件・出発点・乱数の種・天体を変えると、旅は出発からやり直す。" +
        " 移動は0.5°格子の確率的な最短時間の広がり：歩く速さと住みやすさは標高・起伏・植生・気温・降水・湿度・陸氷・海までの距離から決め、" +
        "住めない土地は約700 kmまで、海は1回約120 kmまで渡れる（通年の海氷の上は歩ける）。移動能力は一定で、寒さや渡海への適応は入っていない。" +
        "人の数は推定しない。地名・経度・天体名は使っていない。",
    };
  }
  function draw2d(canvas, extent) {
    if (!journey) return;
    drawArrows2D(canvas, extent, visibleArrows(journey, t, ARROW_STYLES[arrowStyle][0]), start);
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
    state: () => ({ seed, requested, start, t, playing, endYear: journey?.endYear ?? null, armed, message, arrows: journey?.arrows.length ?? 0 }),
    startAt: (lng, lat) => { requested = { lng, lat }; armed = false; persist(); run(); },
    setSeed: (s) => { seed = s; persist(); run(); },
    journey: () => journey,
    env: () => env,
  };
  return api;
}
