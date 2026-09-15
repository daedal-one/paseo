---
id: REQ:frontend/interactions
type: requirement
status: accepted
summary: "Preserve DSH interaction semantics across concurrent clients and reconnection."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Cross-device approvals and questions

:::{requirement id="interactions" level="MUST"}
Approvals and structured questions MUST show the owning DSH request, target, available choices and relevant scope. Only a currently valid request may resolve. Concurrent clients, timeout, cancellation, reconnect and late answers MUST preserve the backend one-winner outcome and waterfall lifecycle. A resolved or withdrawn request MUST NOT be replayed. The client MUST NOT broaden a permission when translating the user choice.
:::

## Verification

Open the same session on two devices, answer concurrently, disconnect during submission and reconnect after resolution. Verify one backend outcome, correct removal on both screens, stale-response rejection, multi-question payloads and no silent permission expansion.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: interactions.ts](spec:src:packages/server/src/server/agent/providers/dsh/interactions.ts)
- [Current source: session.ts](spec:src:packages/server/src/server/agent/providers/dsh/session.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
