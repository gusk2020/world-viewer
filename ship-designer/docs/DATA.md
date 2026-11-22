# データ出典と精度

| 用途 | 出典 | ライセンス | 種別 |
|---|---|---|---|
| 全島の海岸線（109島） | Natural Earth 1:10m admin_0 countries（JPN） | パブリックドメイン | 実データ（0.15〜0.35km許容で簡略化） |
| 小島33島（竹富・小浜・兄島 等）と沖ノ鳥島 | v9 台帳の島カタログ座標 | — | **模式形**（位置のみ。実海岸線に重ならないよう自動縮小） |
| 49府県の定義（ID・名称・県庁・重み） | gusk2020/kudo-fudo-miseisen `src/data/japan.json`（commit 69221ca） | 利用者自身 | 酷道世界の府県（北海道3県・東京府を含む） |
| 府県境 | 上記定義から酷道と同じ重み付き Dijkstra で生成（2.5km格子・GEBCO傾斜コスト・変形なし・河川/手描き山脈なし） | — | **生成データ**（実在の県境ではない） |
| 県庁・都市座標 | Natural Earth populated places（不足6市は公知座標を手入力） | パブリックドメイン | 実データ |
| 傾斜コスト | GEBCO_2026（kudo-fudo-miseisen `public/japan-dem.bin`） | GEBCO利用条件（帰属: GEBCO Compilation Group） | 実データ（約9km解像度） |

- 平面は v9 と同一（経度135°/緯度35°基準、KX=111.32·cos35°、KY=111.12）。保存済み中心座標の意味を変えないため。
- 面積は「この平面上の面積」。高緯度ほど実面積より大きめ（北海道で約1.1倍）。船内面積＝平面面積÷縮尺分母²。
- 府県面積は2.5km格子の集計値（参考値）。
- 再生成：`node tools/build_data.mjs <ne_10m_admin_0_countries.geojson> <ne_10m_populated_places_simple.geojson> <kudo japan.json> <kudo japan-dem.bin>`。Natural Earth は `raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/` から取得した。
- 酷道リポジトリには一切書き込んでいない（読み取りのみ）。
