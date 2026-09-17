---
id: TASK:migration/03-native-client
type: task
status: accepted
summary: "Prove native DSH connectivity and device access."
owners: [daedal-one]
progress: in-progress
addresses:
  [
    "IFC:frontend/dsh-connection",
    "REQ:frontend/hosts-and-access",
    "REQ:frontend/resilience",
    "REQ:frontend/sessions",
  ]
blocked_by: ["TASK:migration/01-contract-baseline"]
---

# Prove native DSH connectivity and device access

## Plan

Test existing DSH client modules under Metro/Hermes, browser and Electron; extract a supported portable face in DSH only where needed. Add transports, handshake, operation reconciliation, enrollment/revocation and DSH-host discovery. Build one native session flow.

## Portable dependency installation

Consume the DSH-owned `@deepseek-ai/dsh-client` application distribution and its shared dependency archives, pinning their source commit, checksums and package-manager lockfile. Consume API, Conversation, Chat, the pending-interaction registry and approval/question carriers and Remote consumers from that one distribution so generated service types, contributed pending values and Chat declarations retain one identity. Verify registered-carrier narrowing and shared Session/Remote registration types after installation. Qualify installed answers, precedence, cancellation and disposal through the iOS bundler; this dependency qualification does not establish native answer controls or actual Remote delivery. Do not install the API-only distribution alongside it. Do not copy DSH wire schemas or import Host packages into the app. Verify a clean package-manager install and strict declaration consumption before running the installed dependency through Metro/Hermes. Native runtime assembly uses one Cordis root and one hydrated Session selection per Host, explicit generated capability requirements and the app-owned cancellation adapter. Host credential storage, platform transports, QR enrollment and Session presentation remain required application work.

## Native device access

Use the installed DSH validators for enrollment and protected grant records. Native grants remain in Expo SecureStore with device-only, unlocked keychain access; a nonsecret Host-id index is the only enrollment data in ordinary storage. Serialize index/secret mutations, keep partially saved entries visibly unpaired, and surface storage failures without disclosing credentials. A missing or invalid stored grant never falls back to legacy passwords or browser ownership.

Pin every native HTTP and WebSocket target to the selected origin. Require HTTPS except explicit loopback or numeric Tailscale endpoints. Use Expo fetch to omit ambient cookies and reject redirects; retain caller/disposal cancellation through complete JSON-body decoding. Own a cancellable body reader: the SDK 54 native text/JSON helper waits only for body completion and can remain pending after cancellation. Send the device credential only in the Authorization header. The iOS WebSocket carrier must refuse redirects and pass the selected origin; the Host must reject invalid bearer credentials even if the platform includes a cookie. Qualification of other native carriers remains explicit.

Enrollment submits one claim and never replays it after a lost result. Store a returned grant before presenting pairing success. Opening a saved Host hydrates and validates its record before creating the per-Host runtime; final disposal cancels that runtime and its authenticated carriers. Forgetting local access and revoking a Host-side grant remain distinct operations. The actual QR and Session screens must consume this owner before native-client acceptance. The native access module now supplies protected storage, iOS carriers and saved-runtime composition. Its focused tests qualify failure and ownership behavior with native-module substitutes; platform execution and the application screens remain separate acceptance gates.

## Native Host directory

Expose an iPhone-native Host directory from Settings while retaining the existing companion UI. Scanning only validates and displays a bounded, strict enrollment QR; claiming requires a separate confirmation showing the selected origin and Host identity. Challenges stay in memory and never enter navigation, ordinary storage or diagnostics. Repeated camera frames cannot submit or replace a reviewed enrollment, and unknown claim outcomes have explicit owner-side recovery.

Own at most one active Host runtime in the directory. Switching hosts and forgetting local access wait for disposal; leaving the screen cancels pending enrollment and disposes late runtime arrivals. A failed final disposal prevents another directory owner from opening until the app restarts. List saved entries without exposing credentials, keep corrupt or partial records visible with recovery, and distinguish initial loading from an authoritative empty Session list. Use the generated DSH Session feed directly, including reconnect and pagination. Observe its read activity and structured failures: a settled refresh is not proof of success. Keep retained rows visible after failed refresh or continuation and expose retry without presenting an initial failure as an empty list. Directory browsing has no durable conversation selection; selected-conversation restore belongs to the subsequent conversation surface. Qualification covers lifecycle races, native rendering and real Host reads; QR camera use and physical-device acceptance remain distinct gates. Preview copy uses locale dictionaries with an explicit English fallback until translations are supplied.

## Native Session reading

The directory opens a listed Session within its existing Host owner and returns to the list without creating another connection or cancelling Host execution. Compose the installed Conversation binding and shared Chat Definitions over the Session binding's event source; do not duplicate event projection or open another history stream. A Host owns at most one visible Conversation. Repeated selection retains its identity; selection changes and Host disposal detach the previous binding and cancel deferred publication. An unknown or removed Session cannot replace the current view silently.

