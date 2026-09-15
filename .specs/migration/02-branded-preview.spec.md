---
id: TASK:migration/02-branded-preview
type: task
status: accepted
summary: "Deliver the first branded desktop preview."
owners: [daedal-one]
progress: in-progress
addresses: ["REQ:frontend/brand", "REQ:frontend/desktop", "REQ:frontend/release-and-cutover"]
blocked_by: []
---

# Deliver the first branded desktop preview

## Plan

Apply company assets/localized copy and fork-owned packaging/update configuration in packages/app and packages/desktop. Preserve iOS identity. Use existing-host attach mode through the bridge for an explicitly transitional preview.

## Acceptance

A preview installs on Carlo's Mac and controls an existing DSH session, including approval and reconnect. Closing it leaves the external host running. Installed branding and updater ownership are inspected; required signing is verified before distribution.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
