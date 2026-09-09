# ライセンス・出典整理（Pass 6）

10件それぞれについて、リポジトリ・確認日・ライセンス・参考にしたファイル・参考にした論文・原理のみ参考にする方針・コード利用候補・コード利用回避の判断を一覧化する。これは「GPL/AGPL等からコードをコピーしていないことを後から確認できる記録」として機能させることを意図している。

**総括**: 10件中、MIT2件（Azgaar, WorldEngine）を除く8件はコピーレフト（GPLv3/GPL-3/AGPL-3.0）・非商用限定（PolyForm Noncommercial）・ライセンス不明のいずれかであり、**本調査ではいずれのプロジェクトからもソースコードの複製・移植は行っていない**。すべてのMarkdown調査資料は、各リポジトリのREADME・ドキュメント・ソースコードを読解した上でのSonnet/Haikuによる独立した記述であり、コードそのものの転載は各ファイル内の必要最小限の短い引用（数式・関数シグネチャ等、事実確認のための引用）に限定している。

## 一覧表

| # | プロジェクト | Repository | 確認日/commit | ライセンス | 参考にした主なファイル | 参考にした主な論文 | 方針 |
|---|---|---|---|---|---|---|---|
| 01 | World Orogen | https://github.com/raguilar011095/planet_heightmap_generation | 2026-09-09 / commit `cc2662b` | **GPLv3**（コピーレフト） | `js/wind.js`, `js/precipitation.js`, `js/temperature.js`, `js/koppen.js`, `js/elevation.js`, `tuning/climate/` | Barnes et al.（priority-flood、書誌不明）, Braun-Willett（stream power侵食、書誌不明） | **原理のみ参考**。気圧帯・移流・雨陰の因果構造とEarthデータへの自動チューニングループの発想を独立再実装する。コード利用は非推奨。 |
| 02 | MayaSim | https://github.com/pik-copan/MayaSim | 2026-09-09 / commit `ac7de57` | **GPL-3**（コピーレフト） | `mayasim/model/core.py`, `mayasim/model/parameters.py` | Heckbert (2013) DOI:10.18564/jasss.2305; Kolb (2020) DOI:10.18452/22147 | **原理のみ参考**。環境-食料-人口-社会フィードバックループの構造とBCA式の発想を独立再実装する。コード利用は非推奨。 |
| 03 | Azgaar FMG | https://github.com/Azgaar/Fantasy-Map-Generator | 2026-09-09（shallow clone） | **MIT**（再利用可） | `src/generators/cultures-generator.ts`, `religions-generator.ts`, `states-generator.ts`, `routes-generator.ts` | 学術論文なし（O'Leary, Patel, Turnerのブログのみ） | **ライセンス上は再利用可能だが、独自性確保のため原理のみ参考**（有名すぎるため模倣リスクが高い）。優先度キュー拡張・Urquhart graph道路網の発想のみ独立再実装。用語・分類体系は不使用。 |
| 04 | Oikoumene | https://github.com/GeoLambdaAI/oikoumene | 2026-09-09（shallow clone） | **AGPL-3.0-or-later**（強いコピーレフト、サーバー提供でもソース開示義務） | `agents.py`, `macro.py`, `geopolitics.py`, `bridge.py`, `history.py` | LeCun (2022); Kahneman (2011); EPICA (2004); Petit et al. (1999); Marcott et al. (2013); Bremer (1992); Russett (1993); Tinbergen (1962) 他61本 | **原理のみ参考**。マクロ-ミクロ橋渡し構造、紛争のロジスティック回帰モデル、多層実データ校正の発想を、引用された公開論文に基づき独立再実装する。コード利用は強く非推奨。 |
| 05 | Genesis | https://github.com/tan-zhuo/genesis | 2026-09-09（shallow clone） | **不明**（LICENSEファイルなし） | `src/simulation/engine.ts`, `Random.ts`, `Technology.ts`, `Warfare.ts`, `Collapse.ts` | Whittaker (1975); Lieth (1975); IPCC; Arrhenius | **原理のみ参考、かつ差別化対象として扱う**。年単位フレッシュRNG・固定フェーズティックの発想のみ独立再実装。性格スライダー設計は意図的に不採用。コード利用は非推奨（ライセンス不明）。 |
| 06 | AEON: Living Worlds | https://github.com/Linutesto/aeon-living-worlds | 2026-09-09（shallow clone） | **PolyForm Noncommercial License 1.0.0**（非商用限定） | `governor/directives.py`, `governor.py`, `llm.py`, `sim/params.py`, `agents/population.py` | 引用なし（独立系ラボの自主研究） | **原理のみ参考**。LLM directiveのホワイトリスト化・パラメータクランプ・クロック分離・オフラインフォールバックという設計思想を、公開されたアーキテクチャ文書の記述に基づき独立に再設計する。コード利用は非推奨（非商用限定ライセンスのため将来の用途変更リスクを避ける）。 |
| 07 | randyau/worldgen | https://github.com/randyau/worldgen | 2026-09-09（shallow clone） | **不明**（LICENSEファイルなし） | `Persistence/EventStore.cs`, `DatabaseSchema.cs`, `HistoryQueryService.cs`, `docs/architecture_decision_records.md` | Dwarf Fortress・The Simsへの言及のみ（学術論文なし） | **原理のみ参考**。SQLiteイベントログのスキーマ設計（型）を、独自のテーブル名・カラム名で再設計する。コード利用は非推奨（ライセンス不明）。 |
| 08 | WorldEngine (Mindwerks) | https://github.com/Mindwerks/worldengine | 2026-09-09（shallow clone） | **MIT**（Copyright 2013-2014 Federico Tomassetti and Bret Curtis、再利用可） | `worldengine/simulations/temperature.py`, `precipitation.py`, `biome.py` | Holdridge生命帯モデル（Wikipedia参照のみ、一次文献なし） | **条件付き再利用可（MIT）だが、実装価値が低いため原理レベルの参考のみ**。「雨陰が実装されていない」という反面教師の教訓のみ活用。視覚回帰テストという検証手法の発想を参考にする。 |
| 09 | NeoNet | https://github.com/zoometh/neonet | 2026-09-09（shallow clone） | **GPLv3**（コピーレフト） | `R/neo_calib.R`, `R/neo_isochr_inter.R`, `R/neo_spd.R` | Ammerman & Cavalli-Sforza (1971); Binder et al. (2018) 他50本超 | **原理のみ参考**。放射性炭素較正→加重中央値→空間補間→等時線という校正手法の発想を独立再実装する。コード利用は非推奨（GPLv3）。データセット自体の利用可能性は別途確認が必要（本調査未確認）。 |
| 10 | Mesoudi migration models | https://github.com/amesoudi/migrationmodels | 2026-09-09（shallow clone） | **不明**（LICENSEファイルなし） | `model1_acculturation_recursions.R`, `model1b_acculturation_ABM.R`, `model2_cooperation_recursions.R` | Mesoudi, A. (2018) PLOS ONE（巻号・DOI不明） | **原理のみ参考**。同調バイアス＋同類性の2パラメータモデルという学術的に公表された一般原理を、論文の説明に基づき独立に再実装する。コード規模が小さくライセンス不明のため、コード利用は非推奨だが必要性も低い。 |

