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

## Native creation composition increment

Prepare a Host-owned native creation controller before exposing creation controls. Admit generated `session/create` and `agentPresets/list` independently from the seven required Session endpoints, retaining a narrow desktop allowlist. Read the selected Host's healthy profile roster with explicit failure/retry and generation-scoped publication. Creation selects an existing shared Workspace identity or an explicit Host directory, forwards the selected profile unchanged and uses one caller-preallocated Session identity. Missing or removed selections must not fall back. Omitted profile means the Host default.

Coalesce duplicate creation gestures and refuse dispatch offline or without compatible optional capabilities. Distinguish success, definite rejection, uncertain publication and a published Session whose Workspace attachment is unconfirmed or failed. Reconcile an uncertain attempt only from its exact Session identity in shared Session state and, for a requested Workspace, authoritative membership in that Workspace. Do not infer admission from matching paths, titles or profiles, and do not resend on reconnect. Retain the original request and allow explicit read-only reconciliation. Join owned reads and creation calls on runtime disposal; late results must not publish into another Host runtime.

Qualify held/lost replies, stream-before-reply, partial attachment, missing profile, offline taps, duplicate calls, stale catalog replies and disposal against typed ports and an isolated real built Host. Keep visible creation and registration controls unavailable until their persisted uncertain-attempt recovery, native UI and platform flows are separately qualified. Workspace registration, creation UI, catalog UI and remaining Phase 4 gates are not completed by this composition increment.

## Durable creation recovery increment

Persist the Host-qualified request and allocated Session identity before dispatch. Claim one outstanding attempt atomically across application owners, including concurrent browser or Electron windows. Only the successful claimant may send; every other owner restores the retained attempt without replay. Restore an unfinished request as unknown, then use exact shared Session identity and requested Workspace membership for read-only reconciliation. A missing record in a bounded Session list is not rejection. Preserve unresolved attempts when switching Hosts, closing the application, losing access or forgetting a pairing; pairing credentials are not part of these records.

Use a dedicated transactional store, separate from discardable replica caches. Validate durable records and fail closed on unreadable, malformed, unsupported-version or unwritable storage. Never overwrite a corrupt record with an empty state. Confirmed outcomes remain retained until an explicit, identity-checked reset completes durably. An old owner cannot clear a replacement request, downgrade a confirmed outcome or erase observed publication and attachment-failure evidence. Storage failures after dispatch retain the identity and prohibit a new attempt. Explicit recovery may reread and reconcile; it never repeats creation. Dispose joins owned persistence and carrier calls without canceling the Session.

Qualify write-before-send, storage failures before and after dispatch, two competing owners, late completion, atomic reset, Host isolation, cold reload and an actual accepted-but-lost reply. Exercise browser/Electron storage with the real database and native storage through its SQLite transaction owner; label iOS exports separately from physical execution. Keep creation UI hidden until visible profile, target and outcome controls have their own real browser/Electron qualification. This prerequisite does not complete Phase 4 or authorize a phase release.

## Native creation presentation increment

Expose Session creation in the opt-in native Host directory using the qualified creation controller and durable journal. A form owns its draft and captures explicit healthy profile and existing Workspace selections, or an explicit Host directory. Catalog refresh, removal, disconnection and Host replacement never substitute a selection. Opening the form may explicitly read profiles; reconnect never does. Show the Host default profile as advertised, with profile descriptions. Retain input through retry and keep the form's submission action reachable at narrow and wide widths.

Present sending, accepted, rejected, unknown publication, partial Workspace attachment and storage failure separately. Show the retained request identity and target for unresolved outcomes, with an explicit read-only status check. Unknown or partial outcomes cannot start another attempt. A confirmed outcome permits an explicit durable reset; opening the created Session never clears the journal. Closing a form only releases its subscriptions and does not cancel or repeat the Host operation. Reopening and cold restart display the controller's retained outcome.

Qualify actual browser and Electron creation gestures, profile and target forwarding, catalog failure/retry, duplicate input, interrupted accepted replies, cold recovery and zero redispatch. Inspect the real durable Host headers and Workspace membership. Include removed-choice and storage-state form regressions, narrow/wide layouts and normal client teardown. Keep Workspace registration and all other Phase 4 gates separate; this component does not authorize phase publication.

## Durable native Workspace registration increment

Pin the qualified shared Client from DSH `096b7ca4f53c8d5136cb9152a83cf3399478b735`, including Workspace create semantic revision 2. Admit generated `workspace/create` and `workspace/resolveByPath` independently from basic Session admission, with exact desktop paths. Keep registration controls hidden until the separate visible workflow has real browser/Electron qualification.

