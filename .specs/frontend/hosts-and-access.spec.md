---
id: REQ:frontend/hosts-and-access
type: requirement
status: accepted
summary: "Enroll once and discover reachable DSH hosts without treating discovery as authorization."
owners: [daedal-one]
level: MUST
related: [INV:frontend/dsh-authority, IFC:frontend/dsh-connection]
---

# Device pairing and host discovery

:::{requirement id="hosts-and-access" level="MUST"}
Users MUST be able to enroll through a one-time QR challenge and discover DSH candidates through a trusted host on Tailscale without typing addresses. Enrollment MUST be short-lived, single-use and bound to host identity; resulting device credentials MUST be revocable and held in protected platform storage. Discovery MUST be bounded and permissioned, verify endpoint identity/reachability, and never forward an existing host credential to a candidate. Network membership MUST NOT substitute for DSH authorization. The existing loopback/Tailscale deployment boundary MUST remain supported.
:::

## Verification

Verify initial QR, expired/reused QR, candidate identity mismatch, revoked device, offline host, bounded peer scan and cross-host credential isolation. Test discovery on an actual iPhone without tailnet administrative credentials and verify transition from the current pairing link.

## Current source and planned work

These anchors identify the transition surface, not implemented adherence.

- [Current source: companion-discovery.ts](spec:src:packages/server/src/server/companion-discovery.ts)
- [Current source: companion-discovery.ts](spec:src:packages/protocol/src/companion-discovery.ts)
- [Current source: companion-discovery-section.tsx](spec:src:packages/app/src/components/companion-discovery-section.tsx)
- [Current source: companion-pairing.ts](spec:src:packages/app/src/utils/companion-pairing.ts)

[Migration plan](spec:doc:docs/daedal-dsh-migration-plan.md).
