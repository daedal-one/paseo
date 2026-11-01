---
id: REQ:frontend/sessions
type: requirement
status: accepted
summary: "Create and control native DSH sessions with faithful history and durable identity."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Native sessions and transcript fidelity

:::{requirement id="sessions" level="MUST"}
Users MUST create, discover, search, attach, rename, fork, prompt, queue and cancel sessions through DSH capabilities using host-qualified native IDs. History MUST preserve native ordering and meaning for text, reasoning, tools, attachments, deferred details, custom supported events and subagent relationships. Existing sessions MUST remain readable without conversion into a new authoritative frontend log. Model and preset choices MUST come from the selected host.
:::

## Compact execution inspection

Session inspection MUST preserve the existing DSH context analysis, provenance, compaction, trajectory, nested tools, exact recorded prompts and complete tool schemas, usage and timing, environment/permissions, errors and raw events. Inspection MUST use shared DSH projections and generated Remote operations. Host-qualified Session identity MUST anchor every inspection view. Request and event selections MUST remain stable across updates and history prepends; live updates MUST NOT silently move a pinned request. Historical request state and current environment reads MUST remain distinguishable. Unavailable or incomplete data MUST NOT become fabricated zero values or current-state substitutes.

The inspector MUST occupy the main canvas with compact navigation back to its workspace or conversation. At a 1280 by 800 CSS-pixel viewport and default text size, inspection content SHOULD begin within 150 pixels of the application viewport top. Typography, keyboard focus, touch targets, zoom and narrow-screen operation MUST remain usable. Older history and full result bodies MUST remain explicit bounded reads, with cancellation, retry and Host-generation ownership.

## Verification

Compare old and new UI projections against the same DSH recorded sessions, including subcalls, failed tools, large results and child sessions. Verify pagination, search, creation, queued follow-ups and reconnect do not duplicate messages or load entire cold histories.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: agent.ts](spec:src:packages/server/src/server/agent/providers/dsh/agent.ts)
- [Current source: session.ts](spec:src:packages/server/src/server/agent/providers/dsh/session.ts)
- [Current source: projection.ts](spec:src:packages/server/src/server/agent/providers/dsh/projection.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
