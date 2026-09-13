# Activation

Current status is intentionally `WAITING_AUTH`.

Before starting the three-cycle test, verify that the separate Claude CI authentication check has passed, that this PR is still open and unmerged, and that no production files have changed.

After those checks, change only `state.status` from `WAITING_AUTH` to `CLAUDE_TURN`. The joint test must not exceed three cycles.
