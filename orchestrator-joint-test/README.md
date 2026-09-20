# Joint handoff test

This branch is for a bounded three-cycle communication test between Claude and ChatGPT through GitHub.
It is not production development and must not be merged.

Only these files may change during the test:
- `orchestrator-joint-test/state.json`
- `orchestrator-joint-test/claude-report.md`
- `orchestrator-joint-test/chatgpt-review.md`

All application, Climate, world-data, and other repository files are out of scope.

`state.json` is the single source of truth. Valid states are `WAITING_AUTH`, `CLAUDE_TURN`, `CHATGPT_TURN`, `USER_DECISION`, `DONE`, and `ERROR`.
The test is limited to three cycles. Claude never sets `DONE`; ChatGPT sets `DONE` only after reviewing cycle 3.

Each side records only the input commit SHA it received. A commit must never try to embed its own future SHA, and amend must not be used for that purpose.

The initial state is `WAITING_AUTH`. The test remains stopped until the Claude credential has passed the separate Claude CI check. ChatGPT's joint-test trigger also remains disabled until that check is complete.

Any unexpected state, cycle number, changed path, conflict, or authentication failure stops the test for human review.

Do not modify PR #1, PR #2, or PR #3 from this test.
