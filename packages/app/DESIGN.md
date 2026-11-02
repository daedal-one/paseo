---
name: daedal
description: A compact dispatch board for durable work and detailed execution review.
colors:
  emerald: "#187a49"
  emerald-hover: "#12613a"
  forest-header: "#17211e"
  header-rule: "#34473e"
  header-control-rule: "#80978b"
  paper: "#f6f7f6"
  reading: "#fafbfa"
  inset: "#eef1ef"
  overlay: "#e3e8e5"
  ink: "#202b25"
  muted-ink: "#58645e"
  rule: "#d9dfdb"
  selected-row: "#e3f1e9"
  dark-emerald: "#7ccba0"
  dark-emerald-hover: "#a2ddbb"
  dark-paper: "#171d1a"
  dark-reading: "#202823"
  dark-inset: "#29332d"
  dark-overlay: "#344139"
  dark-ink: "#edf3ef"
  dark-muted-ink: "#b2c0b8"
  dark-rule: "#405047"
  dark-selected-row: "#253f31"
  link: "#20744a"
  open-dot: "#4a7b4f"
  review-dot: "#b07822"
  error: "rgb(236, 19, 19)"
  dark-error: "rgb(242, 90, 90)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.8px"
  title:
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-.55px"
  inline-work-action:
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "22px"
  row-title:
    fontSize: "15px"
    fontWeight: 650
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "14px"
  brief:
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontSize: "13px"
    fontWeight: 600
  metadata:
    fontSize: "12px"
    lineHeight: 1.5
  status:
    fontSize: "11px"
    fontWeight: 600
  code:
    fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'"
    fontSize: "12px"
    lineHeight: 1.6
rounded:
  workspace-control: "4px"
  input: "8px"
  session-button-small: "14px"
  session-button: "18px"
  composer: "22px"
spacing:
  tight: "4px"
  inline: "8px"
  compact: "12px"
  phone-gutter: "16px"
  section: "20px"
  header-gutter: "24px"
  desktop-gutter: "28px"
components:
  workspace-primary:
    backgroundColor: "{colors.emerald}"
    textColor: "#ffffff"
    rounded: "{rounded.workspace-control}"
    typography: "{typography.label}"
    padding: "0 14px"
    height: "36px"
  inline-new-work:
    backgroundColor: "{colors.emerald}"
    textColor: "#ffffff"
    rounded: "{rounded.workspace-control}"
    typography: "{typography.inline-work-action}"
    padding: "0 14px"
    height: "36px"
  workspace-primary-hover:
    backgroundColor: "{colors.emerald-hover}"
  workspace-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.workspace-control}"
    height: "32px"
  workspace-input:
    backgroundColor: "{colors.reading}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "0 8px"
    height: "32px"
  workspace-navigation:
    backgroundColor: "{colors.reading}"
    textColor: "{colors.muted-ink}"
    padding: "0 28px"
  selected-work:
    backgroundColor: "{colors.selected-row}"
    textColor: "{colors.ink}"
    padding: "12px 28px 12px 27px"
  work-status:
    textColor: "{colors.ink}"
    typography: "{typography.status}"
  work-detail:
    backgroundColor: "{colors.reading}"
    textColor: "{colors.ink}"
    padding: "24px 28px 20px"
  composer:
    backgroundColor: "#ffffff"
    rounded: "{rounded.composer}"
---

# Design System: daedal

## Overview

**Creative North Star: "The dispatch board"**

A compact working interface pairs ruled lists with a calm reading field. Charcoal forest chrome identifies the workspace; emerald indicates selection and action. Durable Work remains legible while its execution opens for conversation and inspection.

The current interface preserves the canonical Session's richer controls, layered surfaces and rounded composer inside a comparatively square workspace. These two scales have different jobs: scanning and selecting work, then reading and intervening in an execution. Inline desktop inspection places Chat and its composer above the inspector; phone contextual headers separate the heading and expansion action from the utility controls. The selected composition is recorded in the [surface brief](.impeccable/surfaces/packages-app-src-dsh-ui-workspace-screen-tsx.md); [PRODUCT.md](PRODUCT.md) owns product commitments.

**Key Characteristics:**

- Ruled rows and explicit state labels.
- Neutral reading fields with emerald actions.
- Persistent selection and one mounted Session.
- Compact desktop inspection and one primary phone view.

