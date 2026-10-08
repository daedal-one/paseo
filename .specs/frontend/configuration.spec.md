---
id: REQ:frontend/configuration
type: requirement
status: accepted
summary: "Expose DSH models, credentials, presets, plugins, skills and context through their owners."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# DSH configuration and extensions

:::{requirement id="configuration" level="MUST"}
Daedal DSH MUST expose host-supported model/provider, preset, settings, skill, plugin and memory/context views and approved operations through DSH. Configuration writes MUST handle conflicts and lifecycle outcomes. Provider secrets MUST remain host-side; client UI receives redacted metadata. Privileged plugin installation or management MUST use a dedicated DSH authority. Extension presentation MUST preserve understandable supported output without evaluating arbitrary remote UI code.
:::

## Verification

Test model selection, redacted credential writes and OAuth return paths, conflicting settings changes, inventory failures and supported management recovery. Verify browser-only extension presentations are explicitly ported or capability-limited. Unknown tools have readable details; unknown required events retain DSH refusal behavior.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: host-runtime.ts](spec:src:packages/app/src/runtime/host-runtime.ts)
- [Current source: agent.ts](spec:src:packages/server/src/server/agent/providers/dsh/agent.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
