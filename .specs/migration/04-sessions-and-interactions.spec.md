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

## History presentation increment

Render the shared Chat order through platform virtualized lists, subscribing only mounted rows to their existing Chat node sources. Keep navigation, explicit older-page controls and the composer outside the transcript scroller. A successful prepend keeps the same visible keyed row at the same viewport offset; failed paging retains that position and offers an explicit retry. New output follows only while the reader is at the end; a latest-message control restores end following. Browser and Electron must measure and restore their own keyed anchor because React Native Web does not implement native visible-content preservation.

Deferred tool cards expose one explicit full-result read with pending, retryable failure, allowance rejection, offline and unsupported-Host states. Exact hydrated output remains selectable in a bounded-height scroll region. Memory eviction returns the card to its compact state, with explicit reload. No hidden background detail or page requests are introduced. Qualify changing row heights, 10,000-event history, narrow/wide layout, retained draft, reconnect and switching Sessions against the real app and isolated Host before claiming the presentation accepted.

## Workspace outcome presentation increment

Pin the clean shared Client containing the renderer-independent workspace Chat Definition and explicit creation profile forwarding. Render the authoritative `workspace-state` node without deriving a second event projection. Saving, pending recovery, checkpointed recovery and returned branches remain separate from the agent's answer and turn completion. Show returned branch names as Host references, never device paths. Expand recorded error text only on an explicit gesture in a selectable, bounded-height region. A ready receipt has no Chat row according to the shared Definition. Preserve unknown-required-event refusal for other event types.

Qualify the installed artifact against an isolated built Host using the committed workspace-outcomes Session and actual browser/Electron rendering at narrow and wide sizes. Check pending-to-returned replacement through one shared node identity, selectable branch/error content, retained draft and unchanged external Host lifetime. Compare the recorded outcome with DSH Web. Include installed-runtime creation with the selected profile and existing history/error/interaction tests. This read-only presentation does not enable automatic Git workspaces, expose new mutation routes or establish native creation/catalog controls. Older installed clients remain unable to read Sessions containing the new required workspace events; retain that compatibility limit in Phase 4 release qualification.

## Implementation surfaces

- [Shared native Session runtime](spec:src:packages/app/src/dsh/runtime.ts)
- [View-owned optional history reads](spec:src:packages/app/src/dsh/history.ts)
- [Native transcript presentation](spec:src:packages/app/src/dsh/ui/conversation.tsx)
- [Shared workspace receipt presentation](spec:src:packages/app/src/dsh/ui/workspace-outcome.tsx)
- [Native operation selection](spec:src:packages/protocol/src/dsh-access.ts)
- [Desktop transport ownership](spec:src:packages/desktop/src/dsh/access.ts)

## Shared history Client prerequisites

The application distribution is pinned to DSH `f9b05abb2b23f5b62cd009939f2566410109ef1a`, containing renderer-independent workspace receipts, explicit creation profile forwarding, explicit older-page failures and retry, joined deferred-detail cancellation and an optional Host-wide retained-detail allowance. The native composition enables that allowance and view-owned cancellation. Shared-owner and package checks do not establish native scrolling, capability admission or complete Phase 4 acceptance.

The `a6bef716` native read composition passed 172 focused app/desktop cases, full workspace types/lint, two failing negative controls and the iOS export. The actual app runtime with Node carriers reads a 10,000-event fixture plus four authoritative activation events from an isolated built Host: 41 page responses including a held canceled response, maximum 49,806 response bytes, retained history after injected failure, explicit retry and coalesced reads. Fresh views complete page and detail reads before old canceled responses settle; late replies leave accepted history unchanged. Across 128 explicit 65,536-character detail reads, the native allowance evicts the oldest hydration back to its exact compact record; explicit reload restores the exact content and all 10,004 records remain. Disposal sends no Session cancellation and leaves the external Host running.

All nine generated core/history endpoint requirements match the delivered TestFlight 7003007 Client. The optional operations are admitted independently, and the desktop carrier permits only their generated paths. These are installed-runtime and metadata results. Presentation qualification is recorded separately below. Phase 4 stays in progress.

## History presentation qualification

The production browser export passed at 390px and 1280px against the isolated built DSH Host: newest-row mount, 10,000-event history through explicit page controls, keyed prepend preservation, page/detail failures and explicit retry, retained draft, exact 65,536-character result reconstruction, bounded mounted rows, viewport resize, empty/recorded Session switching and offline/reconnect without automatic page/detail reads. The actual development Electron application independently enrolled through protected device access and exercised its real native IPC, all 40 older pages, exact full results, keyed reader preservation and composer layout. Its normal exit left the external Host alive. No model request or live Session mutation was issued.

The same isolated recorded text turn renders its exact user prompt and assistant response in both the existing DSH Web UI and the native companion Web UI. This comparison covers the recorded message turn, not complete tool or subagent presentation parity.

Two browser geometry regressions qualify 10,000-row virtualization, prepends, changing row heights and end following. Full workspace types/lint, direct spec lint, web/Electron/iOS exports and scoped history/prompt/interaction regressions passed. The iOS export is a build check; physical iPhone execution remains unperformed under Carlo’s provisional acceptance. Evidence lives in `.dev/daedal-dsh-plan-audit/history-ui-20260920/verification.json`. This local presentation increment does not establish source publication, packaged release acceptance, complete interaction parity or Phase 4 completion.

## Workspace reader qualification

The exact `f9b05abb` application distribution renders recorded workspace outcomes in production browser exports at 390px and 1280px and in development Electron through protected device access and native IPC. Pending and returned receipts match the same committed Session in DSH Web: exact assistant answer, pending diagnostic and returned Host branch. Additional typed fixtures cover saving, checkpointed recovery and hidden ready receipts. Expanded diagnostics remain selectable, drafts stay intact and the composer stays within the viewport. No JavaScript errors were observed. The installed-runtime regression replaces pending with returned through one shared Chat node source without inserting an assistant message.

The installed Client also passes actual isolated-Host creation with explicit directory/workspace profiles, same-ID adoption and missing/conflicting-profile refusal without fallback. Refreshed 10,000-event history, read cancellation, explicit retry, coalescing, bounded details and unknown-required-event refusal pass. The nine core/history endpoint descriptors match TestFlight 7003007 and the built Host; older clients still refuse required workspace events. Full workspace types, 119 focused app/desktop cases, lint, spec lint and web/Electron/iOS exports passed. The iOS export is not physical execution, and development Electron is not packaged acceptance.

Evidence is `.dev/daedal-dsh-plan-audit/native-workspace-reader-20260921/verification.json`. This local component is not published or deployed. Native creation/catalog controls and the remaining Phase 4 work stay in progress; automatic Git workspaces remain opt-in.

## Acceptance

Recorded sessions match DSH projections across clients. Real simultaneous approval/question responses, large history, deferred details and interrupted commands produce one correct backend result.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
