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

## Implementation surfaces

- [Shared native Session runtime](spec:src:packages/app/src/dsh/runtime.ts)
- [Native transcript presentation](spec:src:packages/app/src/dsh/ui/conversation.tsx)
- [Native operation selection](spec:src:packages/protocol/src/dsh-access.ts)
- [Desktop transport ownership](spec:src:packages/desktop/src/dsh/access.ts)

## Shared history Client prerequisites

The application distribution is pinned to DSH `ca59f9f11f7b4e0e97f5dc3497e3358a8c92fb00`, containing explicit older-page failures and retry, joined deferred-detail cancellation and an optional Host-wide retained-detail allowance. The native app has not enabled that allowance or the history controls. Shared-owner and package checks do not establish native scrolling, capability admission or complete Phase 4 acceptance.

The installed candidate passes 159 focused app/desktop cases, workspace types/lint/spec checks and the iOS export. With Node carriers, the actual app runtime reads a 10,000-event fixture plus four authoritative activation events from an isolated built Host: 40 older pages, a maximum 49,806-byte page response, retained history after an injected page failure, explicit retry, coalesced requests and exact deferred-result reconstruction. All nine generated core/history endpoint requirements match the delivered TestFlight 7003007 Client. These checks do not exercise native UI scrolling or claim complete business-semantic compatibility.

## Acceptance

Recorded sessions match DSH projections across clients. Real simultaneous approval/question responses, large history, deferred details and interrupted commands produce one correct backend result.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
