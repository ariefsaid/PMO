# ADR-0085 — Org-scoped JISDOR reference history for display-only equivalents

- Status: Proposed implementation architecture; owner product ruling fixed by #1012
- Date: 2026-10-14
- Issue: #1012
- Spec: `docs/specs/fx-rates-jisdor.spec.md`
- Plan: `docs/plans/2026-10-14-fx-rates-jisdor.md`

## Context

Documents already retain their own currency under migration 0187. DD-CUR-6 chose exact per-currency breakdowns over acquiring rate data. The owner now needs an explicitly approximate rupiah view of USD contracts/invoices and has selected manually uploaded BI JISDOR history, document-date fallback and latest-publication open balances. Exact amounts and accounting operations must remain unchanged.

The repository already provides a repository/DAL seam, RLS organization stamping, shared form/confirmation primitives and dynamically loaded ExcelJS parsing. Its generic descriptor importer creates entities one row at a time; reference history needs date-keyed, atomic, idempotent upserts instead.

## Decision

1. Add `fx_rates` in migration **0288**, keyed uniquely by organization, source, currency pair and publication date. Store a finite positive `numeric(18,6)` rate, server-owned creation/update witnesses, and audit actual changes through the existing audit-event mechanism. Restrict v1 to JISDOR USD/IDR; no delete surface.
2. Force RLS: active members read their own organization, Finance/Admin insert/update their own organization. Revoke broad grants before issuing column-level mutation grants. Attach the existing org stamp. The manual correction UI is Admin-only per the owner's specific ruling; Finance can upload corrections. Operator status alone adds no FX authority.
3. Centralize historical selection in STABLE SECURITY INVOKER `fx_rate_on(base,quote,on_date)`, returning the rate **and actual publication date**, with no row for absence. Latest means the same selector with the current organization-local calendar day. Null document date is not latest.
4. Commit normalized, bounded files through SECURITY INVOKER `upsert_fx_rates(jsonb)` so RLS remains the authority and one failed row rolls back the file. Preserve no-op witnesses/audit counts and report actual new/changed/unchanged counts. Neither RPC accepts client organization or audit identity.
5. Add one typed display formatter and one `FxEquivalent` component. Original amounts stay first, with subordinate `≈ Rp … (JISDOR YYYY-MM-DD)` text. No converted value is persisted, exported, aggregated, posted, or used in margin/approval arithmetic. Unknown or unsupported conversions have visible reasons rather than zero.
6. Extend the shared workbook reader without changing existing import outputs. Use existing ExcelJS only; retain lazy loading. Do not add a package or alter a lockfile. An unmodified public BI export is a merge-gating golden fixture; actual legacy-format incompatibility must be escalated rather than disguised.
7. Use indexed date lookup/keyset management pages and org/pair/day React Query keys shared across amount cells; invalidate after rate writes. Finance receives an FX-only Administration doorway, without broader setup access.

## Consequences

- Supersedes DD-CUR-6's absence-of-rates premise **only for labelled display equivalents**; exact per-currency breakdowns remain mandatory. DD-FX-1 text in the spec is prepared for the Director to copy into the decision log.
- Rate corrections can change a later displayed approximation; the publication date/source remain visible and original documents never change. This is not a revaluation ledger or immutable rate snapshot.
- Reference import has a small dedicated preview/commit controller instead of stretching the generic create-per-row wizard or introducing another spreadsheet engine.
- Up to one historical request per distinct invoice date remains a bounded MVP cost; React Query coalesces repeated dates and all outstanding cells share the latest-day key. A future batch API requires observed volume and must reuse the selector's rule, not duplicate it.
- The broad 1,000–100,000 plausibility band catches thousandfold separator errors; legitimate outside-band publications need a reviewed change. Six-place precision and 5 MiB/500-row input bounds are explicit engineering choices.
- Rollback file `supabase/migrations/rollback/0288_fx_rates_jisdor_down.sql` removes only the new reference table/functions; reference history must be backed up before deliberate reversal. Existing audit events and document values remain.

## Alternatives rejected

- Replace original money or convert aggregates: violates the display-only ruling and obscures exact inputs.
- Fetch rates automatically: outside the owner-approved scope.
- Download all rate history into every page and select in TypeScript: duplicates the date rule and scales by history × readers.
- Use the descriptor wizard's per-row create loop: cannot provide atomic date-keyed corrections or trustworthy unchanged counts.
- Add SheetJS/another decoder speculatively: prohibited and unnecessary without real-format evidence.

## Verification

pgTAP proves role/tenancy/grant/stamp/atomic-write/lookup behavior, including a deliberately broken write-policy mutation that must fail. Unit tests own parser precision/locale/calendar logic, cache sharing, all states and actual page compositions. The existing composed Administration axe gate covers FX. A real BI golden file and one isolated real-session upload→contract/invoice journey prove compatibility and stack wiring. Portfolio Discover findings graduate before acceptance.
