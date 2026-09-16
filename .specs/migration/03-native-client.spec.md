---
id: TASK:migration/03-native-client
type: task
status: accepted
summary: "Prove native DSH connectivity and device access."
owners: [daedal-one]
progress: in-progress
addresses:
  ["IFC:frontend/dsh-connection", "REQ:frontend/hosts-and-access", "REQ:frontend/resilience"]
blocked_by: ["TASK:migration/01-contract-baseline"]
---

# Prove native DSH connectivity and device access

## Plan

Test existing DSH client modules under Metro/Hermes, browser and Electron; extract a supported portable face in DSH only where needed. Add transports, handshake, operation reconciliation, enrollment/revocation and DSH-host discovery. Build one native session flow.

## Portable dependency installation

Consume the DSH-owned `@deepseek-ai/dsh-api-remotes-client` distribution and its shared dependency archives, pinning their source commit, checksums and package-manager lockfile. Do not copy DSH wire schemas or import Host packages into the app. Verify a clean package-manager install and strict declaration consumption before running the installed dependency through Metro/Hermes. Native runtime assembly uses one Cordis root and one hydrated Session selection per Host, explicit generated capability requirements and the app-owned cancellation adapter. Host credential storage, platform transports, QR enrollment and Session presentation remain required application work.

## Native device access

Use the installed DSH validators for enrollment and protected grant records. Native grants remain in Expo SecureStore with device-only, unlocked keychain access; a nonsecret Host-id index is the only enrollment data in ordinary storage. Serialize index/secret mutations, keep partially saved entries visibly unpaired, and surface storage failures without disclosing credentials. A missing or invalid stored grant never falls back to legacy passwords or browser ownership.

Pin every native HTTP and WebSocket target to the selected origin. Require HTTPS except explicit loopback or numeric Tailscale endpoints. Use Expo fetch to omit ambient cookies and reject redirects; retain caller/disposal cancellation through complete JSON-body decoding. Own a cancellable body reader: the SDK 54 native text/JSON helper waits only for body completion and can remain pending after cancellation. Send the device credential only in the Authorization header. The iOS WebSocket carrier must refuse redirects and pass the selected origin; the Host must reject invalid bearer credentials even if the platform includes a cookie. Qualification of other native carriers remains explicit.

Enrollment submits one claim and never replays it after a lost result. Store a returned grant before presenting pairing success. Opening a saved Host hydrates and validates its record before creating the per-Host runtime; final disposal cancels that runtime and its authenticated carriers. Forgetting local access and revoking a Host-side grant remain distinct operations. The actual QR and Session screens must consume this owner before native-client acceptance. The native access module now supplies protected storage, iOS carriers and saved-runtime composition. Its focused tests qualify failure and ownership behavior with native-module substitutes; platform execution and the application screens remain separate acceptance gates.

## Acceptance

Physical iPhone, desktop and browser attach to the same native session, stream, prompt and resolve an interaction without Paseo timeline projection. Authentication, incompatible versions, lost response and reconnect cases pass; backend gaps have accepted DSH specs.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