One Host-qualified durable registration attempt records its exact requested Host path and a local ownership identity before dispatch. The local identity is not a Host request receipt. Claim atomically across application owners in a separate transactional database from Session creation. Only the claimant sends once; duplicate gestures, another owner, reconnect, cold restart and restoration never resend. Corrupt, unsupported, unavailable or unwritable storage fails closed and preserves the retained record. Forgetting pairing does not clear non-credential operation records.

A successful shared create reply confirms registration. Only the qualified shared `WorkspaceCreateError` carrying `workspace/create-rejected` establishes rejection before any registration write for this request. It does not assert that no registration exists at the path. Other create failures after dispatch remain unknown, including `workspace/invalid-path`, which also covers storage failures. Cancellation before dispatch can record a local not-dispatched result. An explicit lookup observes the current canonical registration, absence or failure without changing the mutation outcome or shared followed list. Generation change clears this observation and aborts the read; reconnect starts no lookup. Absence and matching list paths do not prove rejection or acceptance.

A user may explicitly adopt a positively observed current registration to finish an unknown attempt, retaining a distinct adopted outcome rather than claiming the original request succeeded. This is a local acknowledgement with the observed Workspace identity and canonical path, not a Host mutation. Confirmed, adopted, rejected or not-dispatched outcomes permit an explicit identity-checked durable reset. Late owners cannot downgrade an outcome, clear a replacement or publish stale lookup results. Lookup results are observations, not durable authority for current existence; visible selection must still use the shared Workspace list.

Qualify atomic claim and reset, Host/database isolation, corruption, storage errors, broad Host errors, generation changes, held reads, joined disposal and cold recovery with real SQLite and browser IndexedDB. Exercise the actual installed runtime against an isolated built Host with accepted-but-lost registration, retained unknown status across restart, explicit current lookup/adoption, canonical alias changes and zero mutation replay. Existing Session creation/history and device transports remain regression owners. Native UI, physical iPhone execution, packaged release acceptance and Phase 4 publication remain separate gates.

## Durable registration rejection increment

Persist the qualified Host rejection and its diagnostic as a distinct terminal outcome before allowing explicit reset and a corrected request. Failed persistence blocks reset and new dispatch. Cold restoration preserves that outcome without rereading or resending; unknown records remain unknown. Late owners cannot downgrade rejected evidence, change a replacement identity or replace confirmed/adopted outcomes with rejection. Existing version-1 journal records remain readable without rewrite; new writes use version 2, including the rejected variant. Unknown versions and malformed records fail closed. Older readers may refuse version 2; this is not Session data migration or downgrade support.

Qualify actual fresh-connection SQLite and browser IndexedDB recovery, previous record variants, identity guards, failed outcome/reset writes, wrong error classes, broad errors and optional create revision mismatch. Against an isolated built Host, use the actual installed native runtime for invalid path rejection, cold recovery, explicit corrected registration and accepted-but-lost reply handling. Registration presentation remains a separate package; no phase publication or app delivery is established by this prerequisite.

## Implementation surfaces

- [Shared native Session runtime](spec:src:packages/app/src/dsh/runtime.ts)
- [View-owned optional history reads](spec:src:packages/app/src/dsh/history.ts)
- [Native transcript presentation](spec:src:packages/app/src/dsh/ui/conversation.tsx)
- [Shared workspace receipt presentation](spec:src:packages/app/src/dsh/ui/workspace-outcome.tsx)
- [Native creation and catalog ownership](spec:src:packages/app/src/dsh/creation.ts)
- [Native creation draft](spec:src:packages/app/src/dsh/creation-form.ts)
- [Native creation controls](spec:src:packages/app/src/dsh/ui/creation-sheet.tsx)
- [Durable creation ownership](spec:src:packages/app/src/dsh/creation-journal.ts)
- [Native Workspace registration ownership](spec:src:packages/app/src/dsh/registration.ts)
- [Durable registration journal](spec:src:packages/app/src/dsh/registration-journal.ts)
- [Native operation selection](spec:src:packages/protocol/src/dsh-access.ts)
- [Desktop transport ownership](spec:src:packages/desktop/src/dsh/access.ts)

## Shared history Client prerequisites

The application distribution is pinned to DSH `096b7ca4f53c8d5136cb9152a83cf3399478b735`, containing qualified Workspace pre-write rejection, read-only canonical Workspace lookup, renderer-independent workspace receipts, explicit creation profile forwarding, explicit older-page failures and retry, joined deferred-detail cancellation and an optional Host-wide retained-detail allowance. The native composition enables that allowance and view-owned cancellation. Shared-owner and package checks do not establish native scrolling, capability admission or complete Phase 4 acceptance.

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

