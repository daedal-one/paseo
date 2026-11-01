---
version: 1
slug: "packages-app-src-dsh-ui-workspace-screen-tsx"
primary_target: "packages/app/src/dsh/ui/workspace-screen.tsx"
related_targets:
  [
    "packages/app/src/dsh/ui/sessions.tsx",
    "packages/app/src/dsh/ui/workspace-contents.tsx",
    "packages/app/src/dsh/ui/workspace-work.tsx",
    "packages/app/src/dsh/ui/workspace-files.tsx",
    "packages/app/src/dsh/ui/workspace-memory.tsx",
    "packages/app/src/dsh/ui/workspace-styles.ts",
    "packages/app/src/dsh/ui/product-header.tsx",
  ]
---

# Workspace product shell

SEED: accepted-workspace-dense-inspection

SCOPE: Extend the accepted workspace-first browser, desktop and iPhone surface with durable Work, registered Workspace Files and scoped Memory. Preserve the existing identity and primitives. Android connection qualification remains deferred.

THESIS: Give each outcome a lasting home, with its files, knowledge and executions close at hand.

OWN-WORLD: A quiet, dense workbench in the existing dark forest palette. Workspace navigation gives stable orientation; status, readable content and evidence carry emphasis. Existing theme tokens and controls remain authoritative.

STORY: Choose a workspace, create a durable brief, link or start an execution, and return to the same work after execution ends. Browse the registered source files and review memory with its provenance. Inspect every execution through its complete recorded details.

FIRST VIEWPORT: A compact workspace picker and New work action sit above one horizontal Overview, Work, Files and Memory rail. Work owns the main overview column; Files and Memory sit alongside it on desktop and below it on phones. Execution history follows as supporting detail. No duplicate workspace hero or metric tiles. Work detail replaces the canvas, with Back beside the title. Query and link controls stay grouped; registration and execution-history refresh belong to Overview. The inspector still replaces the full content region: at 1280 by 800 its data begins within 150 pixels of the viewport top and has at least 600 pixels of height.

FORM: Operate. A shared adaptive React Native surface with native safe areas and desktop window chrome. Work creation and editing are inline; the existing execution-creation sheet retains protected focus. Rows align on common rails, status colors encode actual persisted states, and controls have phone-sized touch targets. Preserve all six inspection tabs, request selection, tools, approvals, usage and raw events. Resizing preserves the connection, selection and session draft.

PROOF: Real Host flows must cover durable creation and edits, restart readback, execution linking, registered file previews, memory provenance and review, plus all six inspector tabs at desktop and phone widths. Browser captures establish browser responsiveness; iPhone and desktop exports establish compilation only. Device, packaged application and deployment qualification remain separate evidence.

CONSTRAINTS: Work is owned by DSH, and human completion never implies protected evidence acceptance. Creating Work does not submit a model prompt. Files address the registered source directory, never an arbitrarily selected execution filesystem. Memory retains its scope, status, exact revision and evidence. Unsupported, offline, loading, failed, empty and uncertain mutation outcomes remain distinct. No private Vision implementation or specification is included. Existing global PRODUCT/DESIGN documentation has inherited Paseo scope; do not rewrite that system as part of this extension.
