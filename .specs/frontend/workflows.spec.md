---
id: REQ:frontend/workflows
type: requirement
status: accepted
summary: "Expose DSH-owned plans, goals, jobs, workflows and schedules with complete supported outcomes."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Plans, goals and automation

:::{requirement id="workflows" level="MUST"}
Users MUST inspect DSH plans, goals, budgets, jobs, workflows and schedules and invoke approved controls supported by the selected host. Workflow state MUST include supported outcomes, errors, outputs and lifecycle relationships. Read-only existing APIs MUST NOT be presented as management APIs. Required missing controls MUST be added to their DSH service and remote owners. The frontend MUST NOT run an independent scheduler or goal loop.
:::

## Verification

Test durable workflow phase/member transitions, goal updates, job cancellation, schedule create/change/pause/remove where configured, permission denial and reconnect after completion. Verify capability-disabled hosts expose meaningful availability information rather than inert controls.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: host-runtime.ts](spec:src:packages/app/src/runtime/host-runtime.ts)
- [Current source: daemon-client.ts](spec:src:packages/client/src/daemon-client.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