## Native creation composition qualification

The native controller uses the installed `f9b05abb` shared Client. Eighteen creation cases and the existing selected runtime, history, directory, interaction and desktop owners total 100 passing cases. Full workspace types and lint pass; final app types and lint also pass after a regression exposed and fixed reentrant roster coalescing. A loading subscriber now joins the already registered catalog read. No automatic catalog read or mutation is added on reconnect.

An isolated built Host accepted three native creation requests and retained exactly three durable Sessions: a directory Session using `minimal`, a Workspace Session using `standard`, and a Workspace Session using `minimal` whose reply was deliberately lost after acceptance. Reconnect reconciled the original Session identity and authoritative Workspace membership without another creation request. Duplicate gestures coalesced, offline taps dispatched nothing, and explicit catalog retry recovered from an injected carrier failure. The real production browser opened the reconciled Session at 390px with no JavaScript errors. Typed port tests separately cover definite refusal, partial attachment, stale catalogs and joined disposal; partial attachment was not forced on the actual Host.

All eleven core/history/creation endpoint descriptors match the exact TestFlight 7003007 archive, installed Client and built Host metadata. This does not remove the older clients' required-workspace-event incompatibility. Web and iOS exports and the desktop main build pass. No new Electron creation UI or physical iPhone execution is claimed. Evidence is `.dev/daedal-dsh-plan-audit/native-creation-20260921/verification.json`.

Durable recovery and visible creation controls are qualified below. Workspace registration and remaining Phase 4 requirements remain open. This local component is not a phase release, source publication, deployment or new TestFlight delivery.

## Durable creation recovery qualification

The creation journal commits one Host-qualified request before dispatch and retains it through runtime replacement. SQLite tests use actual on-disk transactions and new connections; a real Chromium case races independent IndexedDB connections. Controller cases cover competing claimants, unreadable records, failure before dispatch, failed outcome/reset writes, disposal during a pending claim and exact Workspace reconciliation. The selected owner checks total 77 Node cases plus one browser case. Two negative controls fail when durable claiming or terminal-result protection is removed. An additional failing regression reproduced a late owner erasing partial-publication evidence; the journal now preserves it and explicit attachment failures. Full workspace types, final app types, lint and direct spec lint pass.

An isolated built `f9b05abb` Host accepted three requests and retained exactly three durable Sessions. After the third reply was deliberately lost, the native runtime closed, reopened offline from its SQLite record and reconciled the original identity and Workspace membership after reconnect with no redispatch. Production browser reload and development Electron cold restart separately restored seeded records for that actual accepted request and persisted acceptance through their real Session readers. Electron retained protected pairing and used native IPC. Both opened the recovered Session and fixed composer with no JavaScript errors; normal client exit left the external Host alive. These seeded browser/Electron records qualify application restoration, not an executed creation gesture in those UIs.

Web, Electron and iOS exports and desktop main build pass. Native SQLite orchestration is exercised through Node's real SQLite driver; the Expo adapter is typechecked and exported, not executed on a physical iPhone. Carlo's provisional physical acceptance for the current delivered build remains separate. Evidence is `.dev/daedal-dsh-plan-audit/creation-recovery-20260921/verification.json`.

The durable recovery prerequisite is locally complete. Visible controls are qualified below; Workspace registration and the remaining Phase 4 gates stay open. No source publication, deployment, installed-app replacement or TestFlight delivery occurred.

## Native creation presentation qualification

The opt-in native directory exposes a draft-owned creation sheet with explicit healthy profile selection, advertised default labels, existing Workspace selection or a Host directory. Catalog failures retry explicitly; removed choices retain their labels and block submission. Retained outcomes distinguish rejection, uncertainty, publication with incomplete attachment and confirmed creation. Checking status never resends; starting another Session requires the journal's explicit durable reset. Closing a form releases its readers while the Host-owned attempt remains available.

Thirty focused creation cases pass, including five form regressions for stale selections, failure/reconnect input retention, duplicate gestures, closing during creation, storage refusal and retained unknown outcomes. Full workspace types, final app types, lint, direct spec lint, Web/Electron/iOS exports and desktop main build pass. Real UI inspection found a compact footer overflow; its corrected layout keeps every footer button within the viewport. No generated RPC, portable artifact or backend source changed.

