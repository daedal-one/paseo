---
id: TASK:migration/workspace-session-parity
type: task
status: accepted
summary: "Redesign the workspace and reproduce the complete incumbent web Session experience."
owners: [daedal-one]
progress: in-progress
addresses: [REQ:frontend/sessions, REQ:frontend/interactions, REQ:frontend/workspaces-and-tools]
related:
  [
    TASK:migration/durable-workspace,
    TASK:migration/04-sessions-and-interactions,
    INV:frontend/dsh-authority,
  ]
blocked_by: []
---

# Workspace design and complete Session functionality

## Plan

Replace the workspace and Session presentation with a coherent, adaptive design using Impeccable. Preserve the workspace-first model, durable Work, authorized Files and reviewed Memory. Sessions remain execution details with direct access to their full conversation and inspection. Keep desktop and phone controls discoverable without stacked oversized headers, and retain drafts, selected records and inspection state across navigation and viewport changes.

At desktop widths, keep the Work board beside the selected execution's canonical Session interface. Expand inspection without remounting the Session or losing drafts, pending forms or the selected historical Request. On phones, prioritize the selected pane and provide an explicit return to Work. Opening a Session outside its linked Work context must not retain stale Work attribution.

Inventory every user-visible Session feature enabled by the incumbent DSH web composition. Record each feature's existing owner, replacement control and verification evidence in a parity checklist. Include rich transcript and tool presentation, attachments and outputs, creation and configuration, history/search/fork/archive/rename, prompt and queue controls, commands and references, approvals/questions, goals/plans/todos, child Sessions, background jobs, terminal access, feedback, and all inspector details. Distinguish disabled optional plugins and global administration from the active Session baseline. A tab label, raw-data fallback or link to the old UI does not establish feature parity.

Reuse the complete canonical DSH browser contribution graph on web, desktop and iPhone. Native shells own enrollment, protected credentials and selected-Host transport; the document receives no bearer credential. Keep one Context, Remote, Session controller and pending-interaction owner per mounted Host, and dispose the portable runtime before the canonical interface takes over. Redesign the canonical root while retaining all contribution slots, global plugin controls, Session views and overlays. Reuse DSH service, projection, pending-interaction and mutation owners. Add presentation adapters or supported composition seams where necessary; do not create a second authoritative Session log, parallel approval consumer or independently replayed mutation route. Host capability availability and lifecycle ownership remain explicit. Every mutation must distinguish known rejection from an uncertain outcome, prevent accidental duplicate dispatch and retain relevant user intent. New supported operations use generated capability selection and the existing authenticated platform transports.

## Acceptance

Compare the old and redesigned UI against the same recorded Sessions and real isolated Host. Every active baseline feature must have a working replacement and evidence before claiming full Session parity. Exercise rich content and nested tool details, current and historical introspection, queued and interrupted work, child Sessions, terminal lifecycle, approvals, failure/retry states and reconnect. Verify at desktop and phone widths, including keyboard access, readable typography, contrast, focus, scrolling and stable drafts. Platform builds, packaged desktop execution and physical-iPhone qualification remain separately reported; a browser test is not native-device evidence.

Complete Impeccable's direction, bounded visual review and design documentation workflow. Preserve current production access and all durable data; qualify source publication and platform delivery through the existing migration release policy. Keep private backend lineage and Vision implementation outside public artifacts.
