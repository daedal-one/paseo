---
id: TASK:migration/04-sessions-and-interactions
type: task
status: accepted
summary: "Replace session and workspace presentation with native DSH state."
owners: [daedal-one]
progress: in-progress
addresses:
  ["REQ:frontend/sessions", "REQ:frontend/interactions", "REQ:frontend/workspaces-and-tools"]
blocked_by: ["TASK:migration/03-native-client"]
---

# Replace session and workspace presentation with native DSH state

## Plan

Implement host-qualified IDs, workspace organization, creation/search/history/fork/queue, attachments, tool presentations and subagent relationships in the shared app. Preserve DSH event and waterfall semantics. Switch each validated capability to one native mutation route.

## On-demand history and result details

Complete [companion profile selection](spec:TASK:migration/companion-profiles) first, following Carlo’s daily-use priority. Then extend the existing shared Session history and detail owners. A native conversation requests one bounded older page only after an explicit gesture. Preserve the loaded transcript and reading position, coalesce repeated taps, keep page failures visible and retryable, and stop publication when the view or Host generation is replaced. Reconnect must not drain older history automatically. Use the existing Session event window and Chat Definitions so native views do not copy event projection, sequence validation or cursor rules.

Deferred tool results remain summaries until explicitly opened. Resolve their original result sequence through the same Session owner and show loading, failure and retry states without marking an unavailable detail as an empty successful result. Bound retained detail data and qualify cancellation and Host replacement before exposing the control. Keep unknown content visibly identified.

Admit the generated `session/page` and `session/historyDetail` operations before enabling their respective controls. Update the desktop transport allowlist through the shared generated requirement selection; never widen it to arbitrary RPC paths. Hosts lacking an optional operation retain the basic native Session flow with an explicit unavailable control. If the shared Client owner cannot expose a failure or cancellation state, add that behavior at its DSH owner and update the pinned portable artifact before using it in the app.

Qualify actual installed-runtime pagination, deferred-result reconstruction, duplicate taps, page failure and explicit retry, reconnect and view replacement. Compare the same recorded Session with the existing browser presentation; inspect browser and Electron scrolling and fixed-composer behavior. Include a 10,000-event fixture with bounded page/detail reads and record a memory baseline before selecting an absolute budget. This increment does not establish the remaining creation, search, fork, queue, attachment, subagent or concurrent-interaction acceptance.

## Native read composition

The shared app composition admits `session/page` and `session/historyDetail` independently from the seven required Session operations, comparing each generated mode, wire fingerprint and semantic revision with the active Host capability snapshot. Missing, unavailable or incompatible optional operations disable only their respective controls. Desktop IPC derives its two additional allowed paths from the same selection.

Each conversation view owns a history-read controller. View closure or Host generation change aborts that view's page and detail reads without closing the resident Session or canceling Host work. Returned completions stay owned until settlement, including when a replacement view starts before an old carrier settles. Reconnect enables a fresh explicit gesture and never repeats a read automatically. The native Session composition uses an 8,388,608 UTF-16 serialized-character allowance across resident Sessions, selected from the measured shared-Client retained-memory baseline. It is not a network or process-memory limit. Detail failures distinguish allowance rejection from retryable read failure and retain the compact event.

## Implementation surfaces

- [Shared native Session runtime](spec:src:packages/app/src/dsh/runtime.ts)
- [View-owned optional history reads](spec:src:packages/app/src/dsh/history.ts)
- [Native transcript presentation](spec:src:packages/app/src/dsh/ui/conversation.tsx)
- [Native operation selection](spec:src:packages/protocol/src/dsh-access.ts)
- [Desktop transport ownership](spec:src:packages/desktop/src/dsh/access.ts)

## Shared history Client prerequisites

The application distribution is pinned to DSH `a6bef71641f0a28c4886b24d9c595732175e9277`, containing explicit older-page failures and retry, joined deferred-detail cancellation and an optional Host-wide retained-detail allowance. The native composition enables that allowance and view-owned cancellation; history controls remain in progress. Shared-owner and package checks do not establish native scrolling, capability admission or complete Phase 4 acceptance.

The installed native read composition passes 172 focused app/desktop cases, full workspace types/lint, two failing negative controls and the iOS export. The actual app runtime with Node carriers reads a 10,000-event fixture plus four authoritative activation events from an isolated built Host: 41 page responses including a held canceled response, maximum 49,806 response bytes, retained history after injected failure, explicit retry and coalesced reads. Fresh views complete page and detail reads before old canceled responses settle; late replies leave accepted history unchanged. Across 128 explicit 65,536-character detail reads, the native allowance evicts the oldest hydration back to its exact compact record; explicit reload restores the exact content and all 10,004 records remain. Disposal sends no Session cancellation and leaves the external Host running.

All nine generated core/history endpoint requirements match the delivered TestFlight 7003007 Client. The optional operations are admitted independently, and the desktop carrier permits only their generated paths. These are installed-runtime and metadata results; native controls, reading-position preservation and browser/Electron scrolling/composer checks remain unqualified. Phase 4 stays in progress.

## Acceptance

Recorded sessions match DSH projections across clients. Real simultaneous approval/question responses, large history, deferred details and interrupted commands produce one correct backend result.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