Actual production browser exports at 390px and 1280px and development Electron created seven durable Sessions through visible controls. The isolated built Host retained the exact selected minimal/standard profile headers and requested Workspace membership. Duplicate taps produced one creation request. The browser deliberately lost an accepted reply, retained an unknown request through reload and reconciled its original identity after reconnect without redispatch or automatic catalog reads. Electron independently enrolled through protected device access, used real native IPC for creation and restored its confirmed result after a cold restart. Browser and Electron JavaScript error lists were empty; normal client disposal left the external Host alive. These records were created by the application UI, not seeded into its journal.

Evidence is `.dev/daedal-dsh-plan-audit/creation-ui-20260921/verification.json`. The iOS export is not physical execution; Carlo's provisional acceptance remains attached to the current delivered build. Electron qualification used the development application, not a new packaged release. Workspace registration, search, fork, queue, attachments, remaining tools/subagents/interactions and Phase 4 release gates remain open. No source publication, deployment, installed-app replacement or TestFlight upload occurred.

## Native Workspace registration ownership qualification

The installed Client is the exact prepared `7f6b311e` distribution. The native runtime admits Workspace creation and canonical lookup independently and retains one local attempt in a dedicated transactional journal. A dispatched failure remains unknown. Explicit current lookup and adoption retain their separate meanings; neither reconnect nor restoration repeats a mutation or lookup. Registration controls remain hidden pending visible workflow qualification.

The selected app owners pass 127 cases, including 14 registration cases and real SQLite persistence, with 13 desktop cases and two actual Chromium IndexedDB cases. Two deliberate negative controls fail when atomic claiming or terminal-outcome preservation is disabled. Full workspace types, final app types, lint, direct 26-spec lint, formatting, Web/Electron/iOS exports and desktop main build pass. Initial typed fixture, expected transport count and lint failures were repaired; failed and successful action receipts remain in the evidence.

An actual installed native runtime against an isolated built Host deliberately lost one accepted registration reply. Its unknown request survived offline runtime replacement and Host restart in real SQLite. Explicit lookup returned the same durable Workspace identity without confirming the earlier mutation or resending it. Retargeting the requested symlink produced absence and blocked adoption/reset; restoring the target allowed explicit adoption. Only a subsequent explicit reset and new request produced the second registration. The Host retained exactly two Workspaces and no Sessions. Client disposal left the external Host alive; owned Hosts were joined and private state removed.

Evidence is `.dev/daedal-dsh-plan-audit/native-registration-20260921/verification.json`. SQLite orchestration uses the Node driver; the Expo adapter is typechecked and exported, not physically executed. No new registration UI or packaged Electron acceptance is claimed. Physical iPhone acceptance remains provisional for the current delivered build. Phase 4 stays in progress with registration presentation and remaining features/release gates open; no source publication, deployment, installed-app replacement or TestFlight upload occurred.

## Durable registration rejection qualification

The exact prepared `096b7ca4` Client is installed. Only its Client archive changed; five support archives remain identical. Qualified pre-write rejection is retained as a distinct terminal outcome with its Host diagnostic. Version-1 records remain readable without rewrite; new version-2 records preserve rejected outcomes across fresh SQLite and IndexedDB connections. Late owners cannot downgrade them or modify replacement identities. Failed outcome or reset writes block a new dispatch. Hosts advertising create revision 1 disable only that optional mutation; lookup remains independently admitted.

Three new regressions fail before the implementation. The final selected app owners pass 47 cases, including 19 registration cases and fresh-connection SQLite persistence, with 13 desktop cases and three actual Chromium IndexedDB cases. Full workspace types, lint, direct spec lint, formatting, Web/Electron/iOS exports and desktop main build pass. The initial nested-callback lint finding and a repair-script matching error were corrected; all action attempts remain recorded.

The actual installed native runtime against an isolated built Host rejects relative, missing and file paths with no durable registration. The rejected request survives offline runtime replacement in real SQLite, reconnect causes no lookup or replay, and only explicit reset permits a corrected request. A deliberately lost accepted reply remains unknown through runtime and Host restart; current lookup, symlink retargeting and explicit adoption retain their distinct meanings. Five total explicit create requests produce three pre-write rejections and exactly two durable Workspaces, with no Sessions or model requests. Client disposal leaves the external Host alive; owned Hosts are joined and private state removed.

Evidence is `.dev/daedal-dsh-plan-audit/registration-rejection-20260921/verification.json`. Registration controls remain hidden pending visible browser/Electron qualification. The Expo SQLite adapter is typechecked/exported, not physically executed. Current delivered iPhone acceptance remains provisional. No source publication, deployment, installed app replacement or TestFlight upload occurred; Phase 4 remains in progress.

## Acceptance

Recorded sessions match DSH projections across clients. Real simultaneous approval/question responses, large history, deferred details and interrupted commands produce one correct backend result.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
