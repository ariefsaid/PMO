# Plan — Bulk Import wizard (xlsx) — v1

Date: 2026-06-14
Branch: `dev`
Entity (v1): `companies` (flat: `name` + `type` enum)
Companion ADR: `docs/adr/0027-bulk-import-descriptor-and-write-path.md`
Mode: lean build-ready (grill/mockup skipped per Director). Read-only on source; this plan writes
only under `docs/`. The implementer builds from here.

---

## 1. Context & reuse

A multi-step wizard that imports `.xlsx` rows into an entity via the entity's **existing create
repository**, so RLS stamps `org_id` and enforces the write role exactly as the New-company form
does. This is a **write path** — security focus is on §6.

Mirror the shipped **export** slice (ADR-0024):
- Pure utils in `src/lib/export/` (`cellType`, `buildExportRows`, `toWorkbookBuffer` — lazy
  `exceljs`). We add a sibling **`src/lib/import/`** with the same posture: pure + unit-tested
  parse/validate/descriptor, the single exceljs touch lazy-loaded and ZIP-real-tested.
- Toolbar opt-in: `<ExportButton rows columns entity="Companies" />` already sits in the Companies
  `<Toolbar>` (`pages/Companies.tsx:265`). We add `<ImportButton descriptor={companyImportDescriptor} />`
  next to it (same slot pattern).
- Create reuse: `repositories.company.create(input)` (`src/lib/repositories/index.ts:167`) →
  `createCompany` (`src/lib/db/companies.ts:74`). `org_id` is NEVER threaded; RLS `companies_write`
  WITH CHECK is the authority (`42501` on a non-writer).
- Role gating: `usePermission()` → `may('create','company')` (`src/auth/usePermission.tsx`), exactly
  as the New-company CTA at `pages/Companies.tsx:210`.

### Entity-extensible: the `ImportDescriptor` pattern
The wizard is generic over an **`ImportDescriptor<Input>`** — display name, the `field` schema
(target field key, header label, required, a pure `parse`/`validate`), and the async `create` fn.
v1 ships **only** `companyImportDescriptor`; Projects/Tasks descriptors are fast-follows (listed as
future entries in the descriptor module, NOT built). See ADR-0027.

### Director-locked decisions baked in
- **Insert-only v1.** No update-existing (follow-up).
- **Partial-failure = per-row best-effort** (see §3, justified) with a post-import **result report**.
- **Cap ≤ 500 data rows.** Over the cap → the wizard refuses at parse with a clear message; no writes.
- **Dry-run NEVER writes.** The commit is one explicit button on step 4.

---

## 2. Wizard state machine & component breakdown

`ImportWizard` is a **modal** (reuse `EntityFormModal`'s dialog shell is wrong here — it is a form;
use the lower-level `Drawer`/dialog? No). Decision: render a dedicated **`<Modal>`-style dialog**
via the existing `ConfirmDialog`/`EntityFormModal` family is form-shaped; the wizard needs a wide
multi-step body, so use a **routed-free modal built on the `Drawer` primitive's overlay is too
narrow**. → Use a plain centered dialog: reuse `EntityFormModal`'s container is acceptable (it is the
app's standard focus-trapped dialog) BUT the wizard supplies its own footer per step. Implementer:
render the wizard inside `EntityFormModal` with `submitLabel`/footer overridden per step, OR a thin
local `WizardDialog` wrapper if `EntityFormModal`'s single-submit contract fights the multi-step
footer. Pick whichever keeps focus-trap + ESC + DESIGN tokens; document the choice in the test.

### States (a finite state machine — `useImportWizard` hook holds it)
```
type WizardStep = 'upload' | 'mapping' | 'preview' | 'committing' | 'result';
```
| Step | UI | Transitions |
|---|---|---|
| `upload` | drop-zone / file input (accept `.xlsx`), size hint "≤ 500 rows" | file chosen → parse → `mapping`; parse error (not xlsx / empty / > cap) → inline error, stay |
| `mapping` | auto-mapped column→field table; each field a `<SelectField>` of sheet headers (manual remap); unmapped-required → blocked Next | Next → run `validateRows` → `preview`; Back → `upload` |
| `preview` | dry-run table: every data row with per-cell value + per-row error chips; summary "X valid, Y invalid (skipped), N total"; **NO writes** | Confirm import → `committing`; Back → `mapping` |
| `committing` | progress ("Importing 12 / 40…"), per-row best-effort | all rows attempted → `result` |
| `result` | summary: "N created, M failed" + a per-failed-row reason list; Done closes; **Close triggers list refetch** | Done → close + `useCompanies` invalidate |

