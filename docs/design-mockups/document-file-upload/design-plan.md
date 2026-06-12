# Design Plan — Document File Upload (Static HTML Mockup)

**Feature:** Document file upload on the project Documents tab.
**Scope:** Pre-spec mockup gate (`docs/design-workflow.md` §1a). Extends the existing metadata-only `DocumentsTab` with file presence, upload, download, preview, revision lineage, and the `Superseded` status.
**Binding inputs:** OD-DOC-1..5 (`docs/decisions.md`), glossary Document/Revision/Superseded definitions, `DESIGN.md` tokens.
**Output:** `docs/design-mockups/document-file-upload/index.html` (and optional `states.html`).

---

## 1. Layout & Component Breakdown

### 1.1 Enhanced Documents Tab (Desktop ≥768px)

The tab content area is bounded by the existing project-detail tab strip. Only the tab interior and its modals/drawers are mocked — no app shell changes.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Document register                                    [+ Add document]│
│  Drawings, specs, and transmittals. Upload files on Draft rows.     │
├─────────────────────────────────────────────────────────────────────┤
│  12 documents                                    🔍 Search documents │
├─────────────────────────────────────────────────────────────────────┤
│ Document │ Code    │ File │ Category     │ Date       │ Status      │
│ ─────────┼─────────┼──────┼──────────────┼────────────┼──────────── │
│ Found…   │ DWG-001 │ 📎 ↓ │ Drawing      │ 2026-05-10 │ ●Approved   │ [New revision]
│ Rev A    │         │      │              │            │             │
│ ─────────┼─────────┼──────┼──────────────┼────────────┼──────────── │
│ Found…   │ DWG-001 │ —    │ Drawing      │ 2026-06-01 │ ●Draft      │
│ Rev B    │         │ ↑    │              │            │             │
│ ─────────┼─────────┼──────┼──────────────┼────────────┼──────────── │
│ Site…    │ RPT-003 │ 📎 ↓ │ Report       │ 2026-04-20 │ ●Superseded │
│ Rev A    │         │      │              │            │             │
├─────────────────────────────────────────────────────────────────────┤
│ (card-reflow below 768px — see §3)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

#### Columns (existing + new)

| Column | Token | Notes |
|---|---|---|
| **Document** (title + revision) | `{typography.body}`, `{typography.label}` for "Rev X" | Unchanged from current. First cell = row activation (`rowLabel`). |
| **Code** | `{typography.mono}`, `{colors.muted-foreground}` | Unchanged. Hidden below `sm`. |
| **File** *(NEW)* | See §1.2 | File presence indicator + action affordance. Hidden below `md`. |
| **Category** | `{typography.body}`, `{colors.muted-foreground}` | Unchanged. Hidden below `md`. |
| **Date** | `{typography.body}`, `tabular`, `{colors.muted-foreground}` | Unchanged. Hidden below `lg`. |
| **Status** | `StatusPill` (existing component) | New `Superseded` variant (see §1.4). Always visible. |

#### New "File" column — cell rendering by status + file state

| Row status | Has file? | Cell content | Token |
|---|---|---|---|
| Draft | No | **"Upload" link** (text link, icon `upload-cloud` + label "Upload") | `button-ghost` styling: `{colors.foreground}` text, `{colors.primary}` on hover; `{typography.label}` |
| Draft | Yes | **File icon + filename** (truncated 20ch) + **"Replace" link** (inline, ghost-style) | Icon `{colors.muted-foreground}`; filename `{colors.foreground}`; "Replace" in `{colors.primary}` text |
| Draft | Uploading | **Progress bar** (thin, 4px, `{colors.primary}` fill on `{colors.secondary}` track) + filename + cancel ✕ | Progress bar per DESIGN.md no-shadow rule; cancel = `button-ghost` icon |
| Draft | Error | **File icon + error message** ("File too large (max 5 MB)" / "Type not allowed") in `{colors.destructive}` + "Remove" link | `{colors.destructive}` for message; "Remove" = ghost in `{colors.muted-foreground}` |
| Issued / Approved | Yes | **File icon + filename** + **↓ download icon button** (ghost) | Icon `{colors.muted-foreground}`; download affordance `{colors.primary}` on hover |
| Issued / Approved | No | — em-dash in `{colors.muted-foreground}` | N/A |
| Rejected | Yes | File icon + filename + ↓ download — **read-only** (OD-DOC-2: file mutable in Draft ONLY; rework = reopen to Draft via the existing "Revise" action, then replace) | Same as Issued |
| Rejected | No | — em-dash in `{colors.muted-foreground}` (upload affordance returns once reopened to Draft) | N/A |
| Closed | Yes | File icon + filename + ↓ download (read-only, no replace) | Same as Issued |
| Superseded | Yes | File icon + filename + ↓ download (read-only, terminal) | Same as Issued |

