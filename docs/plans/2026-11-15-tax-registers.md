# Tax registers implementation plan (#898)

> **For agentic workers:** Orca worker, strict TDD. Planning artifact; build only after spec sign-off.

**Goal:** A read-only Finance screen with VAT, customer-withholding and vendor-withholding registers for one month.
**Architecture:** Three security-definer read functions (role-checked Admin/Finance, org from the caller's profile, keyset
paging, totals computed server-side) → a DAL file → a repository → hooks → one page. Follows ADR-0016/0017.
**Spec:** `docs/specs/tax-registers.spec.md`. **Blocked-by #876 #893: both closed.**

## Migration

One forward migration, **NNNN (number on request)**, plus `supabase/migrations/rollback/NNNN_tax_registers_down.sql`
(drops the three functions). No table change unless owner Q1 is answered "organization setting" (then the same migration adds the per-article rate columns on `organizations`, Admin-only grant, 0811 precedent). Functions:
`tax_register_vat(p_month date, p_cursor jsonb, p_limit int)`, `tax_register_customer_withholding(...)`,
`tax_register_vendor_withholding(...)`; each returns rows plus a totals jsonb; `set search_path = public`,
`revoke all from public, anon`, `grant execute to authenticated`; body first checks the caller's role and active membership
(copy the guard idiom from `0281_vendor_withholding_slips.sql`) and filters `org_id` from the caller's profile.
Expected-rate source per owner Q1.

## Tasks

1. **pgTAP red** — `supabase/tests/tax_registers.test.sql`: AC-TAXREG-002..006, 007..011, 015 (role refusal, cancelled
   exclusion, currency split, awaiting group, expected-rate flag, slip missing, voided slip, tenancy).
   Verify red: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/tax_registers.test.sql'`.
2. **Migration green** — write NNNN and rollback; same command green. Mutation-check: make the role guard `true` and the
   cancelled filter absent; tests must go red.
3. **DAL red/green** — `pmo-portal/src/lib/db/taxRegisters.ts` + `taxRegisters.test.ts` (Vitest): maps rows/totals, keyset
   cursor, decimals kept as strings. `npx vitest run src/lib/db/taxRegisters.test.ts`.
4. **Repository + hooks** — `src/lib/repositories/taxRegisters.ts`, `src/hooks/useTaxRegisters.ts` (+ tests; AC-012).
5. **CSV helper** — `src/lib/taxRegisterCsv.ts` + test (AC-013: formula-injection neutralization, plain decimals).
6. **Page** — `pages/finance/TaxRegistersPage.tsx` with month selector, three tabs/sections, totals, flags, empty/error
   (AC-001, 014, 016); `can()`-gate the nav/route; register route in `pmo-portal/App.tsx` and the Finance hub link; i18n
   keys in both locales (rebase translation files right before the PR, #1070). Page test with RTL. Read
   `docs/ux/screen-rules.md`; DESIGN.md tokens only.
7. **e2e journey** — `pmo-portal/e2e/AC-TAXREG-001-tax-registers.spec.ts` (Finance opens previous month, sees seeded
   registers, exports CSV) via `scripts/e2e-local.sh AC-TAXREG`; follow `docs/e2e-parallel-conventions.md`.
8. **Gates** — `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, touched tests only,
   `scripts/ux-proof.sh` on `/finance/tax-registers`. Update `docs/glossary.md` (tax register, expected withholding) and
   add DD lines to `docs/decisions.md` once the owner answers.

## Traceability (ADR-0010)

| AC | Owning layer | Test |
|---|---|---|
| AC-TAXREG-002, 003, 004, 005, 006, 007, 008, 009, 010, 011, 015 | pgTAP | `supabase/tests/tax_registers.test.sql` |
| AC-TAXREG-012 | Unit | `useTaxRegisters.test.tsx` (cursor + totals) |
| AC-TAXREG-013 | Unit | `taxRegisterCsv.test.ts` |
| AC-TAXREG-014, 016 | Unit | `TaxRegistersPage.test.tsx` |
| AC-TAXREG-001 | E2E | `e2e/AC-TAXREG-001-tax-registers.spec.ts` |

## Owner questions

1. Expected customer withholding rate: take it from a per-article rate on the organization settings (new column on
   `organizations`, Admin-set) — recommended — or a fixed 2% (PPh 23) / 10% (PPh 4(2)) constant?
2. VAT register month: group by e-Faktur date (matches DD-EFK-2) with undated VAT documents in "Awaiting e-Faktur" —
   recommended — or by document date?
3. Ship all three registers as one PR (size S–M) — recommended — or VAT first?
