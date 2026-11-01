---
version: 1
slug: "packages-app-src-dsh-ui-workspace-screen-tsx"
primary_target: "packages/app/src/dsh/ui/workspace-screen.tsx"
related_targets:
  [
    "packages/app/src/dsh/ui/sessions.tsx",
    "packages/app/src/dsh/ui/product-header.tsx",
    "packages/app/src/dsh/ui/styles.ts",
  ]
---

# Workspace product shell

SEED: accepted-workspace-dense-inspection

SCOPE: Extend the accepted workspace-first interface into the primary browser, desktop and iPhone route. This is an existing product surface, using its current theme and primitives. Android connection qualification remains deferred.

THESIS: Start from the workspace and make every execution explainable on demand.

OWN-WORLD: A quiet, dense workbench in the existing dark forest palette. Workspace navigation gives a stable orientation; status and evidence carry emphasis. Existing theme tokens and controls remain authoritative.

STORY: Choose a workspace, see real pending decisions and active or recent executions, open a conversation, then inspect its recorded execution. Connection details return to the same active execution.

FIRST VIEWPORT: One compact header and one workspace toolbar lead directly to activity. Navigation becomes a horizontal strip at phone widths. The inspector replaces the content region; at 1280 by 800 its data begins within 150 pixels of the viewport top and has at least 600 pixels of height.

FORM: Operate. A shared adaptive React Native surface with native safe areas and desktop window chrome. Preserve all six inspection tabs, request selection, tools, approvals, usage and raw events. Resizing must preserve the connection, selection and draft.

PROOF: Recorded Session flows at 1280 and 390 pixels, including creation, a real replayed tool turn, every inspector tab, resize and connection round trips. iPhone and desktop exports prove compilation only; device and packaged application qualification are separate release evidence.

CONSTRAINTS: Sessions are executions, not a substitute durable Work entity. Shared memory and file browsing remain explicitly unavailable until their domain APIs exist. No private Vision implementation or specification is included. Existing PRODUCT/DESIGN documentation has inherited Paseo scope; do not rewrite that global system as part of this extension.
