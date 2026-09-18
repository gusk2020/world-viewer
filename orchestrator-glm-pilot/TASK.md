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

## Initial operation

The workflow is manual-only and performs a preflight check. It intentionally does not invoke GLM or access an API key. A later, separately reviewed change may add an execution step after the user has configured a dedicated GitHub Actions secret and approved the exact runner behavior.
