---
id: INV:frontend/dsh-authority
type: invariant
status: accepted
summary: "DSH remains the sole authority for execution, durable sessions and host operations."
owners: [daedal-one]
enforcement: []
applies_to: []
---

# DSH authority

:::{invariant id="dsh-authority"}
Every Daedal DSH operation that changes execution, durable session state, workspace state, permissions, host configuration, files, terminals or automation is resolved and authorized by its DSH owner. Client caches are derived and disposable. A session mutation has one active route during migration; clients do not dual-write through the bridge and native API. Closing a client cannot terminate an externally owned DSH host. A managed desktop runtime cannot start a second independent writer for an already owned DSH data store.
:::

## Enforcement to implement

Native ID and single-route tests, backend permission tests, session replay comparisons, package dependency checks, and desktop ownership/exit/upgrade scenarios. No enforcement is claimed by this draft.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: agent.ts](spec:src:packages/server/src/server/agent/providers/dsh/agent.ts)
- [Current source: daemon-manager.ts](spec:src:packages/desktop/src/daemon/daemon-manager.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
