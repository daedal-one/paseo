---
id: TASK:migration/workspace-overview-session-inspector
type: task
status: accepted
summary: "Deliver a read-only workspace overview and complete compact execution inspector."
owners: [daedal-one]
progress: done
addresses: [REQ:frontend/sessions, REQ:frontend/workspaces-and-tools]
related: [TASK:migration/04-sessions-and-interactions]
blocked_by: []
---

# Workspace overview and compact Session inspector

## Plan

Extend the existing direct DSH client and platform directory screens. Join Workspace membership with the bounded Session listing and pending interactions using native IDs. Keep overview selection local and read-only. Add one full-canvas inspector with Context, Trajectory, Prompt & tools, Usage, Info and Events, reusing shared DSH projections and the generated client. Preserve the conversation, composer, history, creation, registration, search and recovery owners. Expose supported file reads with explicit Session origin and missing shared-memory support honestly.

Coordinate required portable exports with the DSH-owned TASK of the same topic. Qualify the installed artifact before consuming it. Do not replace the existing frontend migration, add a task database or claim formal Work intake and global cutover as part of this increment.

## Acceptance

Focused model tests prove membership, partial listings, read-only selection, retained navigation, request selection and Host replacement. Recorded Session fixtures compare inspection data with existing DSH projections, including compaction, nested calls, deferred details, incomplete usage and older history. Browser and narrow-screen interaction tests prove overview → conversation → inspector → return, compact geometry and retained controls. Typecheck, lint and installed-client checks pass for the changed scope. Physical-device and final cutover qualification remain explicit separate requirements.
