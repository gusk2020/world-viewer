# 06. AEON: Living Worlds (Linutesto/aeon-living-worlds)

- Repository: https://github.com/Linutesto/aeon-living-worlds
- 調査日: 2026-09-09（Haikuサブエージェントによるclone・一次抽出 + Sonnetによる評価）
- 著者: linutesto（Éthiqueia lab、独立AI研究、ローカル完結志向）

## 概要

**[事実]** Python製、ブラウザ表示（Three.js/WebGL、FastAPI+WebSocket）の「生きている世界」シミュレーション。決定論的シミュレーション層（地形・気候・都市・文明・種・資源）に、オプションのローカルLLM「world-spirit（統治者）」を組み合わせる設計。個体（市民）レベルの人格・記憶・信条・宗教・派閥まで扱う野心的なスコープ。
**[README記載]** 「数千人の実在する持続的な市民」が「人格・記憶・信条・恨み」を持ち、「宗教・派閥が創発し、分裂・拡大・国家転覆に至る」と主張。

## 対象範囲

**[事実]** L0/L5（地形・気候・都市・文明・種・資源の決定論的シミュレーション）→L1（個体市民、LOD式materialize-on-focusで近傍のみ実体化）→L2（種ごとの強化学習ポリシー、Advantage-Weighted Regression）→L3/L4（信条・宗教・派閥という創発的マクロ構造、及びLLM統治者）という5層のアーキテクチャ。加えて「Society Mind」という27B教師モデル→学生モデル蒸留スタック（プロトタイプ）を持つ。

## 状態変数

**[事実]** 市民（Person）: name, sex, age, species, profession, education, social class, Big Five性格, skills(farming/combat/trade/crafting/scholarship/leadership/diplomacy/seafaring/healing/faith), ideology(piety/radicalism/militarism/mercantilism/traditionalism), grievance, religion_id, faction_ids, relationships, wealth, health, status, memory(salience/valence/tick/subjects)。都市: population, growth_rate, food_production, culture, infrastructure(1-10), influence_radius, wealth, specialty, famine/plague/unrest状態。文明: city_ids, tech, relations, ideology。`WorldParams`: rainfall_multiplier, temperature_bias, storm_intensity, sea_level, volcanic_activity, tectonic_drift, resource_richness, plant_growth, prey_fertility, predator_fertility, mutation_rate, carrying_capacity, civ_expansion_drive, war_propensity, tech_progress（LLMが書き込める唯一の面）。

## 時間の扱い

**[事実]** シミュレーションループとLLM統治者ループが非同期・独立クロックで動作（デカップリング）。シムループは固定`loop_hz`で起動し、UI速度倍率でスケール。統治者ループは`governor.tick_seconds`（典型10〜30秒）という別の遅いクロックで動作し、片方が他方をブロックしない設計。

## 空間の扱い

**[事実]** NumPyグリッド（height×width）による地形・気候。値ノイズによる高度マップ＋グリーディな下り坂河川彫刻＋標高・気候からのバイオーム分類。ユニット（交易商・キャラバン・移民・探検家・軍隊）は座標間を移動し、クライアント側で60fps補間表示。

## 主要因果関係

**[事実]** 地形・気候（決定論的グリッド計算）→資源（食料は再生可能でロジスティック回帰、鉱物・エネルギーは一度だけシードされ枯渇）→都市（適地性=食料+淡水+温暖+低標高が高い場所に発生、影響圏内の食料収穫で成長）→文明（都市を所有、隣接文明との関係が国境侵食で低下→war_propensity roll→開戦）→市民（都市人口の一部のみ実体化、LOD式）→信条・恨み（飢饉・疫病・貧困・内乱で上昇、安定で緩やかに減衰）→宗教（カリスマ的篤信者が創始、都市間に伝播、大教団は分裂しうる）→派閥（適性のある人物が確率的に創設、影響力が閾値超えで革命→都市が離反し新文明を樹立）。

