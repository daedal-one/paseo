---
id: ADR:frontend/native-dsh-client
type: adr
status: accepted
summary: "Replace the Paseo agent domain with DSH native APIs while retaining useful presentation and platform code."
owners: [daedal-one]
decision_date: "2026-09-15"
decided_by: [carlo]
related: [INV:frontend/dsh-authority]
---

# Use native DSH APIs with the cross-platform shell

## Context

The existing bridge maps DSH sessions and events into Paseo's agent and timeline domain. DSH already provides session controllers, native event history, forwarded interactions and an independent desktop runtime architecture. The fork provides useful React Native presentation and an Electron shell. The portable subset of DSH's current browser client still needs verification on iPhone.

## Decision

Reuse the fork's presentation and shell. Consume a supported portable DSH client face, reusing DSH's Connection, generated remotes and pure projection/state code where they pass native-platform validation. Extract missing portability seams in DSH rather than maintaining copied wire types. DSH owns new host operations. Reuse DSH DesktopHost runtime installation, transport and ownership contracts for the optional managed desktop mode.

Keep the current bridge for the early branded preview and a defined migration window. Switch each capability through an explicit gate, preserving one mutation route. Keep the existing DSH UI until native parity and recovery evidence permits retirement.

## Alternatives and consequences

Keeping the bridge permanently would preserve duplicate agent semantics and limit access to DSH-specific events and services. Embedding only the existing browser UI would not provide a shared native iPhone presentation. A full frontend rewrite would discard useful platform work. The proposed approach requires portable client validation, native presentations for browser-only extensions, backend API additions, and coordinated release compatibility across two repositories.

Carlo accepted this architecture on 15 September 2026. Acceptance does not assert implementation adherence.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: host-runtime.ts](spec:src:packages/app/src/runtime/host-runtime.ts)
- [Current source: projection.ts](spec:src:packages/server/src/server/agent/providers/dsh/projection.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
