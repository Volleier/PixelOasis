# PixelOasis Development Guide

Merged from `notice.md` (runtime pitfalls + debugging lessons) and `DevNotice.md` (UI/shell design standards).

---

# Part A — Runtime & Debugging

## A1. UXP loading strategy

- A Vite/React bundle can produce a valid `dist`, but the Photoshop panel may still render only static background and fail to hydrate UI.
- The stable validated baseline is the classic UXP structure: `manifest.json`, `index.html`, `index.js`, `panel.css`.
- For UXP Developer Tool, the current reliable load target is `pixeloasis-plugin/dist/manifest.json`.

## A2. Build success ≠ runtime proof

- A successful build only proves the web tooling is happy — it does not prove Photoshop UXP can execute the generated script chain.
- Always validate inside Photoshop after each structural change.

## A3. UI debugging sequence

When the panel shows only background but no text or controls:

1. Reduce to pure static HTML.
2. Confirm static text is visible.
3. Add plain external JavaScript with no React.
4. Add minimal DOM updates.
5. Only then restore more complex UI structure.

## A4. UDT and Photoshop caching

If code changes do not appear in Photoshop:

1. unload the plugin in UDT
2. reload `dist/manifest.json`
3. close and reopen the panel
4. restart Photoshop if needed

## A5. Static fallback for load diagnosis

Put visible fallback text directly in `index.html` with inline styles. This was the fastest way to prove Photoshop loaded the latest file.

## A6. CSS naming in debugging

- Use prefixed or inline styles when isolating host-style conflicts.
- Even when CSS conflict was not the root cause, generic names increase ambiguity during debugging.

## A7. Encoding

- Some Chinese UI text became mojibake during iteration.
- Keep files in UTF-8 and recheck visible strings after edits.

## A8. Top-level module initialization

- Do not eagerly execute `require("photoshop")` or `require("uxp")` at module top level.
- Lazy-load them inside event handlers or narrowly scoped functions.
- Top-level init failures can blank the whole panel.

## A9. `app.currentTool` is not writable

- Real test: `app.currentTool.id = "marqueeRectTool"` had no effect — the tool stayed as `moveTool`.
- Do not implement tool switching via direct assignment.

## A10. Tool switching must use recorded `batchPlay` descriptors

Valid recorded tool switch command:
```json
{"_obj":"select","_target":[{"_ref":"marqueeRectTool"}]}
```

## A11. Recording actions correctly

Wrong recording symptoms:
- contains `_property: "selection"`
- contains `_obj: "rectangle"` or `_obj: "polygon"`

Correct recording rule:
1. Switch to another tool first (e.g., Move Tool).
2. Start recording.
3. Click the target tool icon only.
4. Stop recording immediately.
5. Do not drag on canvas during recording.

## A12. Current validated baseline

- classic UXP shell
- visible centered UI
- working plain button click
- working local counter increment
- working current tool ID readout
- ability to execute recorded Photoshop action descriptors through `batchPlay`

## A13. Product goal

The core product value is:
1. read user selection
2. export selected pixels and mask
3. send request to model backend
4. receive generated image
5. place image as a new layer
6. rebuild mask aligned to original selection

---

# Part B — UI & Layout Standards

## B1. Single root mount model

- `index.html` contains only a single root container (`#app`).
- One script file renders the full UI into that container.
- Layout is produced by the runtime entry script, not scattered across static fallback markup.

## B2. Shell structure

Preferred flow:
1. static `index.html`
2. single script entry
3. script initializes runtime
4. runtime mounts one app container

## B3. Layout direction: vertical app-first

Prefer a full-height flex column layout:
- `display: flex; flex-direction: column`
- content section uses `flex: 1`
- header / tabs fixed at top
- bottom utility area fixed at bottom
- middle section scrollable

Avoid relying on absolute positioning for major content blocks or overlay-style primary layout.

## B4. Tokenized design system

Define reusable tokens up front. Currently used in `panel.css`:

