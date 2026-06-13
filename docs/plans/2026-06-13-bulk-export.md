# Plan — Bulk Export: current DataTable view → .xlsx

Date: 2026-06-13 · Feature: `bulk-export` · Branch target: `dev` (KANNA-parity)
Author: eng-planner · Status: build-ready (no grill/mockup — lean parity feature)

> Read-only on source while planning. This plan is the build contract: exact paths,
> real code, exact verify commands, 2–5-min tasks, ADR-0010 traceability.

---

## 1. Problem & locked decisions

Users on the master-data / pipeline lists want the **currently-visible view** (their
filtered + sorted `rows`, the visible `Column[]`) as an Excel file. Locked by Director:

- **Client-side only.** Re-serialize the rows the page already fetched into `.xlsx` and
  trigger a browser download. **No backend, no new RLS, no new query** — therefore **no
  new data exposure**: the export can never contain a row RLS didn't already return to
  this client (see NFR-2; security review confirms read-only).
- **Library: `exceljs`** (MIT, active). See §2 supply-chain note. SheetJS community is
  rejected (npm-distribution caveat — `xlsx` on npm is stale; current builds are
  self-hosted CDN-only, an awkward supply-chain story for a security reviewer).
- **Shared seam, minimal per-page diff.** Add an optional `exportValue?` to
  `Column<Row>` + a reusable `useExport` hook and `<ExportButton>`. Pages opt in by
  rendering `<ExportButton>` in their existing `<Toolbar>` — a 1–3-line diff each.
  Deliberately avoids `pages/Projects.tsx` view-mode internals (Calendar stream) and the
  Wave-0 S4 `ViewToggle` work (collision assessment §8).
- **Scope v1 pages:** Projects, Procurement, Companies, Incidents. Plus: replace the
  dishonest disabled "Export — arrives with Reports" stub in `pages/SalesPipeline.tsx`
  with the live button. Util stays generic (any `Column<Row>` list can adopt it later).
- **Formatting:** export each column's display value via `exportValue` (NOT the React
  `cell` node); numbers as numbers (tabular), dates as ISO `YYYY-MM-DD`, status as its
  label string. Filename `<Entity>_<YYYY-MM-DD>.xlsx`.

---

## 2. Library selection + supply-chain note (for security-auditor)

**Chosen: `exceljs` `^4.4.0`** — MIT, ~50k weekly downloads class, ships proper ESM/CJS
on npm (no self-host caveat), generates real `.xlsx` (OOXML) with number/date cell types.

Supply-chain notes for the security review:
- Transitive deps (`archiver`/`fast-csv`/`unzipper` family) pull a moderately deep tree;
  it is a **client-bundle dependency** (ships to the browser) so it adds bundle weight —
  acceptable for an opt-in action, lazy-loaded (§4, dynamic `import()`), so it is **not in
  the initial route chunk**.
- No network, no eval, no DOM-injection in our usage — we call `workbook.xlsx.writeBuffer()`
  and hand the Blob to an `<a download>`. Read-only re-serialization of in-memory rows.
- Pin via `package.json` caret + committed lockfile; reviewer should confirm the resolved
  version in the lockfile and that no postinstall script is introduced.

**Fallback if exceljs is rejected at review:** `write-excel-file` (MIT, lighter tree,
browser ESM, typed) — same `useExport` seam, only Task 6's `import` + writer call change.
Recorded as the ADR's considered alternative.

---

## 3. Requirements (EARS) + Acceptance Criteria (GWT)

### Functional (FR)

- **FR-1** (event-driven) *When* the user activates the Export action on a list view, the
  system *shall* generate an `.xlsx` file containing one row per currently-visible
  (filtered + sorted) data row and one column per visible `Column` that defines an
  `exportValue`, and trigger a browser download.
- **FR-2** (ubiquitous) The system *shall* serialize each cell using the column's
  `exportValue(row)` when defined, falling back to an empty string when a column has no
  `exportValue` — never the React `cell` node.
- **FR-3** (ubiquitous) The system *shall* type cells by their JS value: `number` → Excel
  number cell, ISO date string `YYYY-MM-DD` → date-formatted cell, everything else → text.
