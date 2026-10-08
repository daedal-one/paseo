---
id: TASK:migration/01-contract-baseline
type: task
status: accepted
summary: "Approve the migration baseline."
owners: [daedal-one]
progress: done
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

Carlo reviews the plan; required durable specs are accepted or revised; every integration row has an owner and scenario; managed-runtime ownership and portable-client assumptions have explicit decision gates. This task approves the design and ownership baseline; cross-device implementation and release evidence belong to the dependent migration tasks.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).

[Capability owners and acceptance scenarios](spec:doc:docs/daedal-dsh-capability-map.md). The accepted DSH interface defines authenticated Host generations, generated endpoint wire fingerprints, business revisions, required Session event handling and device enrollment/revocation. The managed desktop composition retains DSH ownership. Installation and physical-device qualification remain acceptance gates of TASK:migration/03-native-client.
