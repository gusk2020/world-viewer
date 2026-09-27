# Anti-KyTerra（アンティ・キテラ）

既存アプリとは独立した画面です（既存画面への統合はしていません）。

- **現行：段階版（`STAGES.md`）**：岩盤だけの地球 → 海抜0 mの海 → 気温 → 湿度 → 降水 → 陸氷 を順に推定・表示。
  - 地形入力と標高補正の根拠：`TERRAIN.md`
  - 画面：`anti-kytera/index.html`（段階・表示＝モデル/教師/差・検証＝地球適合/地域保留）
  - コード：`stat/fit_stage.py`（推定）、`stat/features.py`（別天体でも計算できる特徴量）、`stat/export_stage.py`（表示データ）
- 他の試作（植生など）への接続仕様：`handoff/INTERFACE.md`（データ `handoff/interface_v3.npz`）
- 過去の版（停止・参考）：物理モデル `RESULTS.md` / `METHODS.md`、統計v2 `STAT.md`
