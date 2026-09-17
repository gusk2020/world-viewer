# AI app pilot

A bounded real-development test of Claude implementation and ChatGPT audit.

- Base: `claude/map-app-v0-1-az6aoa`
- Head: `ai-app-pilot-accessibility-v1`
- Maximum cycles: 2
- Merge: prohibited until user approval
- Stop states: `USER_DECISION`, `DONE`, `ERROR`

State transitions:

`SETUP -> CLAUDE_TURN -> CHATGPT_TURN -> USER_DECISION`

If ChatGPT requests a correction before the limit:

`CHATGPT_TURN -> CLAUDE_TURN` with the cycle incremented.
