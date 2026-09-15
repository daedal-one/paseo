---
id: REQ:frontend/brand
type: requirement
status: accepted
summary: "Use daedal-one branding while preserving release identity and required attribution."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Daedal DSH identity

:::{requirement id="brand" level="MUST"}
Shipping user-visible identity MUST use Daedal DSH and approved daedal-one assets across apps, installers, store materials, help, website, notifications and accessibility text. Product copy MUST use the existing localization system. Existing iOS bundle, team and Expo identity MUST be preserved for in-place updates. Desktop identity and fork-owned delivery endpoints MUST be fixed before distribution. Upstream attribution and explicitly required compatibility identifiers MUST remain accurate.
:::

## Verification

Inspect installed icons, menus, splash, titles, about/help, update metadata and store screenshots. Upgrade the installed iPhone companion and open a retained pairing link. Run a branding inventory with a reviewed attribution/compatibility allowance; verify no default upstream update feed or service remains in the qualified release.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: app.config.js](spec:src:packages/app/app.config.js)
- [Current source: electron-builder.yml](spec:src:packages/desktop/electron-builder.yml)
- [Current source: auto-updater.ts](spec:src:packages/desktop/src/features/auto-updater.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