**[Sonnetによる評価]** この因果連鎖自体は「個体の信条・恨み→宗教/派閥の創発→革命による国家分裂」という、今回のアプリが目指す「文化・社会構造の創発」に近い野心的な設計。ただし個体を全数シミュレーションせずLOD（Level of Detail、"materialize-on-focus"）で近傍のみ実体化する設計は、計算コストとリアリズムのトレードオフを扱う実践的な工夫として特に参考になる。

## エージェントの有無

**[事実]** あり。ただし全市民を常時シミュレートするのではなく、「注目（focus）されている都市」の住民のみを`MAX_PEOPLE`（4000人）の予算内で実体化する。未注目都市の目立たない人物から解放（削除）される仕組み。

## 確率性・seed

**[事実]** `aeon/rng.py`による決定論的な名前付きRNGストリーム。seedからの再現性をテストで検証（`test_restart.py`等）。

## 実データ利用

**[事実]** なし。完全架空の惑星生成（地形はvalue noise由来）。

## 校正・検証方法

**[事実]** 実データ照合はなし。約3100行・24ファイルのテストスイートで決定論性、ワールド設定の妥当性検証、建物配置の衝突検出、セーブ/ロード、種ポリシー学習等をテスト。

## シミュレーションとLLMの境界（最重要セクション）

**[事実（コード・ドキュメント確認済み）]** `docs/ARCHITECTURE.md`に明記された核心的不変条件: 「シミュレーションのみが世界を変更する。統治者LLMはクランプされたDirectiveのみを発行できる。どの層も手書きで結果を描くことはない」。

LLMは6箇所で呼ばれる:
1. **統治者の意思決定**（`governor.py`、governor.tick_secondsごと）: 統計スナップショット＋記憶要約＋直近履歴を入力し、JSON形式のdirective（`adjust_param`, `set_param`, `trigger_event`, `spawn_species`, `set_goal`, `add_myth`の6種のみ許可）を出力。各directiveは`BOUNDS`辞書で上下限がクランプされ、無効なdirectiveは拒否される。
2. **年代記ナレーション**（`chronicle.py`、イベント駆動）: 読み取り専用の散文生成。
3. **市民インタビュー**（`interview.py`、プレイヤーのオンデマンド要求）: 読み取り専用ロールプレイ。
4. **フレーバー生成**（`flavor.py`）: 読み取り専用（噂・ニュース・日記・説教・訃報）。
5. **背景ナレーション・解釈**（`interpret.py`）: 読み取り専用（伝記・新聞のキャッシュ済み解釈）。
6. **Society Mind教師**（`teacher.py`、27Bモデル）: **唯一、市民の内心状態（信条・目標・思想）に書き戻す**LLM呼び出し。

LLMがOllamaに到達できない場合、決定論的な「オフラインspirit」（`llm.py:_offline()`）が代わりに機能し、統計を見て最悪の指標を粗く調整するdirectiveを返す——モデルなしでもテストが通り、世界が「呼吸し続ける」設計。

**[Sonnetによる評価]** これは今回のユーザーが目指す「数値・確率モデル→世界状態確定→LLMが解釈・命名・説明・物語化」という設計思想の、10件中最も具体的で実装可能な参照例。特に重要な点:
1. **ホワイトリスト化されたdirective型＋パラメータのハードクランプ**により、LLMが「世界の絶対的事実を決める」ことを構造的に防いでいる。
2. **統治者ループとシムループの完全なクロック分離**により、LLMの応答遅延がシミュレーションの決定論性・速度に影響しない。
3. **オフラインフォールバック**により、LLM APIが使えない場合でもシステム全体が機能し続ける（テスト時にモデル不要）。
4. 唯一の例外である「teacher」（市民の信条への書き戻し）は、それでも「既存の信条状態を確率的に調整する」だけであり、都市・文明・地形といった「客観的事実」には触れない、という区別が徹底されている。

## 今回のアプリに有用な一般原理