- **FR-4** (ubiquitous) The system *shall* name the file `<Entity>_<YYYY-MM-DD>.xlsx`
  using the caller-supplied entity label and today's local date.
- **FR-5** (state-driven) *While* the visible list is empty, the system *shall* disable the
  Export action (nothing to export).
- **FR-6** (event-driven) *When* the SalesPipeline page renders, the system *shall* present
  a live, enabled Export action (replacing the disabled "arrives with Reports" stub).

### Non-functional (NFR)

- **NFR-1** (a11y) The Export control *shall* be a real `<button>` with an accessible name
  "Export", keyboard-operable, DESIGN.md-token styled (`Button variant="outline"`,
  `Icon name="export"`), and convey disabled state via the native `disabled` attribute.
- **NFR-2** (security) The export *shall* introduce no new data path: it serializes only
  rows already present in client memory (RLS-scoped at fetch). No new endpoint, query, or
  `org_id` handling. Read-only.
- **NFR-3** (perf) The `exceljs` writer *shall* be lazy-loaded via dynamic `import()` so it
  is excluded from each list route's initial chunk.

### Acceptance Criteria (Given/When/Then) — owning layer per ADR-0010

| AC | Statement (GWT) | Owning layer | Owning file |
|----|-----------------|--------------|-------------|
| **AC-EXP-001** | Given visible rows + columns with `exportValue`, When `buildExportRows(rows, columns)` runs, Then it returns a header row of column labels + one array per row of `exportValue` results in column order. | Unit (Vitest) | `src/lib/export/buildExportRows.test.ts` |
| **AC-EXP-002** | Given a column with no `exportValue`, When `buildExportRows` runs, Then that column's cell is `''` (never a React node). | Unit | same |
| **AC-EXP-003** | Given a row value that is a `number`, an ISO `YYYY-MM-DD` string, and a label string, When `cellType(value)` classifies them, Then it returns `'number'`, `'date'`, `'text'` respectively. | Unit | `src/lib/export/cellType.test.ts` |
| **AC-EXP-004** | Given an entity label "Projects" and a fixed date, When `exportFilename('Projects', date)` runs, Then it returns `Projects_2026-06-13.xlsx`. | Unit | `src/lib/export/exportFilename.test.ts` |
| **AC-EXP-005** | Given rows + columns + filename, When `toWorkbookBuffer(...)` runs, Then it resolves to a non-empty `ArrayBuffer` whose bytes begin with the ZIP magic `PK` (a valid `.xlsx` container). | Unit | `src/lib/export/toWorkbookBuffer.test.ts` |
| **AC-EXP-006** | Given a non-empty list, When the user clicks Export, Then `useExport().exportXlsx` is invoked with the page's filtered rows, columns, and entity filename, and a download is triggered (anchor click). | Unit (RTL, mocked util) | `src/components/export/ExportButton.test.tsx` |
| **AC-EXP-007** | Given an empty visible list, When the toolbar renders, Then the Export button is `disabled`. | Unit (RTL) | `src/components/export/ExportButton.test.tsx` |
| **AC-EXP-008** | Given the SalesPipeline page, When it renders, Then a live (not disabled) Export button is present and the "arrives with Reports" disabled stub is gone. | Unit (RTL) | `pages/__tests__/SalesPipeline.export.test.tsx` (update) |

> No e2e: there is no real cross-stack flow (no DB/RLS round-trip); the download journey
> is fully covered at unit/component layer. ADR-0010 forbids pushing an AC up a layer for
> convention's sake. A jsdom Blob/anchor assertion in AC-EXP-006 is the right ceiling.

---

## 4. Architecture & shared seam

```
Column<Row>  ── add ─►  exportValue?: (row: Row) => string | number | boolean
   (src/components/ui/DataTable.tsx)

src/lib/export/
  cellType.ts          cellType(v): 'number' | 'date' | 'text'   (pure)
  buildExportRows.ts   buildExportRows(rows, columns) → { header: string[]; body: (string|number|boolean)[][] }
  exportFilename.ts    exportFilename(entity, date?) → "<Entity>_<YYYY-MM-DD>.xlsx"
  toWorkbookBuffer.ts  async toWorkbookBuffer({header, body, sheetName}) → ArrayBuffer  [lazy import('exceljs')]
  index.ts             barrel

src/components/export/
  useExport.ts         useExport() → { exportXlsx(rows, columns, entity), busy }
                       (builds rows → buffer → Blob → <a download> click → revoke)
  ExportButton.tsx     <ExportButton rows columns entity disabled? /> (Button outline + export icon)
  index.ts             barrel
```