| Category | Tokens |
|----------|--------|
| Background | `--bg-primary`, `--bg-surface`, `--bg-surface-alt`, `--bg-control`, `--bg-control-alt` |
| Border | `--border-muted`, `--border-strong`, `--border-subtle` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted` |
| Spacing | `--space-xs` (8px), `--space-sm` (12px), `--space-md` (16px), `--space-lg` (20px) |
| Font | `--font-size-xs` (11px), `--font-size-sm` (13px), `--font-size-md` (15px) |

Future tokens to add: `--radius-sm`, `--radius-md`.

## B5. Section blocks

Use rectangular content surfaces with:
- consistent padding (`--space-sm`)
- one border tone (`--border-muted`)
- one background tone (`--bg-surface`)
- consistent spacing between stacked sections

Organize content into section containers rather than isolated floating widgets.

## B6. Button styling (Photoshop 2024+)

- Flat dark surfaces — no glossy, beveled, or gradient styles.
- Borders visible but restrained.
- Hover states subtle (background shift, not heavy 3D effect).
- Active state: subtle background shift.
- Consistent height across the panel.

## B7. Corner radius

- Small radius for controls.
- Medium radius for cards and sections.
- Full radius only for pills, status chips, or toggles.
- Current panel uses `border-radius: 0` for buttons (flat) and `border-radius: 50%` for toggle thumb.

## B8. Scrollable content containers

- Full-height root.
- Scrollable content pane (`overflow-y: auto` on the content region).
- Fixed header / footer.
- Do not let scrolling be controlled by the entire document.

## B9. Status integration

Bottom-bar log is acceptable during early development. Long term, workflow status should become a formal UI element (header chips, progress sections, inline state blocks).

## B10. Content surface rules

- Rectangular surfaces with modest padding.
- One border tone, one background tone.
- Consistent spacing between stacked sections.
- Do not mix floating cards, overlay cards, and hardcoded absolute blocks unless required.

## B11. Settings / detail surface rules

The detail surface should behave like a deliberate sub-panel:
- visually anchored to the shell
- consistent header height
- simple stacked rows
- text left-aligned, controls right-aligned
- explicit separation line between header and body

## B12. Photoshop-like control guidance

- Buttons flat, borders restrained, hover states subtle.
- Controls should not look like browser-default form elements.
- Control height consistent across the panel.
- Applies to: primary action buttons, text buttons, tabs, toggles, status pills.

## B13. Manifest maturity

A production-grade plugin formalizes:
- permissions
- icons
- communication allowances
- host compatibility
- declared panel sizes

Revisit manifest completeness after core workflow is stable.

---

# Part C — Project Recovery & Direction

## C1. Main deviation that happened

The plugin deviated from a normal path because:
1. tried to validate React, Spectrum, UXP runtime, host layout, and Photoshop APIs simultaneously
2. shifted repeatedly between shell models
3. used too much absolute positioning and temporary fallback markup
4. lacked a stable tokenized layout baseline

## C2. Corrective route

1. keep classic UXP shell stable
2. keep a single `#app` runtime mount
3. rebuild layout as a vertical app shell
4. introduce tokenized theme variables
5. keep only one primary workflow section at first
6. add tabs only when workflow areas multiply
7. restore selection capture, mask export, and image return one step at a time

## C3. Where the current shell is still provisional

- texts and styles were repeatedly patched during debugging
- layout still needs final consolidation into a stable tokenized system
- some visual values are still one-off instead of variable-driven
- settings / detail surface behavior is newly stabilized

## C4. Recommended development order

1. Keep classic UXP shell stable.
2. Keep minimal plain-JS UI working.
3. Validate each Photoshop API call in isolation.
4. Add one real workflow step at a time.
5. Reintroduce richer UI architecture only after core Photoshop interactions are stable.

## C5. UI implementation rules

- Prefer one shell renderer over mixed static and dynamic layout approaches.
- Prefer flex column layout over absolute-position-first layout.
- Prefer section blocks over floating ad hoc controls.
- Prefer tokenized colors, spacing, and typography over one-off values.
- Prefer flat Photoshop-2024-style controls over older glossy styling.
- Keep debugging fallbacks temporary and remove them once the root cause is known.

## C6. Avoid early dependency on Spectrum Web Components

- Spectrum Web Components were introduced too early and became part of the uncertainty surface.
- Future reintroduction only after: static HTML works, plain JS works, Photoshop API calls work.
- Also applies to React, Vite, Bolt UXP.
