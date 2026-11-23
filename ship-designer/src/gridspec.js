// 格子と共通点データ（pure）。後から光・昼夜・季節・雲・風・雨・雪を格子単位で設定できる拡張点。
// 気象の実際の分割寸法・制御則・時間表は未確定（ChatGPTと利用者が別途検討）なので、ここでは決めない：寸法は「候補の一覧」と換算だけを持ち、weatherGrid は null のまま。
(function (root) {
  "use strict";
  // 酷道（kudo-fudo-miseisen、branch claude/s43-overhaul）が現在使う格子・単位。実世界 km。
  const KUDO = {
    terrainCellKm: { value: 5, where: "src/core/terrain.ts: cell = max(5, ceil((範囲+2·余白)/GRID_MAX))、GRID_MAX=700", use: "地形・標高・河川・府県・都市の最小の空間単位（placement.ts も『the current smallest spatial unit: 5 km』）" },
    demSplatStepKm: { value: 3, where: "terrain.ts: STEP=3", use: "標高(DEM)を変形メッシュ経由で格子へ貼る内部メッシュ" },
    demCellDeg: { value: 0.087890625, where: "public/japan-dem.bin（GEBCO_2026縮約）", use: "元の標高データ（約9.8km）" },
    borderRasterM: { value: 500, where: "src/render/gmBorders.ts: CELL=500（単位は1/1000度でなく座標系の500）", use: "県境と海岸線を分ける描画用の補助（判定の厳密さ用）。地形の最小マスではない" },
    unitKm2: { value: 0.5, where: "src/sim/reclaim34.ts: UNIT_KM2=0.5", use: "干拓・埋立の予算の数え方の単位（面積であって格子寸法ではない。5km格子=50 km²=100ユニット）" },
    riverAreaKm2: { value: [2200, 550], where: "terrain.ts: RIVER_AREA_KM2 / RIVER_AREA2_KM2", use: "河川と判定する流入面積（主要／支流）" },
  };
  const ship = (km, denom) => km / denom; // 水平は 1/denom
  /** 船内への換算（既定 1/40）。船内のメートルで返す。 */
  function convert(denom) { const d = denom || 40, o = {}; for (const [k, v] of Object.entries(KUDO)) if (k.endsWith("Km")) o[k.replace("Km", "ShipM")] = (v.value / d) * 1000; return o; }
  /**
   * 共通点データ：船内の1点について、後で 気圧・酸素分圧・温度・局所重力・照明 を計算するのに必要な量を揃える。
   * shipHeightM … 居住面からの高さ(m、軸方向＝上)。 radiusM … 回転軸からの距離。 localGravityG … 遠心による重力(居住面で設定値G、軸で0)。
   * light … 軸上照明の位置（半径方向距離と軸方向の範囲）。 weather … 格子単位の拡張（未設定＝null）。
   */
  function pointData(ship, shipHeightM, zKm) {
    const R = (ship.innerDiameterKm / 2) * 1000, g0 = 9.80665, omega = Math.sqrt((ship.gravityG * g0) / R), r = R - shipHeightM;
    return { shipHeightM, radiusM: r, axisDistanceM: r - ship.axisDiameterM / 2, localGravityG: (omega * omega * r) / g0, rimGravityG: ship.gravityG, omegaRadS: omega, rimSpeedMs: omega * R,
      light: { source: "軸上照明（非回転）", axisRadiusM: ship.axisDiameterM / 2, distanceFromAxisSurfaceM: r - ship.axisDiameterM / 2, lengthKm: ship.cylinderLengthKm, zKm: zKm == null ? null : zKm }, weather: null };
  }
  const SCHEMA = { weatherGrid: { status: "未確定（実際の分割寸法・制御則・時間表は別途検討）", cellKm: null, fields: ["lightLux", "wavelength", "dayNight", "season", "cloud", "wind", "rain", "snow"], note: "格子単位で後から設定できるよう、船内座標の格子を持てる。候補寸法は KUDO / convert() 参照" } };
  const api = { KUDO, convert, pointData, SCHEMA }; root.ShipGrid = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
