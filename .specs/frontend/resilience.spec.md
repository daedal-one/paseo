---
id: REQ:frontend/resilience
type: requirement
status: accepted
summary: "Keep sessions usable across device suspension, disconnects and large histories."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Offline state and bounded client resources

:::{requirement id="resilience" level="MUST"}
Clients MUST show connection and cache freshness, retain unsent drafts, bound cached history and large result loading, and reconcile state on foreground/reconnect. The mobile UI MUST NOT rely on continuous background sockets for correctness. Host switching and revocation MUST isolate cached private data. Notifications, when configured, MUST re-fetch authorized details and avoid private payload content by default. Performance acceptance MUST use recorded device, network, fixture and build baselines.
:::

## Verification

Exercise 10,000-event history, deferred results, cold/warm launch, network transitions, phone suspension, host restart and credential expiry. Record memory plateau and latency; adopt absolute budgets from measured baseline before task acceptance. Confirm reconnect never repeats a mutation.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: host-runtime.ts](spec:src:packages/app/src/runtime/host-runtime.ts)
- [Current source: daemon-client.ts](spec:src:packages/client/src/daemon-client.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
