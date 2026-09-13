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
   ▼
CLAUDE_TURN  (cycle + 1)
   │
   ... (maxCycles回くり返す)
   ▼
DONE
```

`status` が `CLAUDE_TURN` のときだけClaude側のワークフローが処理を行い、
`CHATGPT_TURN` / `DONE` / `ERROR` のときは何もせずに即終了します
(Claude利用枠を無駄に消費しないため)。

## ファイル

- `state.json` — 状態機械の現在値（test名、cycle数、maxCycles、status、lastActor）
- `claude-report.md` — Claude側の各cycleの記録（PING、時刻、入力state、結果、commit SHA、usage情報）
- `chatgpt-review.md` — ChatGPT側の各cycleの記録
- `README.md` — このファイル
