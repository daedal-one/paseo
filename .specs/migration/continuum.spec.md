---
id: TASK:migration/continuum
type: task
status: accepted
summary: "Browse every DSH conversation and restore device-local continuity through the native clients."
owners: [daedal-one]
progress: done
addresses:
  [
    "REQ:frontend/sessions",
    "REQ:frontend/resilience",
    "REQ:frontend/configuration",
    "REQ:frontend/workflows",
    "REQ:frontend/workspaces-and-tools",
  ]
---

# Native cross-device continuity

## Plan

Refresh the generated portable Client against the combined current server and native-client APIs. Open the DSH session directory from the companion application home without importing Sessions. Reconnect the remembered enrolled Host automatically, preserve Host-qualified navigation and text drafts, and cache bounded readable conversation previews. Keep the server authoritative; hydrate selected history and exact large results lazily. Discover and expose supported server commands, Session configuration and Host capabilities through generated API descriptors.

## Acceptance

Every eligible server Session is browsable without an import or a second authoritative Session record. Initial enrollment remains explicit. Remembered offline Hosts stay selected. Cached transcripts are labeled stale and never authorize mutations; generation admission and fresh Session state are required for actions. Host forgetting removes its cache and navigation. Reconnect and restart never repeat mutations. Desktop, browser and iPhone share the same owners. Focused tests cover cache bounds, isolation, remembered selection and late responses; actual browser and packaged-build checks establish only their exercised platforms.

## Delivery

The source increment is locally qualified. Signed mobile delivery and physical-device checks retain their separate release gates; this task does not complete the wider migration phases or remove the companion bridge.

## Evidence

Focused cache, directory, terminal, runtime and presentation checks pass (119 cases), with an additional child-file restriction regression. Browser checks at 390px and 1280px pass against the isolated built Host, including the second device, cold draft restoration, Host reads, recorded commands and real terminal input. Workspace types, lint, spec lint, Web and iOS exports pass. The macOS preview packages and loads its native access modules with one portable Client identity; it is an ad-hoc local preview, not a notarized release. The six portable archives pin clean source `a17881c3c7962b5ecf9bcfea99b99fcf0fc19c0d`. Source publication, server activation, installed-app replacement and TestFlight upload are separate from this local qualification. Android native access remains unqualified.

## Primary-branch delivery

Carlo requested merging this increment onto the primary branches and uploading the existing iPhone application to TestFlight on 8 October 2026. The Paseo primary branch is `main`; the server primary branch is `master`. The merged client retains the existing application identity and companion submission profile. Its portable artifacts pin server master candidate `1436cb81561173fb298742cea7ce3566d70b29cf`. Publication of this increment does not establish wider migration completion, notarized desktop distribution or physical-device execution.
