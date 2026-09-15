---
id: REQ:frontend/desktop
type: requirement
status: accepted
summary: "Deliver a desktop shell with explicit backend ownership, installation and rollback."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Desktop attachment and managed DSH runtime

:::{requirement id="desktop" level="MUST"}
The desktop MUST support attachment to existing DSH hosts without owning their lifecycle. Optional managed local execution MUST reuse DSH DesktopHost installation, bundled upstream Node, private transport, profile lock, health-check and recovery contracts. A managed instance MUST NOT compete with another owner of the same store. Renderer access MUST remain limited to typed authorized platform operations. Updates MUST preserve a compatible shell, backend, runtime and profile set.
:::

## Verification

Test external-host client exit, ownership conflict, clean-machine install, offline bundled activation, sleep/resume, failed install and health check, interrupted update and qualified rollback. Verify signing/notarization and fork-owned update destinations before distributed auto-update.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: main.ts](spec:src:packages/desktop/src/main.ts)
- [Current source: preload.ts](spec:src:packages/desktop/src/preload.ts)
- [Current source: daemon-manager.ts](spec:src:packages/desktop/src/daemon/daemon-manager.ts)
- [Current source: runtime-paths.ts](spec:src:packages/desktop/src/daemon/runtime-paths.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