### 1.2 File cell interaction patterns

**Upload (Draft, no file):** Clicking "Upload" opens the browser file picker (invisible `<input type="file">` triggered by the link's `onClick`). The `accept` attribute is set to the OD-DOC-5 allowlist: `.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.dwg,.dxf,.csv,.txt`.

**Replace (Draft, has file):** Same file-picker trigger. Replaces the existing file.

**Progress (uploading):** A 4px-thin horizontal progress bar replaces the filename row. Percentage shown in `{typography.label}`, `{colors.muted-foreground}`. A small ✕ cancel button (ghost icon, 20px) appears right-aligned.

**Error (upload failed):** The error message replaces the filename. Displayed in `{colors.destructive}`, `{typography.label}`. A "Remove" ghost link clears the error state and returns to the no-file state.

**Download (Issued/Approved/Closed/Superseded, has file):** A ghost icon button (`↓`, 20px) triggers download. On hover: `{colors.primary}` icon tint + tooltip "Download file" (`{typography.label}`).

**Preview:** Download button has an adjacent eye-icon ghost button (`👁`, 20px). On click, opens the file in a new browser tab (`target="_blank"`) for PDF/images; for other types, triggers download directly. Tooltip "Preview file". Only shown when file type is previewable (pdf, png, jpg, webp). No in-app viewer needed for MVP.

### 1.3 "New revision" button — Issued/Approved rows (OD-DOC-3)

Per OD-DOC-3, this is a **first-class visible button**, NOT inside the overflow `⋯` menu. It appears as the last column-like action area on Issued and Approved rows:

- **Position:** A right-aligned `button-outline` (not primary — it's a secondary action on the row; the row's primary identity is the document data). Token: `{components.button-outline}`.
- **Label:** "New revision", preceded by a `git-branch` icon (15px).
- **Visibility:** Shown only on rows with status `Issued` or `Approved`.
- **Desktop:** Visible inline in the row (right side). On hover, no change (it's always visible, not hover-revealed like the `⋯` menu).
- **Action:** Opens the **New Revision Modal** (§1.5).
- **Token:** `button-outline` — `{colors.background}` fill, `{colors.input}` border, `{colors.foreground}` text; hover → `{colors.accent}` wash.

### 1.4 Superseded status pill + revision lineage

**Status pill:** A new `StatusVariant = 'superseded'` is needed. It follows the DESIGN.md Tinted-Status Rule:
- **Dot:** `{colors.muted-foreground}` (a neutral grey — Superseded is not a warning, error, or success; it's a terminal informational state).
- **Pill bg:** `{colors.secondary}` (same as `draft`/`neutral`).
- **Pill text:** `{colors.muted-foreground}` (clears AA on secondary bg per DESIGN.md).
- **Label:** "Superseded".

This is effectively the same visual treatment as `neutral`/`draft` (grey pill, grey dot). The *meaning* is carried by the word "Superseded", not by a unique hue — consistent with the system's refusal to invent per-status colors (The One Blue Rule, Tinted-Status Rule).

**Revision lineage in the row:** When a document has a `superseded_by` link (new column from the revision feature), the Document cell shows a subtle lineage indicator:
- Below the title/revision, a single line: `→ Rev B` in `{typography.label}`, `{colors.muted-foreground}` — linking to the newer revision (clicking scrolls to / highlights that row in the table, or opens the drawer).
- On the *newer* revision row (the successor), below the title/revision: `← Rev A` in `{typography.label}`, `{colors.muted-foreground}` — linking to the parent.

This is a minimal inline link, not a full lineage tree — two levels of adjacency (parent ↔ child) are sufficient for the register's scannable list format.

**Drawer (existing `DocumentDrawer`):** The drawer gains a new field:
```
Revision lineage
  ← Rev A (Superseded)   [link to open that row's drawer]
```
When the current document is a successor, it shows the parent. When the current document is superseded, it shows the child. Both are links (styled as `{colors.primary}` text links).

### 1.5 New Revision Modal

Opened by the "New revision" button (§1.3). Uses the existing `EntityFormModal` pattern.

**Layout:**
```
┌─────────────────────────────────────────────┐
│  New revision                          [✕]  │
│  Create the next revision of this document  │
├─────────────────────────────────────────────┤
│                                             │
│  Title                                      │
│  ┌────────────────────────────────────────┐ │
│  │ Foundation general arrangement         │ │
│  └────────────────────────────────────────┘ │
│  (copied from parent — editable)            │
│                                             │
│  Code          Category                     │
│  ┌──────────┐  ┌──────────────────────┐    │
│  │ DWG-001  │  │ Drawing           ▼  │    │
│  └──────────┘  └──────────────────────┘    │
│  (copied)       (copied)                    │
│                                             │
│  Revision                                   │
│  ┌──────────┐                               │
│  │ B        │  (auto-bumped from parent's   │
│  └──────────┘   "A"; editable)              │
│                                             │
│  Document date                              │
│  ┌──────────┐                               │
│  │          │                               │
│  └──────────┘                               │
│                                             │
├─────────────────────────────────────────────┤
│                    [Cancel] [Create revision]│
└─────────────────────────────────────────────┘
```

**Fields:**
- **Title** — pre-filled from parent, editable. `{components.input}`.
- **Code** — pre-filled from parent, editable. `{typography.mono}`. `{components.input}`.
- **Category** — pre-filled from parent, editable (same `SelectField` as current form). `{components.input}`.
- **Revision** — **auto-bumped**: if parent is "A", defaults to "B"; if "3", defaults to "4". Algorithm: try incrementing the last character if it's a letter (A→B) or digit (3→4); otherwise leave blank for manual entry. Editable. `{components.input}`.
- **Document date** — blank (the new revision is a Draft; the author sets the date). `{components.input}`, `type="date"`.

**Footer buttons:**
- **Cancel** — `button-outline`.
- **Create revision** — `button-primary`. Disabled until Title is non-empty (same validation as current Add form).

**Notes:**
- File is NOT carried over — the new Draft revision starts without a file (upload happens after creation, on the Draft row in the register).
- The modal subtitle reads: "Create the next revision of this document. The file can be uploaded once the revision is created."
- On creation, the new row appears in the table filtered/sorted to show it (newest Draft at top).

### 1.6 Tab subtitle update

Current subtitle:
> "Drawings, specifications, and transmittals for this project. Metadata is tracked here; file attachments arrive with Storage."

Updated to:
> "Drawings, specifications, and transmittals for this project. Upload files on Draft rows."

This removes the Storage-deferral signpost (Storage is now enabled) and replaces it with the actual affordance location.

---

## 2. States to Mock

The mockup must show **all** of the following states. Use a single `index.html` with labeled sections (each section is a `<section>` with an overline heading). Optionally split the upload/error/progress states into a separate `states.html`.

### 2.1 Register — default (mixed statuses)

A DataTable with 6 rows demonstrating every visual variant:

| # | Title | Code | Rev | File? | Category | Status | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Foundation general arrangement | DWG-001 | A | ✅ foundation-ga-rev-a.pdf | Drawing | **Approved** | Download + preview; "New revision" button visible |
| 2 | Foundation general arrangement | DWG-001 | B | — | Drawing | **Draft** | No file; "Upload" link visible |
| 3 | Foundation general arrangement | DWG-001 | B | ✅ foundation-ga-rev-b.pdf | Drawing | **Draft** | Has file; "Replace" link; revision lineage "← Rev A" |
| 4 | Structural calculation report | RPT-003 | A | ✅ structural-calc-rev-a.pdf | Report | **Superseded** | Grey pill; download; lineage "→ Rev B" |
| 5 | Structural calculation report | RPT-003 | B | ✅ structural-calc-rev-b.pdf | Report | **Issued** | Download + preview; "New revision" button visible |
| 6 | HSE plan | — | A | — | Other | **Rejected** | No file; NO upload affordance (em-dash) — reopen to Draft to upload (OD-DOC-2) |

### 2.2 Register — empty

The existing `ListState variant="empty"` with icon `doc`, title "No documents yet", sub "Add a drawing, specification, or transmittal to start the project's document register.", and "Add document" CTA.

### 2.3 Draft row — uploading (progress)

A single Draft row showing:
- Filename: `large-drawing-v2.dwg`
- Progress bar at ~60%, `{colors.primary}` fill on `{colors.secondary}` track, 4px height.
- Percentage text: "60%" in `{typography.label}`, `{colors.muted-foreground}`.
- Cancel ✕ button (ghost icon, 20px, `{colors.muted-foreground}`).

### 2.4 Draft row — upload error (too large)

A single Draft row showing:
- Error message: "File exceeds 5 MB limit" in `{colors.destructive}`, `{typography.label}`.
- "Remove" ghost link in `{colors.muted-foreground}`.

### 2.5 Draft row — upload error (disallowed type)

A single Draft row showing:
- Error message: "File type not allowed (.zip)" in `{colors.destructive}`, `{typography.label}`.
- "Remove" ghost link in `{colors.muted-foreground}`.

### 2.6 Issued/Approved row — file immutable, "New revision" visible

Row #1 (Approved, has file): download ↓ and preview 👁 icon buttons. "New revision" `button-outline` visible. No upload/replace affordance. File row is read-only.

### 2.7 Superseded row — status pill + lineage

Row #4 (Superseded): grey neutral pill with "Superseded" label. Download ↓ available. Lineage link "→ Rev B" in `{colors.muted-foreground}`. No "New revision" button (Superseded is terminal — can't create a revision from it; you create revisions from the *current* active revision).

### 2.8 New Revision Modal

Full modal as specified in §1.5. Show with pre-filled fields from "Foundation general arrangement, Rev A (Approved)":
- Title: "Foundation general arrangement"
- Code: "DWG-001" (mono)
- Category: "Drawing" (dropdown)
- Revision: "B" (auto-bumped)
- Date: blank

### 2.9 Preview/download interaction

No separate state — it's browser-native (new tab for PDFs/images, download for others). Mock just shows the icon buttons with tooltips.

---

## 3. Responsive — ≤768px (Table → Card Reflow)

Per OD-W4-4 and DESIGN.md "Navigation / DataTable reflow", the DataTable **single-renders** a stacked card list below `md` (768px). The mockup must show the card version of the mixed-status register (§2.1).

### 3.1 Card anatomy (per document row)

```
┌───────────────────────────────────────────┐
│ Foundation general arrangement             │  ← title, {typography.body}, 600
│ Rev B                                      │  ← {typography.label}, {colors.muted-foreground}
│                                            │
│ ┌─ ●Draft ──────────────────── Upload ──┐ │  ← StatusPill + File affordance (same row)
│ └────────────────────────────────────────┘ │
│                                            │
│ Code: DWG-001    Category: Drawing         │  ← <dl> grid, 2-col
│ Date: —           File: —                  │
│                                            │
│ ← Rev A                                    │  ← lineage (if present)
│                          [⋯]               │  ← row menu (hidden until tap on mobile)
└───────────────────────────────────────────┘
```

**Card structure:**
1. **Title block** — document title (font-semibold, `{colors.foreground}`) + revision mark below (`{typography.label}`, `{colors.muted-foreground}`).
2. **Status + file row** — `StatusPill` left-aligned; file affordance right-aligned:
   - Draft, no file → "Upload" ghost link (`{colors.primary}` text)
   - Draft, has file → filename (truncated) + "Replace" link
   - Draft, uploading → progress bar (full card width below this row)
   - Draft, error → error message + "Remove" link
   - Issued/Approved, has file → ↓ download + 👁 preview icon buttons
   - Superseded → ↓ download icon
3. **Metadata grid** — 2-column `<dl>`: Code / Category / Date / File name. Hidden when the card is compact (code and date are secondary). `{typography.overline}` labels, `{typography.body}` values.
4. **Lineage** — if present: "← Rev A" or "→ Rev B" in `{typography.label}`, `{colors.muted-foreground}`.
5. **"New revision" button** — on Issued/Approved cards, a full-width `button-outline` at the card bottom. Token: `{components.button-outline}`.
6. **Row menu** — `⋯` button (tap-revealed, 44px touch target per `.touch-target`).

**Touch targets:** All interactive elements in the card (Upload, Replace, Download, Preview, New revision, ⋯ menu) extend to ≥44px via `.touch-target` utility.

**Progress bar in card:** Full-width below the status+file row. 4px height. `{colors.primary}` fill on `{colors.secondary}` track. Percentage right-aligned.

**Error state in card:** Error message spans full width below the status+file row. `{colors.destructive}` text. "Remove" link inline.

---

## 4. WCAG-AA Accessibility Notes

### 4.1 File column — per-row affordances

| Element | Role | aria | Focus | Contrast |
|---|---|---|---|---|
| "Upload" link | `button` | `aria-label="Upload file for {title}"` | Global `:focus-visible` ring (`{colors.ring}`, 2px, 2px offset) | `{colors.foreground}` on `{colors.card}` = AAA |
| "Replace" link | `button` | `aria-label="Replace file for {title}"` | Same ring | `{colors.primary}` on `{colors.card}` = ≥4.5:1 |
| Progress bar | `progressbar` | `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-label="Upload progress for {title}"` | Not focusable (status only) | Track: `{colors.secondary}` on `{colors.card}` = AA; fill: `{colors.primary}` |
| Cancel upload ✕ | `button` | `aria-label="Cancel upload for {title}"` | Same ring | `{colors.muted-foreground}` on `{colors.card}` = AA (per DESIGN.md darkening to 40% L) |
| Error message | `alert` | `role="alert"` (announced by SR on appearance) | N/A | `{colors.destructive}` on `{colors.card}` = ≥4.5:1 |
| "Remove" link (error) | `button` | `aria-label="Remove failed upload for {title}"` | Same ring | `{colors.muted-foreground}` on `{colors.card}` = AA |
| Download ↓ icon | `button` | `aria-label="Download file for {title}"` | Same ring | Icon `{colors.muted-foreground}` on `{colors.card}` = AA |
| Preview 👁 icon | `button` | `aria-label="Preview file for {title}"` | Same ring | Same as download |

### 4.2 "New revision" button

| Element | Role | aria | Focus | Contrast |
|---|---|---|---|---|
| "New revision" button | `button` | `aria-label="Create new revision of {title}"` | Global `:focus-visible` ring | `button-outline` tokens: `{colors.foreground}` on `{colors.card}` = AAA |

### 4.3 New Revision Modal

- Standard `EntityFormModal` a11y: focus trap, `Esc` to close, `aria-modal="true"`, `aria-labelledby` pointing to modal title.
- Auto-focused to the Title field on open.
- Required fields: `aria-required="true"` on Title and Category.
- Error summary: `role="alert"` on the error summary container; individual field errors linked via `aria-describedby`.

### 4.4 Revision lineage links

| Element | Role | aria | Focus | Contrast |
|---|---|---|---|---|
| Lineage link ("→ Rev B") | `link` | `aria-label="View revision B of {title}"` | Same ring | `{colors.muted-foreground}` on `{colors.card}` = AA |

### 4.5 Superseded status pill

Follows the existing `StatusPill` a11y: `<span>` with `aria-label="Status: Superseded"` (or the pill text is sufficient if SR reads the visible text). The 6px dot is `aria-hidden="true"`.

### 4.6 Focus order (desktop table)

1. Toolbar controls (count, search)
2. First row activation cell → "Upload" / "Replace" / "Download" in File column → "New revision" (if present) → `⋯` menu
3. Down through rows sequentially
4. Tab past the table reaches modals/drawers when open

### 4.7 Focus order (mobile cards)

1. Toolbar (count, search)
2. Per card: title (activation) → StatusPill (non-interactive) → file affordance → "New revision" button → `⋯` menu
3. Down through cards

---

## 5. DESIGN.md Token Reference

Every visual choice below names its token. No raw hex, no raw px.

### Colors

| Element | Token |
|---|---|
| Row background (default) | `{colors.card}` |
| Row hover | `{colors.accent}` at 60% opacity |
| Primary action text (Upload, Replace links) | `{colors.primary}` |
| Primary action hover bg | `{colors.accent}` |
| File icon (default) | `{colors.muted-foreground}` |
| File icon hover (download/preview) | `{colors.primary}` |
| Error text | `{colors.destructive}` |
| Error remove link | `{colors.muted-foreground}` |
| Progress bar fill | `{colors.primary}` |
| Progress bar track | `{colors.secondary}` |
| Progress percentage text | `{colors.muted-foreground}` |
| Status pill bg (Superseded) | `{colors.secondary}` |
| Status pill text (Superseded) | `{colors.muted-foreground}` |
| Status pill dot (Superseded) | `{colors.muted-foreground}` |
| Lineage link text | `{colors.muted-foreground}`, hover → `{colors.primary}` |
| Modal overlay scrim | `hsl(240 6% 10% / 0.4)` (per overlay shadow vocabulary) |
| "New revision" button bg | `{components.button-outline}` → `{colors.background}` |
| "New revision" button border | `{colors.input}` |
| "New revision" button text | `{colors.foreground}` |
| "New revision" button hover bg | `{colors.accent}` |
| Divider (table row) | `{colors.border}` at 70% opacity |
| Cancel upload icon | `{colors.muted-foreground}` |

### Typography

| Element | Token |
|---|---|
| Document title (cell) | `{typography.body}`, font-weight 600 |
| Revision mark | `{typography.label}` |
| File link text (Upload/Replace) | `{typography.label}`, font-weight 500 |
| Filename | `{typography.body}` |
| Progress % | `{typography.label}`, `tabular` |
| Error message | `{typography.label}` |
| Lineage link | `{typography.label}` |
| Code | `{typography.mono}` |
| Modal title | `{typography.heading}` |
| Modal subtitle | `{typography.body}`, `{colors.muted-foreground}` |
| Modal field labels | `{typography.label}` |
| Card metadata labels | `{typography.overline}` |
| Card metadata values | `{typography.body}` |

### Spacing & Layout

| Element | Token |
|---|---|
| Cell padding | `{components.table-body-cell}` → padding 12px |
| Card padding | `{components.card}` → padding 16px |
| Card gap between rows | `{spacing.3}` (12px) |
| Button height | `{components.button-outline}` → height 32px |
| Button padding | `{components.button-outline}` → padding 0 12px |
| Small icon button (download/preview) | 20px (compact), touch target ≥44px on mobile |
| Progress bar height | 4px |
| Modal field grid gap | `{spacing.4}` (16px) |
| Tab inner padding | Per project-detail tab conventions |

### Border & Radius

| Element | Token |
|---|---|
| Card border | 1px `{colors.border}` |
| Card radius | `{components.card}` → `{rounded.md}` (8px) |
| Button radius | `{components.button-outline}` → `{rounded.md}` |
| Progress bar radius | `{rounded.xs}` (4px) |
| Modal radius | `{rounded.lg}` (10px) |
| Status pill radius | `{rounded.full}` (999px) |
| Input field radius | `{components.input}` → `{rounded.md}` |

### Elevation

| Element | Token |
|---|---|
| Card at rest | No shadow — border only (Flat-By-Default Rule) |
| Card hover | State lift: `0 2px 10px hsl(240 6% 10% / 0.06)` |
| Modal | Overlay shadow: `0 10px 30px hsl(240 10% 8% / 0.16), 0 2px 6px hsl(240 10% 8% / 0.08)` |
| Tooltip (download/preview hover) | `0 8px 24px hsl(240 10% 4% / 0.4)` (dark surface) |

---

## 6. Mockup File Inventory

| File | Contents |
|---|---|
| `docs/design-mockups/document-file-upload/index.html` | Full static mockup: (A) mixed-status register table (desktop ≥768px), (B) mixed-status card list (mobile <768px), (C) empty state, (D) uploading progress row, (E) error rows (too large + disallowed type), (F) "New revision" modal, (G) download/preview tooltip states. Each section is a labeled `<section>`. Uses the standard `:root` HSL token block + component CSS classes copied verbatim from existing mockups. No build step. |
| `docs/design-mockups/document-file-upload/states.html` *(optional)* | If `index.html` becomes unwieldy, split the upload-progress and error states here. |

### HTML conventions (consistent with existing mockups)

- `:root` HSL token block copied verbatim from `crud-companies.html` (shadcn-vue HSL Token System A).
- No new hex values, no new fonts, no new border colors, no new radii.
- `tabular` class for all numbers.
- `font-mono` class for code/ID cells.
- Inter + JetBrains Mono loaded via Google Fonts `<link>`.
- Responsive sections use CSS `@media (min-width: 768px)` to show/hide the table vs card variants.
- All aria attributes as specified in §4.

---

## 7. Open Questions / Proposed Additions (for owner sign-off)

1. **`Superseded` status variant for `StatusPill`:** The existing `StatusVariant` type has no `superseded` entry. The design-plan proposes reusing the `neutral` visual treatment (grey dot + grey pill) with the label "Superseded". This needs to be added to the `StatusPill` component at build time. No new token needed — the `neutral`/`draft` visual (bg: `{colors.secondary}`, text: `{colors.muted-foreground}`, dot: `{colors.muted-foreground}`) is sufficient per the One Blue Rule (status meaning is in the word, not a new hue).

2. **File column visibility on `sm` breakpoint:** The File column is hidden below `md` (768px) in the table view, and file affordances move into the card's status row in the mobile card view. This matches the existing responsive pattern (Category hidden below `md`, Date hidden below `lg`). Confirmed consistent.

3. **"New revision" from Rejected rows:** OD-DOC-3 specifies "Issued/Approved" rows. The author may need to create a new revision after rejection (rework path). The current workflow has Rejected → Draft (re-open) as the rework path, so a new revision can be created from the re-opened Draft later. **No "New revision" button on Rejected rows** — the user reopens to Draft first, which is the natural rework flow.

4. **"New revision" from Superseded rows:** Superseded is terminal. You cannot create a revision from a Superseded document — you create from the *current active* revision (which superseded this one). **No "New revision" button on Superseded rows.** The lineage link (→ Rev B) guides the user to the active revision.

5. **File column header label:** "File" is concise and matches the register's density. Alternative: "Attachment" (longer, less scannable). Staying with "File" unless owner prefers otherwise.

---

DESIGN-PLAN-DONE