This records the implemented source system, including its exceptions. It does not certify a final visual review or native runtime; [Session parity](../../docs/session-parity.md) owns qualification.

## Colors

### Primary

Emerald is the action and selection color. Links retain the slightly quieter `link` token. The dark theme uses `dark-emerald` for the same emphasis and dark forest text on filled primary buttons. Header chrome retains its forest fill in both themes.

### Neutral

Paper supports the working canvas; reading supports the detail pane; inset and overlay distinguish progressively nearer surfaces. Ink and muted ink carry the text hierarchy. Rules divide rows and panels. Selected rows use a pale forest tint in light mode and a deeper forest tint in dark mode.

The frontmatter captures the final theme cascade. Sidecar tonal ramps are generated swatch previews, not additional application tokens. Use the semantic CSS aliases in components so changes of theme also update borders, text, hover treatments and focus. A dark surface must not retain light-mode ink or selection fill.

### State

Open or active markers use `open-dot`; proposed or challenged markers use `review-dot`. Error color changes with the theme. Each marker accompanies a written label; transient execution activity does not replace a Work state.

**The State Label Rule.** Color reinforces a named state; the label supplies its meaning.

## Typography

The current implementation uses the platform sans stack for interface text, including existing headings. Code uses the separate code stack in frontmatter. There is no loaded brand display font. Platform sans display-sized headings are an existing design exception, not a prescription for future display typography.

The workspace hierarchy uses headline, title, row-title, body, label, metadata and status roles. Phone workspace headings reduce to 24px and detail headings to 23px; the embedded execution title reduces to 18px. Desktop execution titles use the title size with a 1.3 line height and -.025em tracking. Row revision and time metadata use tabular numerals.

Session reading text remains owned by its canonical typography system: the default content size is 14px, configurable from 12px to 17px. Markdown headings and leading follow the content delta; small and code text remain fixed. Do not apply a workspace headline scale to transcript content.

Uppercase tracking appears on compact table column labels and file-kind metadata. These identify actual fields; they are not a pattern for promotional eyebrows or decorative kickers.

## Layout

The application header is 48px tall. The Tools control opens a drawer up to 320px wide, bounded by 86vw, over a scrim. Workspace navigation occupies at least 38px and keeps Overview, Work, Files and Memory reachable. Desktop board/detail uses a 56/44 split with independent minimum-width constraints and ruled separation. Rows are at least 68px tall; the main desktop gutter is 28px.

At 1100px viewport width, board controls stack and the time column disappears. At 700px, the workspace uses one selected pane, 16px gutters, at least 80px rows and 44px workspace tabs. A return action restores the board and its selection. File browsing shifts from a list/preview pair to one column.

Execution layout also responds to its measured container: below 1000px, or when expanded, it uses one primary Session view. Wider inline presentation keeps the Work board beside a detail column ordered as Chat, its existing composer, the Inspector heading with tabs and expansion action, then inspection content. A shared CSS grid assigns those stable seats four rows: minmax(120px, 3fr), auto, auto and minmax(160px, 2fr). Chat and inspection remain parts of one Session; the layout does not relocate or recreate the composer. Expansion preserves the mounted composer, draft and inspection selection.

The embedded Session root stays bounded by its allocated height; child panes own history scrolling. At 767px and below, its tabs have a minimum 44px width and height, horizontal overflow, and 12px gaps. The phone contextual header uses separate grid rows: the Inspector heading and expansion action occupy the first; preset and Host controls, overflow utilities and the rightbar control occupy the second. Header buttons retain a 44px minimum height, with utility and rightbar buttons also at least 44px wide. The embedded composer text cap becomes the smaller of 160px and 24dvh. Expanded phone presentation hides the Work title and brief, places the execution toolbar in the first row and retains Work actions in a disclosure. This keeps the selected view primary without removing its Work context.

Resize and expand the existing Session seat; preserve its draft, request selection and interaction owners.

## Elevation & Depth

Workspace lists and details use tonal surfaces and fine rules, without card shadows. Floating Tools uses the shared third-level shadow. The canonical composer retains a half-pixel elevation stroke with two soft shadows; dark mode relies strongly on that stroke for separation. Menus and overlays retain their canonical elevation rather than inheriting a blanket no-shadow rule. Exact shadow expressions live in the sidecar.

