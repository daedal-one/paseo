---
id: TASK:migration/03-native-client
type: task
status: accepted
summary: "Prove native DSH connectivity and device access."
owners: [daedal-one]
progress: pending
addresses:
  ["IFC:frontend/dsh-connection", "REQ:frontend/hosts-and-access", "REQ:frontend/resilience"]
blocked_by: ["TASK:migration/01-contract-baseline"]
---

# Prove native DSH connectivity and device access

## Plan

Test existing DSH client modules under Metro/Hermes, browser and Electron; extract a supported portable face in DSH only where needed. Add transports, handshake, operation reconciliation, enrollment/revocation and DSH-host discovery. Build one native session flow.

## Acceptance

Physical iPhone, desktop and browser attach to the same native session, stream, prompt and resolve an interaction without Paseo timeline projection. Authentication, incompatible versions, lost response and reconnect cases pass; backend gaps have accepted DSH specs.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
