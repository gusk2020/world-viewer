// v2 stage panel: the legend/notes and the centre readout (元データ値).
// Text only -- main.js puts it on screen. The readout reads the committed
// arrays (F) through cell(); the drawing copies are consulted only to say
// when the screen and the raw cell disagree.
import { ICE_MIN_M, POLAR_AVERAGE_LAT, MODE_JA } from "./stage-data.js";
import { ramp, seaColour, AGREE, EXPOSED, BED_LO, BED_HI } from "./stage-draw.js";

export function createStagePanel(ctx) {
  const { S, V, vcol, vlab, state, cell, bilinear, drawnComposite, rawComposite, isClimate, vm, scale } = ctx;
  // ------------------------------------------------ legend and notes
  const pct = (x) => (x * 100).toFixed(0) + "%";
  function legend() {
    const veg = state.v === "veg";
    const out = { bar: null, classes: null, score: "", note: "" };
    if (veg) {
      const items = [];
      const sc = V.scores[state.mode];
      if (state.src === "diff") {
        items.push([AGREE.same, "一致"], [AGREE.veg, "植生が不一致"], [AGREE.ice, "氷の有無が不一致"],
          [AGREE.none, "教師なし"], [AGREE.sea, "海"]);
      } else {
        for (const c of V.classes) {
          const iou = sc.iou[String(c.code)];
          items.push([c.rgb, c.ja, state.src === "model" && iou != null ? Math.round(iou * 100) : null]);
        }
        items.push([vcol[1], "陸氷"], [seaColour(-3000), "海"]);
        if (state.src === "teacher") items.push([vcol[255], "教師なし"]);
      }
      if (state.seaLevel < 0) items.push([EXPOSED, "干上がった海底（推定なし）"]);
      out.classes = items;
      out.score = `${MODE_JA[state.mode]}：15区分 一致 ${pct(sc.accuracy)}・κ ${sc.kappa.toFixed(2)}・大区分 ${pct(sc.group)}`;
      out.note = {
        model: "モデル：年平均の気温・降水・水蒸気圧（3〜5段階と同じ推定値）と岩盤地形から分類した、通年の代表的な自然植生。数字は種類ごとの一致度（%）。",
        teacher: "教師：Ramankutty & Foley (1999) 潜在自然植生（人の土地利用が無い場合）。南極は教師に区分が無い。",
        diff: "差：モデルと教師を、氷＞海＞植生の順に重ねた最終表示どうしで比べた一致・不一致。",
      }[state.src] + " 重ね順は 氷＞海＞植生。限界：年平均だけなので季節性（常緑/落葉、雨季の有無）は区別できない。";
    } else {
      let rp, lo, hi, unit;
      if (!isClimate()) { rp = "rock"; lo = BED_LO; hi = BED_HI; unit = "m"; }
      else { const sc = scale(); rp = sc.ramp; lo = sc.lo; hi = sc.hi; unit = vm().unit; }
      const colours = [];
      for (let i = 0; i < 256; i++) colours.push(state.v === "sea" && i < 146 ? seaColour(BED_LO + (i / 255) * (BED_HI - BED_LO)) : ramp(rp, i / 255));
      out.bar = { colours, lo, hi, unit: unit + (state.src === "diff" && isClimate() ? "（差）" : "") };
      if (!isClimate()) { out.score = S.stages[state.v].score; out.note = S.stages[state.v].note; }
      else {
        out.score = `${MODE_JA[state.mode]}：${vm().score[state.mode]}`;
        out.note = (state.src === "teacher" ? vm().teacherNote : state.src === "model" ? vm().modelNote : "差 = モデル − 教師。") +
          " " + S.modeNote[state.mode];
      }
    }
    if (isClimate() || veg) out.note += " 地球適合＝見たことのある場所への当てはめ（ほぼ一致して当然）。実力の目安は地域保留。";
    out.note += " 画面の色：緯度60°より極側は、極付近の細いセルの筋を抑えるため東西に平均した値で描く（描画だけ）。" +
      "海岸線・氷の縁は隣のセルとの間を補間した線。中央の数値は常に平均前の元データのセルの値。" +
      " 形は Anti-KyTerra の岩盤（GEBCO_2026 氷床下地形）、光と海面は v1s と同じ。";
    return out;
  }

  // ------------------------------------------------ the centre readout: raw data values
  const SEA_JA = (z) => (z < 0 ? "海" : "陸");
  function readout(lng, lat) {
    const pos = `中央 ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`;
    const polar = Math.abs(lat) >= POLAR_AVERAGE_LAT ? "（この緯度の画面の色は東西平均）" : "";
    const head = `${pos}　<span class="k">元データ値</span>${polar}`;
    const z = cell("bed", lng, lat);
    const tag = `モデル（${MODE_JA[state.mode]}）`;
    const warn = (drawn, raw) => drawn === raw ? "" :
      `<br><span class="w">※画面の塗りは「${drawn}」、元データのセルは「${raw}」（境界付近の補間・平均による差）</span>`;
    // the moved sea surface wins over the 0 m estimates
    const sl = state.seaLevel;
    const seaNote = sl !== 0 && ((z < sl) !== (z < 0))
      ? `<br><span class="w">※海面 ${sl > 0 ? "+" : ""}${sl} m ではここは${z < sl ? "海" : "陸（干上がった海底）"}。塗り分けの推定は海面0 mのまま</span>` : "";
    if (state.v === "bed" || state.v === "sea") {
      const what = state.v === "sea" ? `・${SEA_JA(z)}（海面0 m）` : "";
      const drawnSea = bilinear("bed", lng, lat) < 0, rawSea = z < 0;
      const w = state.v === "sea" && sl === 0 ? warn(drawnSea ? "海" : "陸", rawSea ? "海" : "陸") : "";
      return `${head}<br><b class="m">入力</b> 岩盤 ${z.toFixed(0)} m${what}　<b class="t">教師</b> なし（入力データの段階）${w}${state.v === "sea" ? seaNote : ""}`;
    }
    if (state.v === "veg") {
      const m = rawComposite(state.mode, lng, lat), t = rawComposite("teacher", lng, lat);
      const shown = state.src === "teacher" ? "teacher" : state.mode;
      let w = "";
      if (sl === 0) {
        const dc = (c) => (c === -1 ? "干上がった海底" : vlab[c]);
        w = state.src === "diff"
          ? (drawnComposite(state.mode, lng, lat) !== m || drawnComposite("teacher", lng, lat) !== t
            ? `<br><span class="w">※この地点の画面の塗りは、境界付近の補間・平均で元データのセルと異なる</span>` : "")
          : warn(dc(drawnComposite(shown, lng, lat)), vlab[shown === "teacher" ? t : m]);
      }
      return `${head}<br><b class="m">${tag}</b> ${vlab[m]}　<b class="t">教師</b> ${vlab[t]}${w}${seaNote}`;
    }
    const m0 = vm(), key = m0.key;
    const mod = cell(`${key}_${state.mode}`, lng, lat), tea = cell(`${key}_teacher`, lng, lat);
    const f = (x) => Number.isFinite(x) ? x.toFixed(m0.digits) : null;
    const iceTxt = (x) => x > ICE_MIN_M ? `${f(x)} m` : "氷なし";
    const mv = state.v === "ice" ? iceTxt(mod) : `${f(mod)} ${m0.unit}`;
    const tv = f(tea) == null ? "教師なし" : state.v === "ice" ? iceTxt(tea) : `${f(tea)} ${m0.unit}`;
    const dv = f(tea) == null ? "" : `　差 ${mod - tea >= 0 ? "+" : ""}${f(mod - tea)}`;
    let w = "";
    if (state.v === "ice" && state.src !== "diff") {
      const which = state.src === "teacher" ? "teacher" : state.mode;
      const ice = (x) => (x > ICE_MIN_M ? "氷" : "氷なし");
      w = warn(ice(bilinear(`H_${which}`, lng, lat)), ice(which === "teacher" ? tea : mod));
    }
    return `${head}<br><b class="m">${tag}</b> ${mv}　<b class="t">教師</b> ${tv}${dv}${w}${seaNote}`;
  }

  return { legend, readout };
}
