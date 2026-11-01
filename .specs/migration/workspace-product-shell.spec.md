---
id: TASK:migration/workspace-product-shell
type: task
status: accepted
summary: "Make the shared workspace experience the app entry point across web, desktop and iPhone."
owners: [daedal-one]
progress: done
addresses: [REQ:frontend/workspaces-and-tools, REQ:frontend/sessions, REQ:frontend/desktop]
related: [TASK:migration/workspace-overview-session-inspector, TASK:migration/08-mobile-and-web]
blocked_by: []
---

# Workspace product shell

## Plan

Replace the inherited agent-oriented entry page with the direct DSH workspace experience. Use one adaptive workspace navigation, compact branded header and activity layout on browser, Electron and iPhone. Keep pairing and connection management accessible and retain existing host credentials. Preserve direct legacy routes. Use current Workspace membership and Session state; durable Work intake and reviewed memory require their existing domain APIs and must not be simulated by renaming Sessions.

Keep the router and connection owner mounted across viewport changes. Preserve selected Workspace, conversation, draft and inspector state when resizing. Make every inspector tab discoverable on phones with visible overflow controls. Reuse the existing six-tab inspector, recorded data projections, pending interactions, creation, registration and search.

## Acceptance

The primary route reaches the direct workspace client without waiting for a Paseo daemon. All platform entry points use the shared product header and workspace navigation. Desktop navigation becomes compact on mobile without remounting the active route. Real recorded-session browser checks cover six inspector tabs, draft retention and desktop-to-phone-to-desktop resizing. Web and iPhone exports and desktop entry compilation must pass; Android direct access remains unavailable pending transport qualification; physical device and packaged desktop runtime checks remain separately recorded release gates. Production cutover remains separate; iPhone preview delivery follows the existing migration release policy.
