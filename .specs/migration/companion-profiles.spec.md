---
id: TASK:migration/companion-profiles
type: task
status: accepted
summary: "Make Host agent profiles the primary companion session control."
owners: [daedal-one]
progress: done
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

## Qualification and delivery

App source `a7c1899b81c042a1c2008dd1d50b61de2b38541d` is published on `codex/daedal-dsh`; its compatible companion server is deployed on dsh-dev from `68c61c513beca634c93bdb59963943e7227c922d`. Real browser, packaged Electron and Linux Host checks cover profile creation, model defaults, permission controls and retained interactions. The qualified desktop preview is installed. TestFlight 0.8.0 (7003007), EAS build `c79a4475-12fc-469a-beba-f92e1935d478`, submission `34276bcb-837b-4e2f-bc5d-323dde21ec71` and Apple build `d45ef076-02be-4035-b4b0-09ef416b1cb3` completed processing; Apple reports VALID and IN_BETA_TESTING with Carlo’s existing tester access verified on 20 September 2026. Physical iPhone execution was not performed and remains provisionally accepted by Carlo.

Attributable publication and artifact verification actions are `01a0bee9-84e0-7222-a2df-2e0889511e3c` and `01a0bef2-3082-7f01-8b42-45771b1bc618`. Local qualification and delivery receipts are retained in `.dev/daedal-dsh-plan-audit/companion-profiles-20260920/verification.json` and `.dev/daedal-dsh-plan-audit/testflight-7003007-20260920/verification.json`. This completes the transitional companion profile work; native Session creation and the remaining Phase 4 capabilities retain their own acceptance gates.
