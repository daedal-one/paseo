---
id: TASK:migration/01-contract-baseline
type: task
status: accepted
summary: "Approve the migration baseline."
owners: [daedal-one]
progress: in-progress
addresses:
  [
    "INV:frontend/dsh-authority",
    "ADR:frontend/native-dsh-client",
    "IFC:frontend/dsh-connection",
    "REQ:frontend/release-and-cutover",
  ]
blocked_by: []
---

# Approve the migration baseline

## Plan

Refresh both repositories and runtime evidence; inventory DSH methods/events/UI contributions; freeze ownership, compatibility, identity, platform scope and acceptance matrix. Reconcile repository instructions with reviewed Forge Spec authority. Create accepted backend tasks in DSH only for identified gaps.

## Acceptance

Carlo reviews the plan; required durable specs are accepted or revised; every integration row has an owner and scenario; managed-runtime ownership and portable-client assumptions have explicit decision gates. No product implementation is implied by this pending task.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).

[Capability owners and acceptance scenarios](spec:doc:docs/daedal-dsh-capability-map.md). The authenticated compatibility handshake remains an open decision gate.
