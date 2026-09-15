---
id: TASK:migration/06-host-capabilities
type: task
status: accepted
summary: "Complete host operations and DSH workflows."
owners: [daedal-one]
progress: pending
addresses:
  ["REQ:frontend/workspaces-and-tools", "REQ:frontend/workflows", "REQ:frontend/interactions"]
blocked_by: ["TASK:migration/04-sessions-and-interactions"]
---

# Complete host operations and DSH workflows

## Plan

Add required DSH APIs for guarded file edits, Git/worktrees, terminal control, previews, artifacts, goals/plans/jobs/workflows/schedules. Reuse current read APIs. Frontend invokes these operations through DSH, replacing corresponding Paseo authorities.

## Acceptance

The integration matrix passes authorized and rejected operations, revision conflicts, terminal reconnect, durable workflow results and schedule lifecycle where configured. No missing backend method is concealed by a client-only control.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