**Data flow on click:** `ExportButton.onClick` → `useExport.exportXlsx(filtered, columns, 'Projects')`
→ `buildExportRows` (uses each `col.exportValue`, header from `col.header` when a string
else `col.key`) → `toWorkbookBuffer` (lazy `import('exceljs')`, sets number/date cell
types via `cellType`) → `new Blob([buf])` → object URL → programmatic `<a download=
exportFilename('Projects')>` click → `URL.revokeObjectURL`.

**Header label rule:** `col.header` is `React.ReactNode`; for export use it only when it is
a `string`, else fall back to `col.key`. (All v1 target columns use string headers.)

**Per-page opt-in (1–3 lines each):** add `exportValue` to the columns that should export,
then drop `<ExportButton rows={filtered} columns={columns} entity="<Entity>" />` into the
existing `<Toolbar>`. No change to view-mode state, `ViewToggle`, board/calendar code.

---

## 5. Tasks (TDD: red → green; each 2–5 min, exact verify)

> All paths absolute-from-repo `pmo-portal/`. Run commands from `pmo-portal/`.
> `@/` resolves to `pmo-portal/` (existing alias). Behavior tasks state the failing test first.

### Task 1 — Add `exceljs` dependency
- Edit `pmo-portal/package.json`: add to `dependencies` (alphabetical, after `@tanstack/react-query`):
  `"exceljs": "^4.4.0",`
- Verify: `npm install && node -e "require('exceljs')" && echo OK`
- (No AC — enabling task.)

### Task 2 — `Column.exportValue` type (seam)
- Edit `pmo-portal/src/components/ui/DataTable.tsx`, in `interface Column<Row>` after the
  `colClassName` field, add:
  ```ts
  /**
   * Optional value used by the .xlsx export seam (src/lib/export). Returns the
   * column's DISPLAY value as a plain scalar — never a React node. Numbers stay
   * numbers (tabular), dates as ISO YYYY-MM-DD, status as its label. Columns
   * without exportValue are omitted from the export.
   */
  exportValue?: (row: Row) => string | number | boolean;
  ```
- `Column` is already re-exported from `src/components/ui/index.ts` (no barrel change).
- Verify: `npm run typecheck`
- (No AC — type seam; consumed by AC-EXP-001/002.)

### Task 3 — `cellType` (RED then GREEN) — AC-EXP-003
- Write failing test `pmo-portal/src/lib/export/cellType.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { cellType } from './cellType';
  describe('cellType', () => {
    it('AC-EXP-003: classifies number, ISO date, and text values', () => {
      expect(cellType(1500)).toBe('number');
      expect(cellType('2026-06-13')).toBe('date');
      expect(cellType('In Progress')).toBe('text');
      expect(cellType('2026-13-99')).toBe('text'); // not a real date → text
      expect(cellType(true)).toBe('text');
    });
  });
  ```
- Then create `pmo-portal/src/lib/export/cellType.ts`:
  ```ts
  export type CellType = 'number' | 'date' | 'text';
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  export function cellType(v: string | number | boolean): CellType {
    if (typeof v === 'number' && Number.isFinite(v)) return 'number';
    if (typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) return 'date';
    return 'text';
  }
  ```
- Verify: `npm test -- src/lib/export/cellType.test.ts`

