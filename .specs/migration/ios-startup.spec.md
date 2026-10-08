---
id: TASK:migration/ios-startup
type: task
status: accepted
summary: "Repair the startup crash in the signed native iPhone client."
owners: [daedal-one]
progress: done
addresses: ["REQ:frontend/resilience", "REQ:frontend/release-and-cutover"]
---

# Native iPhone startup recovery

## Plan

Retrieve the TestFlight report for build 7003008, reproduce startup with the release JavaScript engine, repair the observed failure, and qualify the corrected native startup before publishing a replacement through the existing companion identity.

## Acceptance

A cold native launch reaches the conversation directory and survives foreground transitions. Existing Host enrollments, drafts and offline previews remain intact. Regression coverage exercises the actual failure. Release evidence distinguishes simulator qualification, Apple processing and the reporter's physical-device confirmation.

## Evidence

The TestFlight report for build 7003008 records an iPhone 17 on iOS 27.0 terminating with SIGBUS while Hermes reads an error stack during a microtask checkpoint. An unmodified Release build reproduces startup failure on an iPhone 17 simulator running iOS 26.5: the DSH terminal imports the DOM terminal runtime for UTF-8 encoding, evaluating its image addon's WebAssembly dependency inside Hermes. Shared output encoding must load independently of DOM and WebAssembly renderers.

The corrected native Release build reaches the Host directory on two cold launches and resumes in the same process after backgrounding on iOS 26.5. Startup logs contain no fatal JavaScript exception. All 35 focused startup, Unicode output, terminal runtime and streaming tests pass, as do workspace type checks and lint. Additional browser suites stall during test-runner initialization before executing a test, including with a fresh isolated cache; those checks remain incomplete.

Source revision `1d506d6faac3b03eb701e770b9b3baa62aa0385b` is published on client `main`. Signed EAS build `1a4a8afc-5ead-4c08-a064-3ad33cea4fc0`, version 0.8.0 (7003009), finishes successfully with the existing companion identity. Apple's installed upload tool validates the exact signed archive without errors. The unstarted Expo submission `7c7d3f9a-3898-4835-b1f0-caae979a802e` is cancelled after waiting nearly fifteen minutes in its worker queue. Direct upload of the same archive succeeds at 2026-10-08T17:57:49Z with delivery identifier `30bbe656-1444-42df-b526-934469019450`.

At 2026-10-08T18:03:21Z, Apple's authenticated API confirms build `30bbe656-1444-42df-b526-934469019450` is `VALID`, version 0.8.0 (7003009), with internal state `IN_BETA_TESTING`. The existing Team (Expo) internal group has access to the build and automatic notification is enabled. Physical iPhone confirmation on iOS 27 remains unverified and must come from the reporter.
