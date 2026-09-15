---
id: TASK:migration/04-sessions-and-interactions
type: task
status: accepted
summary: "Replace session and workspace presentation with native DSH state."
owners: [daedal-one]
progress: pending
addresses:
  ["REQ:frontend/sessions", "REQ:frontend/interactions", "REQ:frontend/workspaces-and-tools"]
blocked_by: ["TASK:migration/03-native-client"]
---

# Replace session and workspace presentation with native DSH state

## Plan

Implement host-qualified IDs, workspace organization, creation/search/history/fork/queue, attachments, tool presentations and subagent relationships in the shared app. Preserve DSH event and waterfall semantics. Switch each validated capability to one native mutation route.

## Acceptance

Recorded sessions match DSH projections across clients. Real simultaneous approval/question responses, large history, deferred details and interrupted commands produce one correct backend result.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
