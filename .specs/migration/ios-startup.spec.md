---
id: TASK:migration/ios-startup
type: task
status: accepted
summary: "Repair the startup crash in the signed native iPhone client."
owners: [daedal-one]
progress: in-progress
addresses: ["REQ:frontend/resilience", "REQ:frontend/release-and-cutover"]
---

# Native iPhone startup recovery

## Plan

Retrieve the TestFlight report for build 7003008, reproduce startup with the release JavaScript engine, repair the observed failure, and qualify the corrected native startup before publishing a replacement through the existing companion identity.

## Acceptance

A cold native launch reaches the conversation directory and survives foreground transitions. Existing Host enrollments, drafts and offline previews remain intact. Regression coverage exercises the actual failure. Release evidence distinguishes simulator qualification, Apple processing and the reporter's physical-device confirmation.

## Evidence

The TestFlight report for build 7003008 records an iPhone 17 on iOS 27.0 terminating with SIGBUS while Hermes reads an error stack during a microtask checkpoint. An unmodified Release build reproduces startup failure on an iPhone 17 simulator running iOS 26.5: the DSH terminal imports the DOM terminal runtime for UTF-8 encoding, evaluating its image addon's WebAssembly dependency inside Hermes. Shared output encoding must load independently of DOM and WebAssembly renderers.

The corrected native Release build reaches the Host directory on two cold launches and resumes in the same process after backgrounding on iOS 26.5. Startup logs contain no fatal JavaScript exception. Focused startup, Unicode output, terminal runtime and streaming checks pass, as do workspace type checks and lint. Signed TestFlight delivery and physical iOS 27 confirmation remain separate release evidence.
