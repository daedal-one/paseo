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

## Verification

Compare old and new UI projections against the same DSH recorded sessions, including subcalls, failed tools, large results and child sessions. Verify pagination, search, creation, queued follow-ups and reconnect do not duplicate messages or load entire cold histories.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: agent.ts](spec:src:packages/server/src/server/agent/providers/dsh/agent.ts)
- [Current source: session.ts](spec:src:packages/server/src/server/agent/providers/dsh/session.ts)
- [Current source: projection.ts](spec:src:packages/server/src/server/agent/providers/dsh/projection.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
