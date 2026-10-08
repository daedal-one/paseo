---
id: SCN:frontend/cross-device-session
type: scenario
status: accepted
summary: "Qualify session identity, approvals, network recovery and safe upgrade across clients."
owners: [daedal-one]
related:
  [
    REQ:frontend/sessions,
    REQ:frontend/interactions,
    REQ:frontend/hosts-and-access,
    REQ:frontend/resilience,
    REQ:frontend/release-and-cutover,
  ]
---

# Continue one DSH session across desktop and iPhone

## Preconditions

A DSH host owns an existing workspace and session. Daedal DSH desktop and the installed iPhone companion have a supported upgrade path. The current DSH UI remains accessible. The host exposes the capabilities required by the scenario.

## Main journey

1. Upgrade the iPhone app in place to Daedal DSH and pair through a single-use QR. Discover another candidate without typing an address; establish its authorization separately.
2. Open the original session on desktop and phone. Both show the same native identity, history and model/preset context.
3. Send a prompt on the phone, observe streamed text, a tool subcall, a large deferred result and a child session on both clients.
4. When DSH asks for approval, answer concurrently on both clients. Exactly one valid decision resolves; both show the confirmed outcome.
5. Suspend the phone, continue work on desktop, lose and restore network, then return to the phone. Catch up from confirmed history without duplicate prompt or stale approval replay.
6. Inspect an artifact and terminal where authorized; attempt a stale file edit and observe a revision conflict without overwriting newer content.
7. Close the desktop client connected to the external host. DSH continues the session. Reopen and restore selection.
8. Revoke phone access from the host. The phone loses authorized access and its host-specific cached private data follows the declared policy.

## Failure and recovery variants

Reject expired/reused QR codes, identity-mismatched candidates and incompatible required event versions. Reconcile a send whose response is lost after acceptance. Fail a managed-runtime upgrade health check and recover to a compatible installation without starting a competing writer. Use the retained DSH UI against the same authoritative backend while diagnosing a client failure.

## Evidence

Use real Mac/iPhone interactions and backend state, plus deterministic recorded-session tests for event coverage. A screenshot or successful build alone does not establish this scenario.