### Task 4 — `buildExportRows` (RED then GREEN) — AC-EXP-001, AC-EXP-002
- Write failing test `pmo-portal/src/lib/export/buildExportRows.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildExportRows } from './buildExportRows';
  import type { Column } from '@/src/components/ui';
  type R = { name: string; value: number; status: string };
  const cols: Column<R>[] = [
    { key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name },
    { key: 'value', header: 'Value', cell: (r) => r.value, exportValue: (r) => r.value },
    { key: 'icon', header: 'Icon', cell: () => null }, // no exportValue
  ];
  const rows: R[] = [{ name: 'Acme', value: 1500, status: 'open' }];
  describe('buildExportRows', () => {
    it('AC-EXP-001: header = labels, body = exportValue per row in column order', () => {
      const { header, body } = buildExportRows(rows, cols);
      expect(header).toEqual(['Name', 'Value', 'Icon']);
      expect(body).toEqual([['Acme', 1500, '']]);
    });
    it('AC-EXP-002: a column with no exportValue serializes to empty string', () => {
      const { body } = buildExportRows(rows, cols);
      expect(body[0][2]).toBe('');
    });
  });
  ```
- Then create `pmo-portal/src/lib/export/buildExportRows.ts`:
  ```ts
  import type { Column } from '@/src/components/ui';
  export interface ExportTable {
    header: string[];
    body: (string | number | boolean)[][];
  }
  export function buildExportRows<Row>(rows: Row[], columns: Column<Row>[]): ExportTable {
    const header = columns.map((c) => (typeof c.header === 'string' ? c.header : c.key));
    const body = rows.map((row) =>
      columns.map((c) => (c.exportValue ? c.exportValue(row) : '')),
    );
    return { header, body };
  }
  ```
- Verify: `npm test -- src/lib/export/buildExportRows.test.ts`

### Task 5 — `exportFilename` (RED then GREEN) — AC-EXP-004
- Write failing test `pmo-portal/src/lib/export/exportFilename.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { exportFilename } from './exportFilename';
  describe('exportFilename', () => {
    it('AC-EXP-004: builds <Entity>_<YYYY-MM-DD>.xlsx', () => {
      expect(exportFilename('Projects', new Date('2026-06-13T09:00:00'))).toBe('Projects_2026-06-13.xlsx');
    });
  });
  ```
