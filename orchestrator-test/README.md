# orchestrator-test

**これは本番開発ではありません。** `world-viewer` リポジトリ上で
Claude ⇄ GitHub ⇄ ChatGPT ⇄ GitHub ⇄ Claude
という往復が正しく動くかどうかだけを確認する、AI間連携の通信テストです。

このディレクトリの中身は Climate v0.8 / Climate v1 のコードや世界データとは
無関係で、`js/`・`worlds/`・`tools/`・`docs/climate-*`・`index.html` を
変更するものではありません。

## 状態機械

`state.json` が唯一の真実源です。各AIは自分の手番のときだけファイルを
書き換え、GitHubへcommit/pushして手番を渡します。

```
CLAUDE_TURN
   │  Claudeがclaude-report.mdに追記し、state.status を進める
   ▼
CHATGPT_TURN
   │  ChatGPTがchatgpt-review.mdに追記し、state.status を進める
   │
   ├─ cycle < maxCycles なら ─▶ CLAUDE_TURN (cycle + 1)
   │
   └─ cycle == maxCycles なら（ChatGPTによる最終監査）─▶ DONE
```

`status` が `CLAUDE_TURN` のときだけClaude側のワークフローが処理を行い、
`CHATGPT_TURN` / `DONE` / `ERROR` のときは何もせずに即終了します
(Claude利用枠を無駄に消費しないため)。

**`DONE` にするのは常にChatGPTの手番であり、Claudeが自分の手番で `DONE`
にすることはない**（最終cycleでも同じ）。ChatGPTがClaudeの最終cycleの結果
を監査し終えて初めて `DONE` になる。

### cycle / status の更新ルール（ChatGPT側実装のための取り決め）

- Claudeの手番: `cycle` はそのまま。処理後、`status` を常に `CHATGPT_TURN`
  へ進める（`cycle >= maxCycles` でも `DONE` にはしない）。`lastActor` は
  `CLAUDE`。
- ChatGPTの手番: `cycle < maxCycles` なら、Claudeの結果を確認したうえで
  `cycle` を +1 し `status` を `CLAUDE_TURN` へ進める。`cycle == maxCycles`
  なら、最終監査として `cycle` は変えずに `status` を `DONE` へ進める。
  どちらも `lastActor` は `CHATGPT`。
- どちらの手番でも、処理中に致命的エラーが起きた場合は `status` を
  `ERROR` にして止める（自動では進めない。人間が見るまで待つ）。

### commit SHA の記録ルール

- 各AIは直前の相手のcommit SHAだけをレポートへ記録する。
- 自分自身のcommit SHAはレポート本文へ埋め込まず、GitHub commitを真実源とする。
- 自分自身のSHAを書き込むためのcommit後のamendは禁止する。

## ファイル

- `state.json` — 状態機械の現在値（test名、cycle数、maxCycles、status、lastActor）
- `claude-report.md` — Claude側の各cycleの記録（PING、時刻、入力state、結果、相手のcommit SHA、usage情報）
- `chatgpt-review.md` — ChatGPT側の各cycleの記録
- `README.md` — このファイル
