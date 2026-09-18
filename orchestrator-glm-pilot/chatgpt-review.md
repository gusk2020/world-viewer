# ChatGPT review

## Initial design audit

- Verdict: use GLM as an independent second reviewer, not as a continuation of the Claude ↔ ChatGPT state machine.
- Isolation: dedicated branch, dedicated `orchestrator-glm-pilot/` state, and dedicated manual-only workflow.
- Permissions: `contents: read` only; no pull-request, issue, or repository-write permission.
- Trigger: `workflow_dispatch` only. No PR event trigger, no polling, no automatic retry, no automatic merge.
- Current scope: preflight only. The workflow validates a requested full commit SHA and exits without invoking GLM or accessing a secret.
- Deferred: Actions secret configuration, GLM execution, automated result handoff, event triggers, and shared adapter infrastructure.

Status: DRAFT_AWAITING_USER_REVIEW