- Then create `pmo-portal/src/lib/export/exportFilename.ts`:
  ```ts
  export function exportFilename(entity: string, date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${entity}_${y}-${m}-${d}.xlsx`;
  }
  ```
- Verify: `npm test -- src/lib/export/exportFilename.test.ts`

### Task 6 — `toWorkbookBuffer` (RED then GREEN) — AC-EXP-005
- Write failing test `pmo-portal/src/lib/export/toWorkbookBuffer.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { toWorkbookBuffer } from './toWorkbookBuffer';
  describe('toWorkbookBuffer', () => {
    it('AC-EXP-005: produces a non-empty xlsx (ZIP "PK" magic) buffer', async () => {
      const buf = await toWorkbookBuffer({
        sheetName: 'Projects',
        header: ['Name', 'Value', 'Date'],
        body: [['Acme', 1500, '2026-06-13']],
      });
      const bytes = new Uint8Array(buf);
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes[0]).toBe(0x50); // 'P'
      expect(bytes[1]).toBe(0x4b); // 'K'
    });
  });
  ```
- Then create `pmo-portal/src/lib/export/toWorkbookBuffer.ts`:
  ```ts
  import { cellType } from './cellType';
  import type { ExportTable } from './buildExportRows';
  export interface WorkbookInput extends ExportTable {
    sheetName: string;
  }
  /** Lazy-loads exceljs (NFR-3) and writes a typed worksheet to an ArrayBuffer. */
  export async function toWorkbookBuffer({ sheetName, header, body }: WorkbookInput): Promise<ArrayBuffer> {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName.slice(0, 31)); // Excel sheet-name max 31 chars
    ws.addRow(header).font = { bold: true };
    for (const r of body) {
      const row = ws.addRow(r);
      r.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        const t = cellType(v);
        if (t === 'number') cell.numFmt = '#,##0.##';
        else if (t === 'date') { cell.value = new Date(v as string); cell.numFmt = 'yyyy-mm-dd'; }
      });
    }
    return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
  }
  ```
- Verify: `npm test -- src/lib/export/toWorkbookBuffer.test.ts`

### Task 7 — export lib barrel
- Create `pmo-portal/src/lib/export/index.ts`:
  ```ts
  export { cellType, type CellType } from './cellType';
  export { buildExportRows, type ExportTable } from './buildExportRows';
  export { exportFilename } from './exportFilename';
  export { toWorkbookBuffer, type WorkbookInput } from './toWorkbookBuffer';
  ```
- Verify: `npm run typecheck`

### Task 8 — `useExport` hook (no new AC — exercised by AC-EXP-006)
- Create `pmo-portal/src/components/export/useExport.ts`:
  ```ts
  import { useCallback, useState } from 'react';
  import type { Column } from '@/src/components/ui';
  import { buildExportRows, exportFilename, toWorkbookBuffer } from '@/src/lib/export';
  export function useExport() {
    const [busy, setBusy] = useState(false);
    const exportXlsx = useCallback(
      async <Row,>(rows: Row[], columns: Column<Row>[], entity: string) => {
        setBusy(true);
        try {
          const { header, body } = buildExportRows(rows, columns);
          const buf = await toWorkbookBuffer({ sheetName: entity, header, body });
          const blob = new Blob([buf], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = exportFilename(entity);
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } finally {
          setBusy(false);
        }
      },
      [],
    );
    return { exportXlsx, busy };
  }
  ```
- Verify: `npm run typecheck`

### Task 9 — `<ExportButton>` (RED then GREEN) — AC-EXP-006, AC-EXP-007
- Write failing test `pmo-portal/src/components/export/ExportButton.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { ExportButton } from './ExportButton';
  import type { Column } from '@/src/components/ui';

  const exportXlsx = vi.fn();
  vi.mock('./useExport', () => ({ useExport: () => ({ exportXlsx, busy: false }) }));

  type R = { name: string };
  const cols: Column<R>[] = [{ key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name }];

  describe('ExportButton', () => {
    it('AC-EXP-006: clicking exports the page rows/columns/entity', async () => {
      render(<ExportButton rows={[{ name: 'Acme' }]} columns={cols} entity="Companies" />);
      await userEvent.click(screen.getByRole('button', { name: /export/i }));
      expect(exportXlsx).toHaveBeenCalledWith([{ name: 'Acme' }], cols, 'Companies');
    });
    it('AC-EXP-007: an empty visible list disables Export', () => {
      render(<ExportButton rows={[]} columns={cols} entity="Companies" />);
      expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
    });
  });
  ```
- Then create `pmo-portal/src/components/export/ExportButton.tsx`:
  ```tsx
  import React from 'react';
  import { Button, Icon, type Column } from '@/src/components/ui';
  import { useExport } from './useExport';

  export interface ExportButtonProps<Row> {
    rows: Row[];
    columns: Column<Row>[];
    /** Entity label used for the sheet name + filename (<Entity>_<date>.xlsx). */
    entity: string;
    disabled?: boolean;
  }
  /** Shared opt-in export affordance — drop into a page <Toolbar>. */
  export function ExportButton<Row>({ rows, columns, entity, disabled }: ExportButtonProps<Row>) {
    const { exportXlsx, busy } = useExport();
    return (
      <Button
        variant="outline"
        disabled={disabled || busy || rows.length === 0}
        onClick={() => void exportXlsx(rows, columns, entity)}
      >
        <Icon name="export" />
        Export
      </Button>
    );
  }
  ```
- Verify: `npm test -- src/components/export/ExportButton.test.tsx`

### Task 10 — export components barrel
- Create `pmo-portal/src/components/export/index.ts`:
  ```ts
  export { ExportButton, type ExportButtonProps } from './ExportButton';
  export { useExport } from './useExport';
  ```
- Verify: `npm run typecheck`

### Task 11 — Companies opt-in — (supports AC-EXP-006 in-page; no new AC)
- Edit `pmo-portal/pages/Companies.tsx`:
  - Add `exportValue` to the two columns (in the `columns` array, ~L131–146):
    - `name` column: `exportValue: (c) => c.name,`
    - `type` column: `exportValue: (c) => c.type,`
  - Import: add `import { ExportButton } from '@/src/components/export';` near the page imports (after L30).
  - In the `<Toolbar standalone>` (after the `<SearchMini>`, ~L261), add:
    `<ExportButton rows={filtered} columns={columns} entity="Companies" />`
- Verify: `npm run typecheck`

### Task 12 — Incidents opt-in
- Edit `pmo-portal/pages/Incidents.tsx`:
  - Add `exportValue` to columns (~L164–200):
    - `type`: `exportValue: (i) => i.type,`
    - `severity`: `exportValue: (i) => i.severity,`
    - `status`: `exportValue: (i) => i.status,`
    - `incident_date`: `exportValue: (i) => i.incident_date,`
    - `location`: `exportValue: (i) => i.location ?? '',`
  - Import `ExportButton` from `@/src/components/export`.
  - In `<Toolbar standalone>` (~L276), add `<ExportButton rows={filtered} columns={columns} entity="Incidents" />`.
- Verify: `npm run typecheck`

### Task 13 — Procurement opt-in
- Edit `pmo-portal/pages/Procurement.tsx`:
  - Add `exportValue` to columns (~L152–213):
    - `request`: `exportValue: (r) => r.title,`
    - `project`: `exportValue: (r) => r.project?.name ?? '',`
    - `requester`: `exportValue: (r) => r.requested_by?.full_name ?? 'Unknown',`
    - `value`: `exportValue: (r) => r.total_value,`
    - `lifecycle`: (no `exportValue` — visual stepper, omit)
    - `status`: `exportValue: (r) => stageLabelForStatus(r.status as ProcurementStatus),`
  - Import `ExportButton`.
  - In `<Toolbar standalone>` (~L247), add `<ExportButton rows={filtered} columns={columns} entity="Procurement" />`.
- Verify: `npm run typecheck`

### Task 14 — Projects opt-in (toolbar only — DO NOT touch view-mode state)
- Edit `pmo-portal/pages/Projects.tsx`:
  - Add `exportValue` to columns (~L206+):
    - `project`: `exportValue: (p) => p.name,`
    - `customer`: `exportValue: (p) => p.client?.name ?? '',`
    - `pm`: `exportValue: (p) => p.pm?.full_name ?? 'Unassigned',`
    - `status`: `exportValue: (p) => p.status as string,`
    - `contract`: `exportValue: (p) => p.contract_value,`
    - `actual`: `exportValue: (p) => p.actual_cost ?? 0,` (confirm field name during build; use the same source the `cell` reads)
  - Import `ExportButton`.
  - In the existing `<Toolbar standalone>` (~L411), add `<ExportButton rows={filtered} columns={columns} entity="Projects" />`.
  - **Do not** modify `ViewToggle`, `view` state, board, or any calendar/view-mode code (collision guard §8).
- Verify: `npm run typecheck`

### Task 15 — SalesPipeline: replace dishonest stub (RED then GREEN) — AC-EXP-008, FR-6
- Update test `pmo-portal/pages/__tests__/SalesPipeline.export.test.tsx`: the three
  existing `AC-W2-IXD-008` cases asserting `disabled` + "arrives with Reports" are now a
  deliberate UX change (honest live affordance). Rewrite to AC-EXP-008:
  ```tsx
  it('AC-EXP-008: SalesPipeline shows a live (enabled) Export, not the "arrives with Reports" stub', () => {
    // render the page (reuse the file's existing harness/providers)
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeEnabled();
    expect(screen.queryByText(/arrives with the reports module/i)).not.toBeInTheDocument();
  });
  ```
  (Also update the sibling assertion in `pages/SalesPipeline.test.tsx` L86–93 which already
  expects a "live Export action" — keep it green; it now resolves to `<ExportButton>`.)
- Edit `pmo-portal/pages/SalesPipeline.tsx` (~L293–307): replace the `<Tooltip>`-wrapped
  disabled stub with `<ExportButton rows={<the filtered pipeline rows>} columns={<the
  pipeline Column[]>} entity="Pipeline" />`. The pipeline page is board-first; during build,
  source the flat visible deal list + define a small `Column[]` (name, stage, value,
  company) with `exportValue` for the export — OR, if no flat list exists, build one from the
  page's deal data. Remove the now-unused `Tooltip` import if it becomes orphaned.
- Verify: `npm test -- pages/__tests__/SalesPipeline.export.test.tsx pages/SalesPipeline.test.tsx`

### Task 16 — Full gate
- Verify: `npm run typecheck && npm run lint:ci && npm test`
- Confirm changed-lines coverage ≥80% (CI gate, #83) on the new `src/lib/export/*` and
  `src/components/export/*` files.

---

## 6. Traceability summary (ADR-0010)

| AC | Layer | File |
|----|-------|------|
| AC-EXP-001 | Unit | `src/lib/export/buildExportRows.test.ts` |
| AC-EXP-002 | Unit | `src/lib/export/buildExportRows.test.ts` |
| AC-EXP-003 | Unit | `src/lib/export/cellType.test.ts` |
| AC-EXP-004 | Unit | `src/lib/export/exportFilename.test.ts` |
| AC-EXP-005 | Unit | `src/lib/export/toWorkbookBuffer.test.ts` |
| AC-EXP-006 | Unit (RTL) | `src/components/export/ExportButton.test.tsx` |
| AC-EXP-007 | Unit (RTL) | `src/components/export/ExportButton.test.tsx` |
| AC-EXP-008 | Unit (RTL) | `pages/__tests__/SalesPipeline.export.test.tsx` |

8 ACs, all unit/component (Vitest/RTL). No pgTAP (no DB/RLS change). No e2e (no
cross-stack flow). Per ADR-0010, the download is fully provable at the unit/component layer.

---

## 7. a11y / UX of the affordance (DESIGN.md)

- `Button variant="outline"` + `<Icon name="export" />` + visible "Export" label — matches
  the demoted SalesPipeline control's visual language (continuity), 32px control height
  (root 16px), DESIGN.md tokens only.
- Disabled→enabled is driven by `rows.length === 0` (FR-5) and `busy` — native `disabled`
  attribute (announced by AT; NFR-1). No custom aria needed; a real `<button>` is keyboard-
  operable by default. The button is NOT wrapped in a focusable `<span>`/tooltip (that
  pattern was only for the *disabled-with-explanation* stub; a live action needs no excuse).

---

## 8. Collision assessment vs Calendar stream / Wave-0 S4 ViewToggle

- **Shared seam touches `DataTable.tsx` (one additive optional field) only** — no behavior
  change, no signature break; `Column` consumers compile unchanged.
- **Projects.tsx:** Task 14 edits ONLY the `columns` array (adds `exportValue`) and adds one
  line inside the existing `<Toolbar>`. It does **not** touch `view` state, `ViewToggle`,
  the board, or any view-mode plumbing — so it does not collide with the Calendar stream
  (which owns Projects view mode) nor the Wave-0 S4 `ViewToggle` changes. If both streams
  land near the same toolbar JSX, the merge conflict (if any) is a trivial adjacent-line add.
- **Procurement.tsx / Companies.tsx / Incidents.tsx:** same pattern — additive column field
  + one toolbar line. No view-mode state touched.
- **Risk:** LOW. The only cross-file primitive edit (`DataTable.tsx`) is purely additive.
  Recommend landing this AFTER the S4 ViewToggle merge if both are in flight, to keep the
  toolbar diff conflict-free.

---

## 9. ADR

Record `docs/adr/00NN-client-side-xlsx-export.md` (next free NNNN at build time): context
(client-side re-serialization of the visible view, no backend), decision (exceljs + shared
`Column.exportValue` seam + `useExport`/`ExportButton`), considered-alternatives (SheetJS
community rejected for npm-distribution caveat; `write-excel-file` as the lighter fallback),
consequences (client bundle weight, mitigated by lazy `import()`; no new data path / no RLS;
generic seam adoptable by any future list). This is a cross-cutting/dependency decision →
ADR warranted.

---

## 10. Open questions for the Director

- **[OWNER-ESCALATION] none blocking.** One build-time confirmation: the Projects `actual`
  column's source field name (Task 14) — use whatever the existing `cell` reads
  (`formatCurrency(...)` argument) so export matches the display; no spec impact.
- SalesPipeline is board-first (Task 15): confirm a flat visible deal list + minimal
  `Column[]` is acceptable for its export (vs. a stage-grouped sheet). Default: flat list,
  columns name/company/stage/value. Non-blocking; falls out of the generic seam.
