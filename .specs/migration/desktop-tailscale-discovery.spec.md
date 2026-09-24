---
id: TASK:migration/desktop-tailscale-discovery
type: task
status: accepted
summary: Discover Tailscale companions from Desktop before any host is paired.
owners: [daedal-one]
progress: done
addresses: [REQ:frontend/hosts-and-access]
---

# Desktop Tailscale discovery

## Plan

Expose the existing bounded companion scanner through application-frame-only Desktop IPC. Read the local Tailscale peer inventory without a saved Host, running companion daemon, user-entered address or hardcoded server. Automatically show results on the Desktop welcome screen and Add host. Reuse candidate identity verification and explicit connection; discovery alone never saves a host or transfers credentials. Mobile retains discovery through an online paired host.

## Verification

Prove that an empty Desktop profile discovers the live tailnet server before connecting, then connect by selecting its discovered name and verify restoration after restart. Cover IPC admission and rejection of caller-supplied scan targets, candidate bounds, missing/disconnected Tailscale and mobile host-assisted discovery. Rebuild and install the packaged application with preserved user data.

## Qualification

The packaged macOS arm64 preview discovered the live `dsh-dev` companion from an empty application profile without an address, saved host or running local companion. Selecting the discovered name connected to the existing remote workspaces; restarting that profile restored the connection. The same bundle is installed at `/Users/carlo/Applications/Daedal DSH.app`, with the original application retained for rollback. Focused discovery and IPC tests, affected-workspace type checks, lint, package runtime loading and deep signature verification passed. This is a local ad-hoc-signed preview; no notarized release or physical-iPhone run is claimed.
