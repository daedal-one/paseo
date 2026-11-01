---
id: TASK:migration/durable-workspace
type: task
status: accepted
summary: "Integrate durable Work, Workspace Files and reviewed Memory in the shared workspace experience."
owners: [daedal-one]
progress: done
addresses: [REQ:frontend/workspaces-and-tools, REQ:frontend/sessions]
related: [TASK:migration/workspace-product-shell, INV:frontend/dsh-authority]
blocked_by: []
---

# Durable workspace

## Plan

Use DSH-owned durable Work identity, lifecycle and execution links across browser, desktop and iPhone. A Work item survives its execution Sessions and does not start a model run when created. Keep existing Sessions available as execution history, with the complete compact inspector and conversation controls. Files browse the selected Workspace's authorized filesystem without choosing an arbitrary Session. Memory reads the selected Workspace's persisted records with their review status and provenance.

Keep selection qualified by Host and Workspace. Read current server state after mutations; never infer durable success from a local row or replay a mutation with an unknown result. Distinguish unsupported capabilities, disconnected Hosts, failed reads and empty collections. Reject stale and cross-Workspace operation targets. Preserve active drafts and session inspection when navigation or viewport changes.

The first explicit Create work action may initialize the Workspace's work collection before creating the item. If the Host identifies existing work at the Workspace root, show its title and require an explicit Connect existing work action using that exact project identity. Do not create a replacement collection or adopt the existing collection automatically. Files and Memory remain readable before connection. An unconfirmed initialization stops creation. New execution creation remains scoped to the selected Workspace; only a confirmed Work link can prefill an otherwise empty composer with the recorded brief. Sending remains an explicit user action.

The durable Session creation request retains its originating Work identity, Workspace and observed Work revision as client-local attribution. Reopening a retained creation under another Work item MUST open the Session without attaching it to that item. Matching launch recovery uses the recorded revision rather than the currently displayed revision; existing Sessions may be linked through the separate explicit Link execution action.

## Acceptance

Create and update Work, link executions, and recover the records after a Host restart. Browse Files and read bounded previews from the selected Workspace; read persisted scoped Memory and its provenance. Verify replacement reads cannot publish into a newly selected Workspace. Exercise the real recorded-session workflow on desktop and phone widths, preserving Context, Trajectory, Prompt & tools, Usage, Info and Events. Validate web and iPhone exports and desktop compilation separately from physical-device and server deployment qualification.

## Implementation

- [Workspace data owner](spec:src:packages/app/src/dsh/workspace-data.ts)
- [Workspace navigation](spec:src:packages/app/src/dsh/directory.ts)
- [Workspace ownership tests](spec:src:packages/app/src/dsh/workspace-data.test.ts)
- [Mounted Workspace workflow](spec:src:packages/app/e2e/browser/durable-workspace.spec.ts)
