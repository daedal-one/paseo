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

:::{requirement id="continuous-shippability" level="MUST"}
Each migration increment MUST keep the harness shippable for daily use, preserve supported installed-client behavior and current DSH UI access, and leave unfinished capabilities unavailable or explicitly opt-in. Cross-repository changes MUST have a qualified publication order that preserves a usable supported Host/client combination after each step. Recovery MUST use a known working compatible release or the documented backup procedure; retained Session generations do not imply downgrade support. Daily-use regressions MUST take priority over expansion into later phases.
:::

:::{requirement id="phase-publication" level="MUST"}
Each migration phase MUST be pushed to the affected daedal-one origins after its acceptance checks and relevant regression checks pass. Every push MUST be treated as a release because pushed changes deploy automatically. Validation MUST cover the entire outgoing commit range, including earlier unpublished commits; partial milestones and unrelated passing tests do not establish phase completion. Before publication, verify the intended remote and branch, inspect the outgoing changes, and pass normal repository hooks. After publication, verify the remote commit and inspect available CI and deployment evidence, reporting source publication, pending checks, deployment and device availability separately. The existing migration branches remain the targets unless Carlo names another branch; phase publication does not authorize merging into main or master.
:::

:::{requirement id="phase-testflight-delivery" level="MUST"}
Each completed phase that changes the iPhone app MUST rebuild and submit the signed companion app from its qualified candidate to the existing TestFlight app. Delivery MUST preserve the installed bundle identity and configured companion signing/build/submission ownership. Record the source commit, app version, build number and build/submission identifiers, and verify Apple processing and availability to Carlo's existing tester access before reporting the update ready. Source publication, compilation and submission alone do not establish TestFlight availability. Pending processing or a concrete signing/authentication blocker MUST remain explicit; provide testing instructions and known preview limitations when the build is available. Per-phase iPhone delivery MUST NOT wait for final mobile qualification.
:::

## Verification

For each phase, record the exact candidate commits, completed acceptance checks, outgoing change scope, supported Host/client combinations, publication order and recovery procedure. Verify the remote commits and distinguish pending CI or unobserved deployment from confirmed availability.

Exercise upgrade from the installed companion, preference import, rollback, old/new supported host/client combinations and daily Mac/iPhone use. Review the parity ledger and verify no required upstream service or duplicate backend authority remains. Inspect real TestFlight and signed desktop delivery separately from compilation success.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: app.config.js](spec:src:packages/app/app.config.js)
- [Current source: eas.json](spec:src:packages/app/eas.json)
- [Current source: electron-builder.yml](spec:src:packages/desktop/electron-builder.yml)
- [Current source: agent.ts](spec:src:packages/server/src/server/agent/providers/dsh/agent.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
