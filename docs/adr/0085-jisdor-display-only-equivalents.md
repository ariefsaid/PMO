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

1. Add `fx_rates` in migration **0291**, keyed uniquely by organization, source, currency pair and publication date. Store a finite positive `numeric(18,6)` rate, server-owned creation/update witnesses, and audit actual changes through the existing audit-event mechanism. Restrict v1 to JISDOR USD/IDR; no delete surface.
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
- The initial implementation allows one historical request per distinct invoice date; React Query coalesces repeated dates and all outstanding cells share the latest-day key. The proposed 2026-10-19 addendum below replaces this transport budget with bounded batching in response to the explicit #1012 follow-on planning brief. It does not claim measured client volume or change the selector's rule.
- The broad 1,000–100,000 plausibility band catches thousandfold separator errors; legitimate outside-band publications need a reviewed change. Six-place precision and 5 MiB/500-row input bounds are explicit engineering choices.
- Rollback file `supabase/migrations/rollback/0291_fx_rates_jisdor_down.sql` removes only the new reference table/functions; reference history must be backed up before deliberate reversal. Existing audit events and document values remain.

## Alternatives rejected

- Replace original money or convert aggregates: violates the display-only ruling and obscures exact inputs.
- Fetch rates automatically: outside the owner-approved scope.
- Download all rate history into every page and select in TypeScript: duplicates the date rule and scales by history × readers.
- Use the descriptor wizard's per-row create loop: cannot provide atomic date-keyed corrections or trustworthy unchanged counts.
- Add SheetJS/another decoder speculatively: prohibited and unnecessary without real-format evidence.

## Proposed addendum — bounded read batches (2026-10-19)

Context: the follow-on #1012 brief explicitly prefers one batched read over per-row requests. At the inspected source revision, `pmo-portal/src/hooks/useFxRates.ts:22-32` uses one scalar lookup per distinct org/pair/day; `pmo-portal/src/hooks/useFxRates.test.tsx:80-92` asserts two calls for two dates. The existing selector is declared at `supabase/migrations/0291_fx_rates_jisdor.sql:76-85`. This is a transport optimization for existing display consumers, not a new accounting model or a claim about production traffic.

Decision proposed for Director approval:

- Add STABLE SECURITY INVOKER `fx_rates_on(base text, quote text, on_dates date[])` as a bounded wrapper around `fx_rate_on`. Return one requested-date row per distinct cutoff, with paired nullable rate/publication-date fields. Accept no org/actor input; retain existing table/RLS authority. Reject null/non-finite dates and more than 64 supplied elements; empty input returns no rows.
- Retain the scalar API. Extend the typed DAL/repository with `onDates`; validate complete, unique response coverage before resolving queries. Do not fetch the complete reference history or reimplement predecessor selection in TypeScript.
- Coalesce pending `useFxRate` query functions per QueryClient/org, group pair/dates and flush on a zero-delay timer. Cap each RPC at 64 distinct dates and serialize chunks. React Query retains per-org/pair/day cache identity, freshness and write invalidation; the coalescer stores no results. A cancelled subscriber does not cancel a live sibling's shared read.
- Keep the existing component props, page surface set, approximation/source/date labels, locale conventions and missing/error states. A later prerequisite resolution or retry may cause a later batch; the budget applies to one queued working set, not an entire route lifetime.
- Use an additive function migration and a down migration that removes only this wrapper. Roll back the client before removing the new function. Preserve existing rates, original document values, audit history, scalar selector and management rights.

Consequences: fewer client round trips, still up to 64 indexed predecessor probes per batch; deterministic scheduler/cancellation tests and a response decoder are required. No dependency, new rate table, posting/revaluation logic or broader surface conversion is introduced. Explicit maximum-age policy and rollout expansion remain optional owner questions with defaults in `docs/specs/rupiah-equivalents-batched.spec.md`; neither changes the locked display-only/date rules.

Implementation and canonical test ownership: `docs/plans/2026-10-19-rupiah-equivalents-batched.md`. This addendum is a proposal, not evidence that code, migration or deployment has occurred.

## Verification

pgTAP proves role/tenancy/grant/stamp/atomic-write/lookup behavior, including a deliberately broken write-policy mutation that must fail. Unit tests own parser precision/locale/calendar logic, cache sharing, all states and actual page compositions. The existing composed Administration axe gate covers FX. A real BI golden file and one isolated real-session upload→contract/invoice journey prove compatibility and stack wiring. Portfolio Discover findings graduate before acceptance.