The hook exposes: `step`, `file`, `parsed` (`{headers, rows}`), `mapping` (field→headerIndex),
`validation` (`RowValidation[]`), `result` (`ImportResult`), and actions `selectFile`,
`setMapping`, `goPreview`, `commit`, `back`, `reset`.

### Component tree
```
ImportButton                       src/components/import/ImportButton.tsx
  └─ ImportWizard (dialog)         src/components/import/ImportWizard.tsx
       ├─ UploadStep               (inline in ImportWizard)
       ├─ MappingStep              (inline)
       ├─ PreviewStep              (inline)
       └─ ResultStep               (inline)
  useImportWizard (state machine)  src/components/import/useImportWizard.ts
```
Steps may be split into sub-files if `ImportWizard.tsx` exceeds ~250 lines; keep one dialog shell.

---

## 3. Partial-failure decision (JUSTIFIED)

**Decision: per-row best-effort, NOT an all-or-nothing transaction.** Rationale:
1. The create path is the existing single-row `repositories.company.create` (one PostgREST insert
   per row). There is no batch RPC and we are adding none in v1 (no new migration — Director lock).
   A true cross-row transaction would require a new security-definer RPC + migration + pgTAP — out
   of v1 scope.
2. Best-effort matches the user's mental model for a 500-row paste: "import what's good, tell me what
   failed, let me fix the rest" beats "one typo lost all 500".
3. Safety is preserved because invalid rows are **caught client-side at validate** and **excluded
   from the commit set** — only rows that passed validation are sent. A row can still fail at the DB
   (e.g. `23505` duplicate name, `42501` if RLS rejects) → captured per-row in `ImportResult.failed`
   with its reason (via `classifyMutationError`), nothing rolls back, the rest proceed.

`commit` iterates the valid rows **sequentially** (not `Promise.all` — keep it gentle and the
progress honest), `try/catch` each, accumulating `{ created: CompanyRow[]; failed: {row, reason}[] }`.

Cap enforcement: `parseWorkbook` throws a typed `ImportParseError('too_many_rows')` when data rows
> 500, so no oversized set ever reaches validate/commit.

---

## 4. `src/lib/import/` — pure utils (unit-tested)

### 4.1 `types.ts`
```ts
export type FieldParse<T> = (raw: string) => T;                 // string cell → typed value
export type FieldValidate = (raw: string) => string | null;     // null = ok; else error message

export interface ImportField<Input> {
  key: keyof Input & string;     // target field
  label: string;                 // expected header label (auto-map by case/space-insensitive match)
  required: boolean;
  validate: FieldValidate;       // required, type, enum-membership, etc.
}

export interface ImportDescriptor<Input> {
  entity: string;                // display + sheet-name match ("Companies")
  fields: ImportField<Input>[];
  toInput: (cells: Record<string, string>) => Input;   // mapped cells → create Input
  create: (input: Input) => Promise<unknown>;          // the entity's create repository fn
}

export interface ParsedSheet { headers: string[]; rows: string[][]; }
export type Mapping = Record<string, number | null>;  // field.key → header column index (null = unmapped)

export interface RowValidation { index: number; errors: Partial<Record<string, string>>; valid: boolean; }
export interface ImportResult { created: number; failed: { index: number; reason: string }[]; }
```

### 4.2 `parseWorkbook.ts` (the ONLY exceljs touch — lazy `import()`, mirrors `toWorkbookBuffer`)
- `async function parseWorkbook(buf: ArrayBuffer): Promise<ParsedSheet>`.
- Lazy `const ExcelJS = (await import('exceljs')).default;` → `wb.xlsx.load(buf)` → first worksheet.
- Row 1 = headers (trimmed strings). Rows 2..N = data; each cell `String(cell.text ?? '').trim()`.
- Throws `ImportParseError` with code `'not_xlsx'` (load fails), `'empty'` (0 data rows), or
  `'too_many_rows'` (> 500 data rows). `ImportParseError extends Error` with a `code` field.

