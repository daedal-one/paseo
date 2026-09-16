---
id: IFC:frontend/dsh-connection
type: interface
status: accepted
summary: "Define portable transport, native identity, capability discovery and mutation reconciliation."
owners: [daedal-one]
consumed_by: []
provided_by: []
stability: experimental
related: [INV:frontend/dsh-authority]
---

# Native DSH client connection

:::{interface id="dsh-connection" level="MUST"}
The supported DSH client surface MUST expose an authenticated host connection with stable host identity, API compatibility, session-wire compatibility and configured feature capabilities. Session and workspace references MUST include host identity and native DSH IDs. The client MUST preserve DSH event identities, ordering, paging, deferred detail and control/interaction semantics across native, browser and managed-desktop transports.

Command submission MUST distinguish confirmed success, confirmed rejection and unknown outcome. A retry MUST use backend-supported deduplication identity or first reconcile the prior outcome; it MUST NOT blindly resubmit a prompt or resolved interaction. Reconnect MUST resume from confirmed server state. Cancellation, disposal, backpressure, authentication expiry and permission errors MUST have explicit outcomes. The renderer MUST NOT receive host provider credentials or arbitrary privileged execution access.
:::

## Portable dependency ownership

The frontend consumes the generated portable DSH Client distribution from a clean source revision with recorded archive hashes and a lockfile. A package-manager installation must resolve only portable dependencies and retain shared Cordis and nominal type identities. Import and bundle checks remain distinct from physical-device and live Session acceptance.

The DSH interface owns Host-generation admission, generated wire fingerprints, business revisions, Session-format acceptance and required-event refusal. Platform adapters supply authenticated transports without changing those semantics. Missing remote operations belong in their DSH owner; unknown tool presentation does not permit dropping required wire events. One Host owns one runtime, credential, hydrated navigation store and disposal lifetime.

## Verification

Exercise the same recorded session and live host across all three client transports. Verify authentication expiry, command timeout after acceptance, reconnect, duplicate decision, large deferred results and a rejected incompatible handshake.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: connection.ts](spec:src:packages/server/src/server/agent/providers/dsh/connection.ts)
- [Current source: wire.ts](spec:src:packages/server/src/server/agent/providers/dsh/wire.ts)
- [Current source: daemon-client.ts](spec:src:packages/client/src/daemon-client.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
