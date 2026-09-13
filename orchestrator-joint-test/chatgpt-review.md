# ChatGPT review — ai-joint-auto-v1

ChatGPT-side communication-test record.

ChatGPT acts only when `state.status` is `CHATGPT_TURN` and only after reading the latest GitHub state and changed paths for the input commit.

For cycles 1 and 2, a passing review advances to the next cycle and hands back to Claude. For cycle 3, a passing final review sets `DONE`.
