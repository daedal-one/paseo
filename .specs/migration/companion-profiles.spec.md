---
id: TASK:migration/companion-profiles
type: task
status: accepted
summary: "Make Host agent profiles the primary companion session control."
owners: [daedal-one]
progress: in-progress
addresses: ["REQ:frontend/configuration", "REQ:frontend/sessions", "REQ:frontend/interactions"]
blocked_by: ["TASK:migration/03-native-client"]
---

# Host profiles in companion sessions

## Plan

Prioritize profile selection ahead of on-demand history and the remaining configuration phase. In the shared iPhone, desktop and browser companion conversation flow, offer the same healthy Host agent-preset roster, descriptions and deployment default as DSH Web. Create the Session with the selected preset before its first turn. Let the profile supply model and reasoning defaults; explicit model overrides belong in session Settings. Keep profile selection distinct from saved companion model shortcuts and permission modes. Existing Sessions show their authoritative profile without switching a started composition.

New profile-based Sessions select policy-reviewed when their Host advertises it. Keep other Host-supported permission modes in session Settings. Preserve Host policy enforcement, exceptional approval requests and recorded permission state when attaching to existing Sessions. Never infer sandbox containment from a client setting.

Use existing companion feature transport for this transitional flow. Profile choices belong to one Host and draft; do not persist a selected id as a cross-Host preference. Roster errors are visible and retryable. An unsupported Host retains supported existing behavior and identifies unavailable profile selection. Invalid or removed selected profiles fail rather than silently choosing a different profile. Lost mutations are never replayed automatically.

## Acceptance

Prove actual profile roster and creation against an isolated built DSH Host, including distinct profile model defaults, a removed profile, permission default and alternate mode, existing Session attachment and retained human interactions. Verify compact and desktop UI with the real app. Run focused server, selection, localization and relevant regression checks, typecheck, lint and platform exports. Publish a compatible companion server before app delivery, preserve existing checkouts and running DSH ownership, and deliver the exact qualified iPhone build through the existing TestFlight app. Physical iPhone execution is provisionally accepted by Carlo; record the waiver separately from performed tests. Direct native preview creation remains in the broader Session migration task.

## Implementation surfaces

- [Companion provider](spec:src:packages/server/src/server/agent/providers/dsh/agent.ts)
- [Session authority](spec:src:packages/server/src/server/agent/providers/dsh/session.ts)
- [Shared composer controls](spec:src:packages/app/src/composer/agent-controls/index.tsx)
- [Draft feature ownership](spec:src:packages/app/src/hooks/use-draft-agent-features.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
