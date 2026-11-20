# Plan: unit-rate catalogue (#2520)

Spec: `docs/specs/unit-rate-catalogue.spec.md`. Migration 0955 (range 0955–0959).

## Decision: sit beside, not extend
- `contract_rate_lines` (0515) is a labour-only version chain (`kind in ('labour')`, hour/day units, current-row flag, one rate per line). The catalogue needs many items × variants with a different unit per item. Widening that table would loosen its checks and its Admin/Finance-only meaning.
- `boq_items` (0250) is the priced contract line. Its `rate` stays the one money column; a line copies the catalogue rate when priced (FR-RC-7). That is what keeps old lines unchanged on amendment without any history join, and it leaves progress billing, claims and ERP sends untouched.
- Rates are append-only rows (no `is_current`, no update, no delete) instead of 0515's version chain: an amendment is an insert, so there is nothing to rewrite and no lock-step current flag to corrupt.
- Writes go through definer RPCs (Admin/Finance, advisory lock per project); pricing a line is an invoker RPC so the caller's own `boq_items` RLS, column grants and locks decide.

## Tasks
1. `supabase/migrations/1020_unit_rate_catalogue.sql` + rollback (refuses while a line is priced from the catalogue). Owner: `supabase/tests/rate_catalogue.test.sql` (AC-RC-1..6).
2. `src/lib/db/rateCatalogue.ts`, `repositories/rateCatalogue.ts`, contract (ADR-0017 seam). `rateAt` pure helper.
3. Import: `rateCatalogueDescriptor.ts` (variant columns, stage cell, 5,000-row cap via new optional `maxRows`), wizard failed-rows download (`failedRows.ts`). Owner: `rateCatalogueDescriptor.test.ts` (AC-RC-2,5,7,8). English and Bahasa Indonesia strings.
4. Glossary terms.

## Verify
`npm run check:guards`, `npm run typecheck`, eslint on changed files, `npx vitest related --run <changed>`; pgTAP file via `supabase test db supabase/tests/rate_catalogue.test.sql` (CI).
