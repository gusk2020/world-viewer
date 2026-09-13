# ChatGPT Work configuration for the joint test

Target only:

- repository: `gusk2020/world-viewer`
- PR: `#4`
- head: `handoff-joint-test-v1`
- base: `claude/map-app-v0-1-az6aoa`
- event: pull-request commit updates

On each event:

1. Read the PR metadata, latest head SHA, `orchestrator-joint-test/state.json`, `claude-report.md`, and `chatgpt-review.md` from GitHub.
2. If PR #4 is merged, the head/base do not exactly match the values above, or `state.status` is not `CHATGPT_TURN`, make no repository change.
3. Confirm the event/head SHA has not already been processed.
4. Confirm the immediately preceding commit changed only the permitted joint-test files.
5. Confirm `cycle` is between 1 and `maxCycles` and the Claude report contains the matching successful cycle record.
6. Append one review entry to `chatgpt-review.md` and update `state.json` only.
7. If `cycle < maxCycles`, increment cycle by one, set `status` to `CLAUDE_TURN`, set `lastActor` to `CHATGPT`, and record the input Claude commit SHA in `lastInputSha`.
8. If `cycle == maxCycles`, keep the cycle unchanged, set `status` to `DONE`, set `lastActor` to `CHATGPT`, and record the input Claude commit SHA in `lastInputSha`.
9. If validation fails, stop without touching production files. Use `ERROR` or `USER_DECISION` only when a repository record is necessary to explain the stop.

Never modify application, Climate, world-data, workflow, PR state, labels, or unrelated test files. Never merge the PR. Never process more than three cycles.

The Work trigger must remain disabled until the separate Claude authentication test passes.
