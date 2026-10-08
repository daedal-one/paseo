---
id: TASK:migration/companion-recovery
type: task
status: accepted
summary: "Repair companion question submission and constrained-network recovery during migration."
owners: [daedal-one]
progress: done
addresses: ["REQ:frontend/interactions", "REQ:frontend/resilience"]
---

# Keep the existing companion usable during migration

## Plan

Repair the main companion bridge independently of the opt-in native preview. Accept committed responses that normalize trailing stream whitespace, prevent transcript recovery failures from disabling an independently valid pending interaction, preserve answers and expose submission failure, and avoid queuing stale interaction mutations across reconnect. Bound DSH tool previews sent to the phone and back off failed bridge recovery while retaining confirmed history.

## Acceptance

Regression tests cover normalized streamed reasoning, pending answers during transcript recovery, stale callback isolation, bounded tool previews, offline submission, and visible retry with retained answers. Validate the real companion question flow and interrupted or slow connections before publication. Keep Phase 3 physical-device acceptance and broader Phase 8 qualification separate from this repair.

## Evidence

The remote companion reported repeated `DSH committed response differs from its streamed prefix` failures when submitting answers. A metadata-only audit of the affected session found every observed mismatch differed only in trailing whitespace. The question UI logged submission failures without displaying them.

## Validation

The stream-normalization regression reproduced the live error before the fix. Focused provider tests cover normalized reasoning, bounded generic output, valid questions during transcript recovery, stale subscription frames, retry backoff and disposal during initialization. The client rejects disconnected answers before queuing them. The question form retains input, clears its failed spinner and exposes Retry in every supported locale.

Phone-width browser tests run the real app and an isolated daemon with the mock question provider over delayed WebSocket delivery. Both an interrupted send and a lost acknowledgement recover without automatic answer replay. Isolated DSH profile tests with recorded model sessions pass for real approvals and structured questions. These are browser and host checks, not physical iPhone acceptance. Full native on-demand history and result loading remains migration work.
