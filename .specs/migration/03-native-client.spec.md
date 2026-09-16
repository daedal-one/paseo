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

## Acceptance

Physical iPhone, desktop and browser attach to the same native session, stream, prompt and resolve an interaction without Paseo timeline projection. Authentication, incompatible versions, lost response and reconnect cases pass; backend gaps have accepted DSH specs.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