### 4.3 `autoMap.ts` (pure)
`autoMap(headers: string[], fields: ImportField<any>[]): Mapping` — case/whitespace-insensitive match
of each field.label to a header index; unmatched → `null`. Pure, synchronous.

### 4.4 `validateRows.ts` (pure)
`validateRows(rows, fields, mapping): RowValidation[]` — for each row, for each field: read the mapped
cell (`''` if unmapped), run `field.validate`; collect errors; `valid = no errors`. Pure, synchronous,
the dry-run oracle.

### 4.5 `companyDescriptor.ts` (the v1 descriptor)
```ts
import { repositories } from '@/src/lib/repositories';
import type { CompanyInput, CompanyType } from '@/src/lib/db/companies';

const COMPANY_TYPES: CompanyType[] = ['Internal', 'Client', 'Vendor'];

export const companyImportDescriptor: ImportDescriptor<CompanyInput> = {
  entity: 'Companies',
  fields: [
    { key: 'name', label: 'Company name', required: true,
      validate: (raw) => (raw.trim() ? null : 'Company name is required.') },
    { key: 'type', label: 'Type', required: true,
      validate: (raw) => (COMPANY_TYPES.includes(raw.trim() as CompanyType)
        ? null : `Type must be one of: ${COMPANY_TYPES.join(', ')}.`) },
  ],
  toInput: (c) => ({ name: c.name.trim(), type: c.type.trim() as CompanyType }),
  create: (input) => repositories.company.create(input),   // org_id stamped by RLS — never threaded
};
// Future (NOT built in v1): projectImportDescriptor, taskImportDescriptor.
```

### 4.6 `index.ts`
Barrel: re-export types, `parseWorkbook`, `autoMap`, `validateRows`, `companyImportDescriptor`,
`ImportParseError`.

---

## 5. EARS requirements

- **FR-IMP-001** When the user opens the import wizard and selects a valid `.xlsx`, the system shall
  parse the first worksheet into headers + data rows.
- **FR-IMP-002** When a selected file is not a valid `.xlsx`, has zero data rows, or exceeds 500 data
  rows, the system shall reject it with a specific message and perform no writes.
- **FR-IMP-003** When a sheet is parsed, the system shall auto-map columns to the descriptor's target
  fields by case/whitespace-insensitive header match, and allow manual remap.
- **FR-IMP-004** While the wizard is on the preview step, the system shall validate every data row
  (required, type, enum membership) and display per-row errors and a valid/invalid/total summary
  without writing any row.
- **FR-IMP-005** When the user confirms the import, the system shall create one record per **valid**
  row via the entity's existing create repository (per-row best-effort), continuing past per-row
  failures, then show a result of created vs failed counts with per-failed-row reasons.
- **FR-IMP-006** Where the current real role lacks `create` on the entity, the system shall not render
  the Import affordance.