**[Sonnetによる評価]**
1. **LLMが書き込める面を単一の「パラメータ集合＋許可されたdirective型のホワイトリスト」に限定する**設計は、今回のアプリの「LLMが世界の事実を勝手に決めない」という要求への直接的な実装テンプレート。
2. **LOD式のエージェント実体化（materialize-on-focus）**は、大規模世界で個体レベルのリアリズムを部分的に持たせつつ計算コストを抑える一般原理として非常に有用。
3. **シミュレーションクロックとLLMクロックの分離**は、LLM呼び出しの遅延・コストがゲームプレイ/シミュレーション速度を左右しないための必須設計。
4. **オフラインフォールバックspirit**という考え方は、LLM層を後付け可能な「解釈レイヤー」として設計する際の安全弁になる。

## 現時点では不要な部分

**[Sonnetによる評価]** 27B教師モデルによる市民思想の蒸留学習（Society Mind）は非常に高コストかつ「プロトタイプ」と自称されており、今回のアプリの初期段階では過剰投資。種ごとの強化学習ポリシー（AWR）も、今回の目的（人類史創発）には直接寄与しない範囲。

## 模倣に見えやすい固有要素

**[Sonnetによる評価]** 「world-spirit」という統治者LLMの人格的な呼称、Big Five性格モデル＋5軸ideology（piety/radicalism/militarism/mercantilism/traditionalism）という特定の心理パラメータセット、「Chronicle」という年代記UI名称は、このプロジェクト固有の表現。ただし研究プロジェクトでありUIの複雑な意匠は少ないため、模倣リスクは主に「LLM境界の設計思想」を無批判にコピーすることではなく、命名・パラメータセットの直接借用にある。

## ライセンス

**[事実]** PolyForm Noncommercial License 1.0.0。非商用利用（個人利用・趣味・研究・教育）のみ許可。商用利用は著作権者からの別途ライセンスが必要（連絡先明記）。同梱のテクスチャ素材はCC0で本ライセンスの制約対象外。
**[Sonnetによる評価]** 非商用限定ライセンスのため、たとえ今回のアプリが非商用であっても、コードの直接転用はライセンス条件の精査なしに行うべきではない。「原理だけ参考にし、コードは独立再実装する」対象として明示的に扱うべき。

## コード直接利用の推奨／非推奨

**[Sonnetによる評価]** **非推奨（非商用限定ライセンスのため、将来の用途変更リスクを避ける観点からも）**。ただしLLM境界の設計思想（directive型のホワイトリスト化＋パラメータクランプ＋クロック分離＋オフラインフォールバック）は、公開されたアーキテクチャ文書に基づいて独立に再設計するのが適切かつ十分。

## 重要ファイルパス

**[事実]**
- `aeon/governor/directives.py` — LLM directiveのスキーマ検証・安全な適用（`_set_param`等）
- `aeon/governor/governor.py` — 統治者のthink→act思考サイクル
- `aeon/governor/llm.py` — Ollamaクライアント＋オフラインフォールバック
- `aeon/sim/params.py` — `WorldParams`とその`BOUNDS`（LLMが書き込める唯一の面）
- `aeon/sim/world.py` — 決定論的な`tick()`（seed+params+directives+ticksの純関数）
- `aeon/agents/population.py` — LOD式materialize-on-focus
- `docs/ARCHITECTURE.md` — 「シミュレーションのみが世界を変更する」という核心的不変条件の文書化

## 重要な参考論文

**[事実]** コード・ドキュメント内に学術論文の引用は見つからず。独立系ラボ（Éthiqueia）による自主研究プロジェクトと位置付けられている。

## 確信度

高。「シミュレーション対LLM境界」というユーザーの最重要関心事について、Haikuエージェントがコード引用付きで極めて具体的に抽出している。

## 未確認事項

- WorldParamsの各`BOUNDS`の具体的な数値範囲
- Society Mind（教師→学生蒸留）の成熟度・安定性
- 交易路（`roads.py`）の詳細
- 全ての決定論性保証がすべてのサブシステムで守られているか
