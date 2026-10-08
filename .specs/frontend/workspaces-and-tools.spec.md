---
id: REQ:frontend/workspaces-and-tools
type: requirement
status: accepted
summary: "Provide DSH-owned workspace, file, repository, terminal and artifact workflows."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Workspaces and host development operations

:::{requirement id="workspaces-and-tools" level="MUST"}
Workspace organization MUST use DSH workspace identity and operations. Files, write/patch operations, repository/worktree actions, terminals, previews and artifacts MUST use authorized DSH host capabilities with visible availability. File mutations MUST detect stale revisions. Terminal reconnect, input, resize and cancellation MUST respect host ownership and bounded transport. Remote paths MUST NOT be interpreted as local device paths. Missing operations MUST be implemented in DSH before claiming feature parity.
:::

## Verification

Verify workspace ordering/archive, read and edit conflicts, permission-denied paths, repository action outcomes, terminal suspend/reconnect and preview isolation. Test download/share on iPhone and desktop with the same host files. Confirm no required flow retains a standalone Paseo execution authority.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: host-runtime.ts](spec:src:packages/app/src/runtime/host-runtime.ts)
- [Current source: daemon-client.ts](spec:src:packages/client/src/daemon-client.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