- **NFR-IMP-001** The system shall never send `org_id` from the client on import; RLS stamps and
  enforces it (a non-writer's row insert returns `42501`).
- **NFR-IMP-002** The exceljs parser shall be lazy-loaded (`import()`), excluded from the Companies
  route's initial chunk.
- **NFR-IMP-003** The dry-run/preview shall perform zero network writes; only the confirm action writes.

## 6. Security (write-path — for the security reviewer)

- **No new RLS / migration / RPC.** Each row goes through `repositories.company.create` →
  `createCompany`, the same insert the New-company form uses. The `companies_write` WITH CHECK
  (`org_id = auth_org_id()` AND role ∈ write-roles) is the sole authority.
- **No cross-org import possible:** the client never sets `org_id`; the column default + WITH CHECK
  bind every inserted row to the caller's org. A crafted xlsx cannot carry an `org_id` — descriptor
  `toInput` only emits `{name, type}`.
- **Non-writer cannot import even if the UI is bypassed:** `can('create','company')` hides the button
  (FR-IMP-006), and if a non-writer reaches `create()` anyway, RLS rejects with `42501` per row,
  captured in `ImportResult.failed` — no row is written. This is the AC-IMP-007 pgTAP proof.
- Parse is read-only over an in-memory ArrayBuffer (no eval, no DOM injection) — same posture as the
  export writer (ADR-0024 consequences).

---

## 7. Tasks (TDD; 2–5 min each; exact paths + verify)

> Run all commands from `pmo-portal/`. Vitest: `npm test -- <file>`. Typecheck: `npm run typecheck`.

### T1 — types (no test; consumed by later tests)
Create `src/lib/import/types.ts` with the §4.1 types + `ImportParseError`
(`export class ImportParseError extends Error { constructor(public code: 'not_xlsx'|'empty'|'too_many_rows', msg: string){ super(msg);} }`).
Verify: `npm run typecheck` → 0 errors.

### T2 — autoMap (AC-IMP-003) — RED then GREEN
Write `src/lib/import/__tests__/autoMap.test.ts`: `it('AC-IMP-003: maps "company name"/"TYPE" headers to name/type fields case+space-insensitively; unknown header → null', …)`.
Verify RED: `npm test -- autoMap` fails (no module). Then create `src/lib/import/autoMap.ts`.
Verify GREEN: `npm test -- autoMap`.

### T3 — validateRows valid path (AC-IMP-004a) — RED→GREEN
`src/lib/import/__tests__/validateRows.test.ts`: `it('AC-IMP-004a: a row with name + a valid Type enum is valid (no errors)', …)` using `companyImportDescriptor.fields`.
Verify RED → create `src/lib/import/validateRows.ts` → GREEN: `npm test -- validateRows`.

### T4 — validateRows error path (AC-IMP-004b) — RED→GREEN
Add to the same test: `it('AC-IMP-004b: blank name → "required"; Type "Partner" not in enum → enum error; flags row invalid', …)`.
Verify: `npm test -- validateRows`.

### T5 — companyDescriptor (AC-IMP-008) — RED→GREEN
`src/lib/import/__tests__/companyDescriptor.test.ts`: `it('AC-IMP-008: descriptor.toInput emits only {name,type} (no org_id) and trims; create delegates to repositories.company.create', …)` — mock `@/src/lib/repositories`, assert `create({name,type})` called and the arg has no `org_id` key.
Verify RED → create `src/lib/import/companyDescriptor.ts` → GREEN: `npm test -- companyDescriptor`.

### T6 — parseWorkbook real xlsx (AC-IMP-001) — RED→GREEN
`src/lib/import/__tests__/parseWorkbook.test.ts`: build a real workbook buffer with `toWorkbookBuffer`
(reuse `@/src/lib/export`) for headers `['Company name','Type']` + 2 data rows; `it('AC-IMP-001: parseWorkbook returns the headers + data rows from a real xlsx buffer', …)`. Unmocked exceljs (mirrors `toWorkbookBuffer.test.ts`).
Verify RED → create `src/lib/import/parseWorkbook.ts` → GREEN: `npm test -- parseWorkbook`.

### T7 — parseWorkbook guards (AC-IMP-002) — add tests, GREEN
Add to T6 file: `it('AC-IMP-002a: a non-xlsx ArrayBuffer throws ImportParseError("not_xlsx")', …)`,
`it('AC-IMP-002b: a header-only sheet throws ImportParseError("empty")', …)`,
`it('AC-IMP-002c: 501 data rows throws ImportParseError("too_many_rows")', …)`.
Implement the guards in `parseWorkbook.ts`. Verify: `npm test -- parseWorkbook`.

### T8 — index barrel (no test)
Create `src/lib/import/index.ts` re-exporting all of §4.6. Verify: `npm run typecheck`.

### T9 — useImportWizard state machine (AC-IMP-005a) — RED→GREEN
`src/components/import/__tests__/useImportWizard.test.tsx` (renderHook): `it('AC-IMP-005a: commit creates one record per VALID row via descriptor.create, skips invalid rows, and reports created/failed counts', …)` — descriptor with a stub `create` that resolves for valid + rejects (AppError code 23505) for one row; assert `result.created`/`result.failed` and that the invalid (validation-failed) row is never passed to `create`.
Verify RED → create `src/components/import/useImportWizard.ts` → GREEN: `npm test -- useImportWizard`.

### T10 — useImportWizard best-effort continuation (AC-IMP-005b) — add test
Add: `it('AC-IMP-005b: a per-row create rejection does not abort the run — later valid rows still create', …)`.
Verify: `npm test -- useImportWizard`.

### T11 — ImportWizard dialog render + steps (AC-IMP-009) — RED→GREEN
`src/components/import/__tests__/ImportWizard.test.tsx` (RTL): `it('AC-IMP-009: wizard renders the upload step with an xlsx file input and a "≤ 500 rows" hint, focus-trapped', …)`.
Verify RED → create `src/components/import/ImportWizard.tsx` (UploadStep/MappingStep/PreviewStep/ResultStep inline) → GREEN: `npm test -- ImportWizard`. Use DESIGN.md tokens only (32px controls, `text-muted-foreground`, `border-border`, `bg-card`; mirror `EntityFormModal` shell).

### T12 — PreviewStep no-write summary (AC-IMP-004c) — add test
Add to T11 file: `it('AC-IMP-004c: the preview shows "1 valid, 1 invalid, 2 total" and a per-row error chip, and renders no confirm-write side effect (descriptor.create not called on reaching preview)', …)`.
Verify: `npm test -- ImportWizard`.

### T13 — ImportButton gating (AC-IMP-006) — RED→GREEN
`src/components/import/__tests__/ImportButton.test.tsx`: `it('AC-IMP-006: ImportButton renders for a create-permitted role and renders nothing for a non-writer', …)` — mock `usePermission`.
Verify RED → create `src/components/import/ImportButton.tsx` (calls `usePermission()` → `may('create', descriptor.entityKey)`; renders `<Button variant="outline"><Icon name="import"/>Import</Button>` opening the wizard) → GREEN: `npm test -- ImportButton`.
Note: `ImportButton` takes `descriptor` + an `entity: Entity` prop (the policy key `'company'`); descriptor.entity is the display label. Keep these distinct.

### T14 — components barrel (no test)
Create `src/components/import/index.ts` exporting `ImportButton`. Verify: `npm run typecheck`.

### T15 — Companies toolbar wiring (AC-IMP-010) — source edit (IMPLEMENTER, not planner)
Edit `pages/Companies.tsx`: import `{ ImportButton }` from `@/src/components/import`; add
`<ImportButton entity="company" descriptor={companyImportDescriptor} />` immediately after the
`<ExportButton …/>` at line ~265 (same `<Toolbar>`). Import `companyImportDescriptor` from
`@/src/lib/import`. On wizard close after a successful import, call `refetch()` (already in scope
from `useCompanies`). Verify: `npm run typecheck` && `npm run build`.

### T16 — e2e journey (AC-IMP-011) — IMPLEMENTER
`e2e/AC-IMP-011-bulk-import-journey.spec.ts`: `test('AC-IMP-011: admin uploads a 2-row xlsx → maps → previews valid/invalid → confirms → both valid rows appear in the Companies list', …)`. Generate the xlsx in-test (write a fixture via exceljs or a committed `e2e/fixtures/companies-import.xlsx`), `setInputFiles`, walk Upload→Mapping→Preview→Confirm, assert the new rows via the `companyRow` locator pattern from `AC-CO-001-companies-crud.spec.ts`.
Verify: `npx playwright test AC-IMP-011` (from `pmo-portal/`).

### T17 — RLS write-path proof (AC-IMP-007) — IMPLEMENTER (pgTAP)
The import write path is the existing `companies` insert — covered by the existing
`companies_write` pgTAP. **Do NOT add a new migration.** Add (or extend the existing companies
pgTAP) a test asserting a non-write-role insert into `companies` is rejected `42501`, tagged
`AC-IMP-007` in the description, proving import-as-non-writer cannot persist. If an equivalent
assertion already exists, reference it in the traceability table instead of duplicating.
Verify: `supabase test db` (repo root).

### T18 — ADR-0027
Create `docs/adr/0027-bulk-import-descriptor-and-write-path.md` (context: extensible import; decision:
ImportDescriptor pattern + reuse-create + per-row best-effort + no-new-RLS; consequences: Projects/Tasks
are descriptor-only follow-ups, security = export-grade no-new-data-path on read, RLS-authority on write).
Verify: file exists.

---

## 8. ADR-0010 traceability

| AC | Statement (GWT abbrev.) | Owning layer | File |
|---|---|---|---|
| AC-IMP-001 | Given a real xlsx, When parsed, Then headers+rows returned | Unit (Vitest) | `parseWorkbook.test.ts` |
| AC-IMP-002a/b/c | Given bad/empty/oversized file, Then typed reject, no write | Unit | `parseWorkbook.test.ts` |
| AC-IMP-003 | Given headers, When auto-mapped, Then fields matched case/space-insensitive | Unit | `autoMap.test.ts` |
| AC-IMP-004a/b | Given rows, When validated, Then valid/invalid flagged with reasons | Unit | `validateRows.test.ts` |
| AC-IMP-004c | Given preview, Then summary shown and no write occurs | Unit (RTL) | `ImportWizard.test.tsx` |
| AC-IMP-005a/b | Given confirm, When committing, Then one create per valid row, best-effort, reported | Unit (hook) | `useImportWizard.test.tsx` |
| AC-IMP-006 | Given a non-writer role, Then Import affordance hidden | Unit (RTL) | `ImportButton.test.tsx` |
| AC-IMP-007 | Given a non-write-role insert, Then RLS rejects 42501 | Integration (pgTAP) | companies pgTAP |
| AC-IMP-008 | Given the descriptor, Then toInput emits {name,type} only, create delegates | Unit | `companyDescriptor.test.ts` |
| AC-IMP-009 | Given the wizard opens, Then upload step renders (xlsx input + cap hint) | Unit (RTL) | `ImportWizard.test.tsx` |
| AC-IMP-010 | Given the Companies toolbar, Then Import sits beside Export | (covered by AC-IMP-011 e2e) | — |
| AC-IMP-011 | Given an admin + xlsx, When upload→map→preview→confirm, Then valid rows appear | E2E (Playwright) | `AC-IMP-011-bulk-import-journey.spec.ts` |

12 AC ids; 11 with an owning test (AC-IMP-010 folded into the AC-IMP-011 journey).

---

## 9. Files

New:
- `pmo-portal/src/lib/import/types.ts`
- `pmo-portal/src/lib/import/parseWorkbook.ts`
- `pmo-portal/src/lib/import/autoMap.ts`
- `pmo-portal/src/lib/import/validateRows.ts`
- `pmo-portal/src/lib/import/companyDescriptor.ts`
- `pmo-portal/src/lib/import/index.ts`
- `pmo-portal/src/lib/import/__tests__/{parseWorkbook,autoMap,validateRows,companyDescriptor}.test.ts`
- `pmo-portal/src/components/import/ImportButton.tsx`
- `pmo-portal/src/components/import/ImportWizard.tsx`
- `pmo-portal/src/components/import/useImportWizard.ts`
- `pmo-portal/src/components/import/index.ts`
- `pmo-portal/src/components/import/__tests__/{ImportButton,ImportWizard,useImportWizard}.test.tsx`
- `pmo-portal/e2e/AC-IMP-011-bulk-import-journey.spec.ts` (+ optional `e2e/fixtures/companies-import.xlsx`)
- `docs/adr/0027-bulk-import-descriptor-and-write-path.md`

Touched (source — implementer, not planner):
- `pmo-portal/pages/Companies.tsx` (toolbar: add `<ImportButton>` beside `<ExportButton>`; refetch on close)
- possibly `pmo-portal/src/components/ui` icon registry if `import` icon is missing (verify; export uses `export`).

Collision note: shares **only** the `<Toolbar>` slot in `pages/Companies.tsx` with the shipped
export feature — additive, one line beside `<ExportButton>`. Independent of CRM/Gantt/Kanban work.
No shared module is mutated; `src/lib/import/` and `src/components/import/` are net-new namespaces.

---

## 10. Open questions / escalations

None blocking. One implementer note: if the `import` icon is absent from the UI icon registry, reuse
`export` (mirrored) or `upload` — confirm during T13 and pick an existing token (no new SVG in v1).