Layout transitions use the existing standard easing and fast, standard and slow durations. The Tools drawer has its own 180ms ease-out curve. Reduced motion disables frame, drawer, resize-handle and phone inspection transitions. Selection itself should remain immediate; motion must not make a stable Work row appear to change position.

## Shapes

Workspace actions, selects and textareas use gently squared control corners. Search inputs retain the shared input radius. Ruled board rows and detail panes remain rectangular. Session primitives keep capsule buttons and the softer composer radius; do not flatten those distinct controls to make the board appear uniform. Status dots are 6px circles.

## Components

### Buttons

Workspace actions override shared capsule geometry with the workspace-control radius. The inline board New work action retains its existing 16px plus icon and has a 109px minimum width, 36px minimum height, 14px horizontal padding and medium-weight text. Its action group aligns to the top of the board heading; the heading keeps 28px left and 16px right padding. This width belongs to that board action, not every primary button. Primary actions use emerald, contrasting foreground and an explicit hover fill. Secondary actions remain quiet until hover. Disabled shared buttons use 0.4 opacity and a not-allowed cursor. Keyboard focus in workspace and execution frames uses a 2px emerald outline offset by 3px; Session tabs use an inset outline. Phone execution header buttons and selects reach 44px; other phone workspace actions currently have a 36px minimum, an existing touch-target limitation rather than a universal mobile standard.

For open tracking Work in the execution frame, the Work actions order is Edit brief, New execution, then Mark complete. New execution is the filled primary action; Edit brief is outlined and Mark complete stays secondary. These same actions remain inside the existing Work actions disclosure in compact and expanded presentation.

The Host application split control has a 28px minimum height rather than a fixed height. Its wrapper grows around the contextual phone header's 44px buttons and its half-pixel borders; keep the wrapper flexible so the child hit targets remain contained.

### Inputs / Fields

Shared search inputs use a thin border, reading fill, input radius and 32px height. Focus changes their border to emerald. Workspace placeholders deliberately use muted ink at full opacity. Brief textareas and execution selectors use the smaller workspace-control radius with base fill. Long brief text wraps and preserves line breaks; resizing a textarea is vertical.

### Navigation

Workspace destinations use a 3px emerald bottom rule and primary ink for the current destination. Session tabs use their existing 2px active underline. Tabs and overflow remain keyboard reachable. The labeled Tools drawer contains the existing global and sidebar contributions.

### Work rows and status

Rows combine a title, execution count and named state. Tracking Work adds a brief excerpt and, when space permits, an updated date; other Work rows show revision in that final column. The detail header also shows revision. Selected rows gain a tinted fill and a 1px emerald left edge. Hover uses the theme's interactive fill. Ellipsis belongs to row previews; the detail exposes the full brief. Status markers are inline text and dot combinations, not decorative badge pills.

### Detail panels and notices

Work detail uses a reading surface, ruled header, visible brief, actions and execution selection. Files and Memory share the same restrained separators and text hierarchy. Empty states name the available next action; loading, unavailable and failure readings stay explicit. Mutation receipts use the inset surface and allow identifiers to wrap. An uncertain result must retain its identity and relevant input.

### Canonical Session and composer

The full canonical Session owns transcript rendering, inspection, interaction forms and its single composer. Inline desktop Chat remains visible above its composer, followed by the inspector header and content; expanded and phone presentation use one primary view. The composer keeps its rounded elevated surface and settings-aware text size. Its default content width is adaptive, with a preferred 680–920px span where the available column allows it, and a composer card 32px wider than the reading measure. Narrow containers constrain both without horizontal page overflow.

## Do's and Don'ts

### Do:

- **Do** use semantic theme aliases for text, surfaces, rules, selection and focus.
- **Do** preserve selected Work, drafts and inspection state through responsive changes.
- **Do** keep written state labels and explicit unavailable or uncertain readings.
- **Do** preserve the canonical Session's component owners and distinct composer geometry.
- **Do** qualify browser, desktop and iPhone behavior separately in the parity ledger.

### Don't:

- **Don't** turn Work execution activity into a durable Work status.
- **Don't** introduce dashboard tiles, invented metadata or a second composer into this workspace composition.
- **Don't** replace canonical inspection with a raw-data summary or a link to another interface.
- **Don't** canonize the existing platform-font headings or 36px phone action minimum as new display or mobile accessibility standards.
- **Don't** add decorative kickers or shadows to the ruled board merely because Session overlays use elevation.
