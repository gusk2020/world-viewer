# GLM independent review pilot

## Purpose

Run GLM as an independent, non-authoritative second reviewer for a user-selected commit SHA.

## Boundaries

- This pilot is separate from `orchestrator-app-pilot/` and the Claude ↔ ChatGPT handoff.
- GLM may inspect only the selected commit and its diff.
- GLM must not edit files, create files, delete files, stage, commit, push, open or modify pull requests, post comments, change configuration, or use secrets in prompts or output.
- GLM output is a proposal. ChatGPT audits it; the user alone accepts, rejects, or merges changes.
- Maximum review cycles: 2.
- Any transition to PR-event automation, repository writes, or shared orchestration requires a separate reviewed Draft PR.

## Verified manual operation

- GLM runs only in the user's Codespaces session through the local `glm` wrapper.
- The Z.ai credential stays in the Codespaces secret environment. It is not copied to GitHub Actions.
- The reviewer receives a full commit SHA and an explicit read-only instruction. It must return one JSON object with `PASS`, `FINDINGS`, or `BLOCKED`.
- ChatGPT independently verifies any model output against GitHub before it is recorded.
- The existing workflow remains a manual preflight only. It validates an input SHA but does not invoke GLM, access a Z.ai credential, or modify repository content.

## Optional local runner

- Run `./orchestrator-glm-pilot/run-codespaces-review.sh <40-character-lowercase-SHA>` from a clean Codespaces checkout.
- The runner validates the SHA format, confirms the commit exists locally, and stops if the working tree is not clean.
- It invokes the local `glm` wrapper with a fixed read-only review prompt, then emits only the validated final JSON object.
- It never fetches, checks out, stages, commits, pushes, changes configuration, or writes repository files.
