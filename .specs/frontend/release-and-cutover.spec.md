---
id: REQ:frontend/release-and-cutover
type: requirement
status: accepted
summary: "Replace the existing UI only after parity, compatibility and recovery evidence."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Qualified delivery and migration

:::{requirement id="release-and-cutover" level="MUST"}
Daedal DSH MUST retain current DSH UI access during migration and become the default only after the required integration matrix, real-device upgrade, security, lifecycle and recovery gates pass. Client migration MUST preserve host/native references and never rewrite DSH durable logs. Bridge and standalone Paseo harness removal MUST follow native capability readiness and the declared installed-client compatibility window. Releases MUST use owned distribution services and preserve required licenses. Additional platforms MUST pass their own qualification gates.
:::

## Verification

Exercise upgrade from the installed companion, preference import, rollback, old/new supported host/client combinations and daily Mac/iPhone use. Review the parity ledger and verify no required upstream service or duplicate backend authority remains. Inspect real TestFlight and signed desktop delivery separately from compilation success.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: app.config.js](spec:src:packages/app/app.config.js)
- [Current source: eas.json](spec:src:packages/app/eas.json)
- [Current source: electron-builder.yml](spec:src:packages/desktop/electron-builder.yml)
- [Current source: agent.ts](spec:src:packages/server/src/server/agent/providers/dsh/agent.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
