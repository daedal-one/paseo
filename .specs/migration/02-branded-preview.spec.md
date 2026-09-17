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

## Setup and support surfaces

Use the approved company mark in both native and browser startup rendering. Welcome, startup failure, sidebar help, changelog and feature-guide links point to the fork-owned setup, issue, release and documentation destinations. Keep bridge protocol identifiers and working pairing formats unchanged; present the companion pairing format in examples. Reuse localized Help copy and existing app navigation. Inspect the actual native welcome and browser help destinations, and qualify both export variants before release.

- [Welcome](spec:src:packages/app/src/components/welcome-screen.tsx)
- [Startup](spec:src:packages/app/src/screens/startup-splash-screen.tsx)
- [Support destinations](spec:src:packages/app/src/components/sidebar/sidebar-help-menu.tsx)

## Preview update availability

Development and directory-only previews without packaged update metadata do not contact a release server or offer installation. Report that automatic updates are unavailable and direct users to install a new build manually; do not report the app as up to date. Recheck availability before installation, clear stale prepared updates when unavailable, and retain visible failures for unreadable/invalid metadata or remote update failures. Keep published metadata owned by the daedal-one fork. Verify the shared service, real filesystem adapter, localized renderer state and installed preview separately.

- [Update service](spec:src:packages/desktop/src/features/app-update-service.ts)
- [Update adapter](spec:src:packages/desktop/src/features/auto-updater.ts)
- [Update presentation](spec:src:packages/app/src/desktop/updates/desktop-app-updater.ts)

## Acceptance

A preview installs on Carlo's Mac and controls an existing DSH session, including approval and reconnect. Closing it leaves the external host running. Installed branding and updater ownership are inspected; required signing is verified before distribution. If the qualified preview changes the iPhone app, its matching signed companion build is submitted and its TestFlight availability is verified under the phase delivery requirement.

[Full work package and estimates](spec:doc:docs/daedal-dsh-migration-plan.md).
