# ADR-0027 — Bulk import: the ImportDescriptor pattern + reuse-create write path

Date: 2026-06-14
Status: Accepted
Relates to: ADR-0010 (test pyramid), ADR-0016 (FE authz), ADR-0017 (repository seam),
ADR-0018 (soft-archive), ADR-0019 (server-enforced writes), ADR-0024 (export slice).

## Context

KANNA parity needs a bulk `.xlsx` import. A 500-row paste must import the good rows, report the
bad ones, and — critically — never let a crafted spreadsheet bypass tenancy or the write role.
We already ship an export slice (ADR-0024): pure, unit-tested utils in `src/lib/export/` with the
single `exceljs` touch lazy-loaded. Import is the symmetric write-side feature, and it must be
extensible to Projects/Tasks without a wizard rewrite.

## Decision

**1. A generic `ImportDescriptor<Input>` drives a generic wizard.** The descriptor declares the
entity display name, a `fields` schema (target key, header label, required, a pure `validate`), a
pure `toInput(cells)` → the create `Input`, and `create(input)` = the entity's existing create
repository fn. The `ImportWizard` is generic over the descriptor; v1 ships **only**
`companyImportDescriptor`. Projects/Tasks are **descriptor-only fast-follows** — a new descriptor
reuses the wizard unchanged.

**2. Reuse the entity's existing create repository — NO new RLS / migration / RPC.** Each row goes
through `repositories.company.create` → `createCompany`, the same single insert the New-company form
uses. The `companies_write` WITH CHECK (`org_id = auth_org_id()` AND role ∈ write-roles) is the sole
write authority. `org_id` is NEVER threaded from the client; `toInput` emits only `{name, type}`, so
a crafted xlsx cannot carry a tenancy key.

**3. Per-row best-effort commit (NOT an all-or-nothing transaction).** There is no batch RPC and v1
adds none. Invalid rows are caught client-side at validate and **excluded from the commit set**; the
wizard then iterates the valid rows **sequentially**, `try/catch` each, accumulating created vs
failed (a per-row `23505`/`42501` is captured via `classifyMutationError`, nothing rolls back). This
matches the user's mental model ("import what's good, tell me what failed") and keeps progress honest.

**4. FSM with a dry-run preview that performs ZERO writes.** `upload → mapping → preview →
committing → result`. The preview is a pure client-side validation oracle; the only write trigger is
one explicit "Import N" button on the preview step. The exceljs parser is lazy-loaded (`import()`),
excluded from the Companies route's initial chunk.

**5. Role-gated affordance, RLS as authority.** `<ImportButton>` renders only when the **real** role
may `create` the entity (`usePermission` → `can('create', entity)`, ADR-0016). This is UX clarity;
RLS remains the enforcement authority — a non-writer reaching `create()` is rejected `42501` per row
(proven by the AC-IMP-007 pgTAP on the existing `companies_write` policy).

## Consequences

- **Security = export-grade on read, RLS-authority on write.** Parse is read-only over an in-memory
  ArrayBuffer (no eval, no DOM injection). The write path adds no new data path — it is the audited
  Companies insert — so the only authority is the existing `companies_write` WITH CHECK. A non-writer
  cannot persist even if the FE is bypassed; cross-org import is impossible (no client `org_id`).
- **Extensible at low cost.** Projects/Tasks import = a new `ImportDescriptor` + a toolbar
  `<ImportButton>`; no wizard, RLS, or migration changes.
- **Insert-only v1.** No update-existing (a follow-up; would need a match key + an upsert path).
- **Cap ≤ 500 rows.** `parseWorkbook` throws `ImportParseError('too_many_rows')` so no oversized set
  ever reaches validate/commit.

## Files

`src/lib/import/{types,parseWorkbook,autoMap,validateRows,companyDescriptor,index}.ts` (pure utils,
lazy exceljs) · `src/components/import/{ImportButton,ImportWizard,useImportWizard,index}.ts(x)` ·
`pages/Companies.tsx` toolbar wiring (one `<ImportButton>` beside `<ExportButton>`).
