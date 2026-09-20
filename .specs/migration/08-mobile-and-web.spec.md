---
id: TASK:migration/08-mobile-and-web
type: task
status: accepted
summary: "Qualify iPhone and browser integration."
owners: [daedal-one]
progress: pending
addresses:
  [
    "REQ:frontend/resilience",
    "REQ:frontend/hosts-and-access",
    "REQ:frontend/configuration",
    "REQ:frontend/release-and-cutover",
  ]
blocked_by:
  [
    "TASK:migration/04-sessions-and-interactions",
    "TASK:migration/05-settings-and-extensions",
    "TASK:migration/06-host-capabilities",
    "TASK:migration/07-desktop-runtime",
  ]
---

# Qualify iPhone and browser integration

## Plan

Finish compact layouts, accessibility, keyboard input, bounded offline cache, sharing/downloads, pairing compatibility and optional notification delivery. Upgrade the installed TestFlight app and exercise supported browser flows.

## Acceptance

Real iPhone upgrade, pairing, revoked access, network transitions, background/foreground, long sessions and all required mobile flows pass. Browser and desktop share native semantics. Record calibrated latency/memory budgets and real distribution status.

The current delivered build uses the [provisional physical iPhone acceptance](03-native-client.spec.md#provisional-physical-iphone-acceptance). Its deferred device checks do not block continued migration; unfinished mobile capabilities and browser qualification remain required.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