Render the loaded Session window using stable Chat order and per-node subscriptions. React snapshot readers and subscriptions must retain their owning Session receiver, remain stable across renders and detach when the selected Session changes. Show authoritative loading, empty, removed, resynchronizing and failed-read states. Retain readable content during disconnection and offer an explicit reconnect or initial-read retry. Render supported text and reasoning without raw event JSON; unsupported content remains visibly identified. Rich renderers and older-history loading remain subsequent work, and the current DSH interface remains available. Native Session selection is transient until durable restore is implemented. Qualify real native rendering against an isolated DSH Host as well as deterministic ownership and streaming cases; neither proves physical-device acceptance.

## Native text submission

Keep the composer and Send control outside the scrolling transcript. Reuse the application keyboard dock and stationary composer viewport so the entire form stays within the space between the header and software keyboard. Long drafts and status messages scroll independently of Send; opening or closing the keyboard must not remount the draft. Preserve access to the start of the transcript while the dock is translated. Qualify long history, long drafts, software-keyboard transitions and a first-tap submission through the actual native app; simulated layout and compilation do not satisfy these gates.

Add a text-only composer to a loaded ordinary Session. Use its existing generated prompt operation in queue mode so a running turn receives a queued follow-up; never use steering implicitly. The form owns draft text and one pending operation, requires an admitted connection and a readable, available Session, and prevents duplicate taps. Preserve drafts on a rejected or uncertain result and clear only the submitted draft after Host-confirmed acceptance; edits made while a request is pending remain intact, even if the user restores the same text. Keep an uncertain submitted message distinct from a newer unsent draft.

Known pre-admission refusals are retryable after the user corrects the cause. Transport failure, cancellation, generation loss and unclassified failures remain unknown outcomes, never confirmed rejection. Do not expose a resend for an uncertain attempt or retry it on reconnect. Keep its draft and a visible instruction to inspect the authoritative conversation before any further action; explicit outcome reconciliation and safe retry remain required follow-up work. Closing the view cancels only its in-flight request and never sends Session cancellation. A late reply cannot mutate a closed or replacement composer. Subagent submission, attachments and queue editing remain unavailable in this increment. Qualify controlled success, rejection, lost response, duplicate taps, draft edits, readiness and disposal through the real shared runtime, followed by an isolated Host refusal and platform rendering; static checks are not native acceptance.

## Native pending interactions

Compose one Host-owned pending-interaction registry with the installed approval and question Remote consumers. Each consumer's Remote service and domain registrar belong to the same Cordis contribution. Expose exact shared request objects by Session without copying waterfall settlement, Session scope or priority into the app. Native controls show the effective request, preserve unsent question drafts while a higher-priority request is visible, and keep requests for other Sessions reachable from the Session list. Leaving the directory releases its consumers; leaving one conversation does not cancel Host execution.

Render tool approval with allow-once and reject choices. Render the complete question batch with verbatim option labels, single or multiple selection, free text and explicit per-question skip; submit only when every question is answered or deliberately skipped. Show plan detail and use the shared plan-review discriminator without assuming option order. Cancel a question only through its shared cancellation method. A form dispatches at most one settlement and never retries after delivery loss. Local carrier settlement is not Host acceptance; authoritative Session output and connection state remain the evidence of progress. Withdraw cancelled or disconnected requests and never restore stale answers on reconnect.

Qualify generated Remote Event delivery, Session and Host isolation, mixed-request precedence, complete answers, Host cancellation, generation loss and disposal using installed owners. Follow with actual authenticated Host delivery and native controls, including the software keyboard. Controlled carriers and iOS compilation do not establish actual Host or device answering.

## Implementation references

- [Protected access](spec:src:packages/app/src/dsh/native/access.ts)
- [Native directory ownership](spec:src:packages/app/src/dsh/native/directory.ts)
- [Shared native Session runtime](spec:src:packages/app/src/dsh/runtime.ts)
- [Native Session reading](spec:src:packages/app/src/dsh/ui/conversation.tsx)
- [Native prompt ownership](spec:src:packages/app/src/dsh/prompt.ts)
- [Native interaction form](spec:src:packages/app/src/dsh/interaction-form.ts)
- [Native interaction controls](spec:src:packages/app/src/dsh/ui/interactions.tsx)
- [Native text composer](spec:src:packages/app/src/dsh/ui/composer.tsx)
- [iPhone directory screen](spec:src:packages/app/src/dsh/ui/directory-screen.ios.tsx)
- [Directory lifecycle verification](spec:src:packages/app/src/dsh/native/directory.test.ts)

## Acceptance

Physical iPhone, desktop and browser attach to the same native session, stream, prompt and resolve an interaction without Paseo timeline projection. Authentication, incompatible versions, lost response and reconnect cases pass; backend gaps have accepted DSH specs.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
