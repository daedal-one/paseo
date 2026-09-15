---
id: TASK:migration/07-desktop-runtime
type: task
status: accepted
summary: "Integrate the managed DSH desktop runtime."
owners: [daedal-one]
progress: pending
addresses:
  ["REQ:frontend/desktop", "INV:frontend/dsh-authority", "REQ:frontend/release-and-cutover"]
blocked_by: ["TASK:migration/03-native-client", "TASK:migration/02-branded-preview"]
---

# Integrate the managed DSH desktop runtime

## Plan

Integrate DSH DesktopHost transport, bundled upstream Node and profile installer with Daedal shell. Resolve exclusive ownership/handoff with existing DSH desktop. Add coherent install/update/health-check/rollback and owned signing/release metadata.

## Acceptance

Clean-machine and offline activation, lock conflict, external-host exit, sleep/resume, interrupted update and failed-health rollback pass. Inspect signed/notarized macOS artifact; renderer privileged operations remain narrow and validated.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
