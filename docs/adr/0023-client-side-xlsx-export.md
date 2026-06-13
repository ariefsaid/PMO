# ADR-0023 — Client-side `.xlsx` export of the current list view

Status: Accepted (2026-06-14)
Companion plan: `docs/plans/2026-06-13-bulk-export.md`

## Context

Users on the master-data / pipeline list views (Projects, Procurement, Companies,
Incidents, Sales Pipeline) want the **currently-visible view** — their filtered + sorted
rows, the visible columns — as an Excel file. The Sales Pipeline page also shipped a
dishonest disabled "Export — arrives with Reports" stub that needed to become a real,
honest affordance.

The app is React 19 / Vite / TypeScript with Supabase + RLS. The list pages already fetch
their rows into client memory (RLS-scoped at fetch time). The export should re-serialize
those in-memory rows — **no backend, no new query, no new RLS, therefore no new data
path** — and trigger a browser download. This is a cross-cutting / dependency decision
(adds a client-bundle library and a shared seam touching the `DataTable` primitive), so an
ADR is warranted.

## Decision

1. **Library: `exceljs` (`^4.4.0`, MIT).** It ships proper ESM/CJS on npm (no self-host
   caveat), generates real OOXML `.xlsx` with typed number/date cells. SheetJS community
   was rejected: the maintained builds are self-hosted CDN-only and the npm `xlsx` package
   is stale — an awkward supply-chain story for a security reviewer.

2. **Shared seam, minimal per-page diff.**
   - An optional `Column<Row>.exportValue?: (row) => string | number | boolean` on the
     `DataTable` primitive (purely additive — `Column` consumers compile unchanged).
   - `src/lib/export/`: `cellType` (classify number / ISO-date / text),
     `buildExportRows` (rows + columns → header/body, never a React node),
     `exportFilename` (`<Entity>_<YYYY-MM-DD>.xlsx`, injectable date), and
     `toWorkbookBuffer` (typed worksheet → `ArrayBuffer`).
   - `src/components/export/`: a `useExport()` hook (builds → buffer → Blob →
     `<a download>` → revoke) and a reusable `<ExportButton rows columns entity />`.
   - Pages opt in by adding `exportValue` to the columns that should export and dropping
     `<ExportButton>` into their existing `<Toolbar>` — a 1–3-line diff each.

3. **Lazy-loaded.** `toWorkbookBuffer` `import()`s exceljs dynamically so the writer is
   excluded from each list route's initial chunk — it is only fetched on the first export.

4. **Typed cells.** Numbers get a numeric `numFmt`; ISO `YYYY-MM-DD` strings become real
   Excel date cells with a date `numFmt`; everything else stays text. The header row is
   bold. No other styling (kept deliberately lean).

## Considered alternatives

- **SheetJS (`xlsx`) community edition** — rejected: npm distribution is stale; current
  builds are self-host/CDN-only (supply-chain friction).
- **`write-excel-file` (MIT, lighter tree, browser ESM)** — the recorded fallback if
  exceljs is ever rejected; only `toWorkbookBuffer`'s `import` + writer call would change,
  the seam (`Column.exportValue` / `useExport` / `<ExportButton>`) is library-agnostic.

## Consequences

- **Bundle weight:** exceljs pulls a moderately deep transitive tree and ships to the
  browser. Mitigated by lazy `import()` (not in any initial route chunk) — acceptable for
  an opt-in action. Pinned via `package.json` caret + committed lockfile; no postinstall
  script introduced.
- **Security (no new data path):** the export serializes only rows already present in
  client memory (RLS-scoped at fetch). No endpoint, no query, no `org_id` handling. No
  network, no eval, no DOM injection — `writeBuffer()` → Blob → `<a download>`. Read-only.
  RLS remains the enforcement authority; this feature adds no new surface to audit.
- **Generic seam:** any future `Column<Row>` list can adopt export by adding `exportValue`
  + one toolbar line, without re-inventing the writer.
- **Real serialization is proven, not mocked:** `toWorkbookBuffer.test.ts` exercises the
  actual exceljs path unmocked and asserts the produced buffer is a valid ZIP container
  (`PK` magic) — so the one module that touches exceljs has real coverage.