## ライセンス種別ごとの集計

| ライセンス種別 | 件数 | 対象 |
|---|---|---|
| MIT（再利用可） | 2 | Azgaar, WorldEngine |
| GPLv3 / GPL-3（コピーレフト） | 3 | World Orogen, MayaSim, NeoNet |
| AGPL-3.0-or-later（強いコピーレフト） | 1 | Oikoumene |
| PolyForm Noncommercial 1.0.0（非商用限定） | 1 | AEON |
| 不明（LICENSEファイルなし） | 3 | Genesis, randyau/worldgen, Mesoudi migration models |

## コード利用候補（ライセンス上、法的に問題ないと確認できたもの）

- **Azgaar Fantasy Map Generator**（MIT）: 法的には再利用可能。ただし本調査の結論として、独自性確保のため意図的に不採用とし、原理（優先度キュー拡張アルゴリズムの発想）のみ独立再実装する方針とした。
- **WorldEngine**（MIT）: 法的には再利用可能。ただし実装内容自体の完成度が低い（雨陰未実装等）ため、コードとしての採用価値は低いと判断した。

**上記2件を含め、本調査を通じて10件のいずれからもソースコードの複製・移植・vendor化は行っていない。**

## コード利用を明確に避けるべき対象（コピーレフト・非商用・ライセンス不明のため）

World Orogen（GPLv3）、MayaSim（GPL-3）、Oikoumene（AGPL-3.0、特に強い制約）、NeoNet（GPLv3）、AEON（非商用限定）、Genesis（ライセンス不明）、randyau/worldgen（ライセンス不明）、Mesoudi migration models（ライセンス不明）——**合計8件**。これらについては、コード上の数式・アルゴリズムの"アイデア"を、公表された学術論文または公開ドキュメントの記述に基づいて独立に再実装する方針を徹底する。

## 監査用メモ

- 全10件の一次調査はHaikuサブエージェントによる`git clone --depth 1`＋ファイル読解と、Sonnetによる評価の分業で実施した（詳細は各ファイルの冒頭に記載）。
- クローンは`/tmp/prior-art-clones/`（本リポジトリ外、セッション終了時に消失する一時領域）に作成し、**本リポジトリ内へのコード持ち込みは一切行っていない**。
- 各個別調査ファイル（`01`〜`10`）は「実装で確認した事実」「README等の作者説明」「Sonnetによる評価・推論」を明示的に分離して記述しており、本ライセンス表の「参考にした主なファイル」列はいずれも事実確認のための参照であり、コード転載を意味しない。
