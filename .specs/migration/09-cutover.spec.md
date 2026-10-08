---
id: TASK:migration/09-cutover
type: task
status: accepted
summary: "Make Daedal DSH primary and retire transitional authorities."
owners: [daedal-one]
progress: pending
addresses: ["REQ:frontend/release-and-cutover", "INV:frontend/dsh-authority", "REQ:frontend/brand"]
blocked_by:
  [
    "TASK:migration/02-branded-preview",
    "TASK:migration/05-settings-and-extensions",
    "TASK:migration/06-host-capabilities",
    "TASK:migration/07-desktop-runtime",
    "TASK:migration/08-mobile-and-web",
  ]
---

# Make Daedal DSH primary and retire transitional authorities

## Plan

Import eligible client preferences with native ID mappings; qualify coexistence, default selection and rollback; remove bridge/provider abstractions and standalone harness dependencies only after their gates. Complete branding, release documentation, owned services and upstream attribution.

## Acceptance

Required parity rows and a two-week proposed daily-use soak pass. No duplicate durable authority, required upstream service or unqualified installed-client migration remains. Keep current UI for the additional qualified release window; retirement requires evidence, not elapsed time alone.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
