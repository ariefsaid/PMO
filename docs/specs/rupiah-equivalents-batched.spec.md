# #1012 — Rupiah equivalents: preserve the shipped contract, batch the reads

Date: 2026-10-19 · Status: proposed follow-on specification, not a claim of owner sign-off.
Baseline inspected: `cbacb2a0` on `claude/v024-plan-1012-rupiah`.
Plan: `docs/plans/2026-10-19-rupiah-equivalents-batched.md`.
Architecture: ADR-0085, including its proposed 2026-10-19 addendum.

## 1. Job, authority, and scope

When Finance reviews a USD contract or customer invoice in an IDR organization, they need its indicative rupiah scale beside the original, without mistaking a reference-rate estimate for booked money.

Read #1012 in full through `gh issue view 1012`. Its owner ruling fixes manual BI JISDOR USD/IDR history, originals retained, document-date selection with previous-publication fallback, latest for open balances, and explicit absence. This is **not a second implementation of the rate-management feature**. The original specification remains `docs/specs/fx-rates-jisdor.spec.md:9-11`; its upload, audit and management ACs retain their original owners (`:101-115`).

The incremental change is a bounded batched selector and automatic coalescing behind the existing shared hook/component. This strengthens the original distinct-date request budget, not its financial meaning. A small formatting change applies the existing negative-sign ruling. No new money surface, accounting calculation, upload format, role, provider, or dependency is introduced.

**Proposed defaults (not new owner rulings):** retain the current high-value surface set; do not invent a maximum publication age; keep `≈` as the visible indicative marker rather than relabeling a reference conversion as booked. Optional owner scope/policy questions are isolated in §7; none changes an existing locked date/source rule.

## 2. Evidence ledger — existing behavior at the inspected revision

These are source-tree claims, not claims about a deployed database, live policy catalogue, completed QA, or customer data.

| Ref | Deciding artifact and existing behavior |
|---|---|
| E1 | `docs/decisions.md:2286-2304` (DD-CUR-6) requires exact per-currency breakdowns. `docs/decisions.md:2308-2314` (DD-FX-1) permits only labelled display equivalents, document-date/latest selection, and no accounting conversion. |
| E2 | `docs/decisions.md:2940-2964` (DD-MONEY-1..4) defines Actual/Committed/Margin and unknown/budget behavior; these rulings do **not** choose an FX date. DD-FX-1 and #1012 choose that date. `docs/decisions.md:1547-1557` (DD-FMT-1) puts a negative sign before the money symbol. |
| E3 | `supabase/migrations/0291_fx_rates_jisdor.sql:2-17` defines org/source/pair/day uniqueness, positive bounded six-place rates and indexes. `:21-36` declares forced RLS and grants; `:38-74` stamps/audits rates; `:87-144` defines atomic upload. These are migration declarations, not a live grant/policy inspection. |
| E4 | `supabase/migrations/0291_fx_rates_jisdor.sql:76-85` defines `fx_rate_on`: latest stored JISDOR publication on/before the cutoff, returned with publication date; absence returns no row. This is the only definition found by searching all `supabase/migrations/*.sql` for that function. |
| E5 | `pmo-portal/src/lib/db/fxRates.ts:19-30` implements 50-row keyset pages; `:45-53` calls the scalar selector. `pmo-portal/src/lib/repositories/fxRates.ts:12-25` normalizes DAL errors. `pmo-portal/src/lib/repositories/types.ts:165-176` declares the typed repository seam. |
| E6 | `pmo-portal/src/hooks/useFxRates.ts:6-10,22-32` keys each lookup by org/pair/date, with 30-second freshness. `:35-44` invalidates the org FX root after successful writes. `pmo-portal/src/hooks/useFxRates.test.tsx:80-92` explicitly expects two calls for two distinct dates. Repeated dates share a query, but distinct-date renders still fan out. |
| E7 | `pmo-portal/src/hooks/useFxOrgDay.ts:6-31` gets the organization timezone and refreshes its calendar-day query every minute. `pmo-portal/src/lib/fxEquivalent.ts:4-6` delegates calendar formatting to the shared format seam. `pmo-portal/src/auth/AuthProvider.tsx:68-73` clears query cache when identity changes. |
| E8 | `pmo-portal/src/components/fx/FxEquivalent.tsx:11-39,41-153` resolves eligibility, same-currency omission, dated/latest lookups and distinct pending/error/absence states. `:144-160` uses the shared formatter, compact visual caption and full screen-reader text. |
| E9 | `pmo-portal/src/lib/fxEquivalent.ts:10-20` multiplies only for presentation and emits `≈ Rp … (JISDOR YYYY-MM-DD)`. `pmo-portal/src/lib/format.ts:575-580` rounds the displayed grouped number to zero fraction digits; `:26-37` caches by locale. `pmo-portal/src/lib/locale/activeLocale.ts:90-99` makes number locale independent of UI language. |
| E10 | `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx:216-229` attaches contract-date FX; `pmo-portal/pages/project-detail/tabs/OverviewTab.tsx:104-115` supplies the same amount/date in the relocated financial summary. |
| E11 | `pmo-portal/pages/SalesInvoices.tsx:760-795` attaches invoice-date amount/total-due equivalents and latest outstanding equivalents. `pmo-portal/pages/approvals/SalesInvoiceApprovalRow.tsx:70-101` supplies net/total/outstanding in the reusable preview. `pmo-portal/pages/SalesInvoices.tsx:635-636` opts the routed detail into that preview. `pmo-portal/pages/approvals/SalesInvoiceApprovalRow.tsx:17` defaults `showFx` to false; this is not blanket approval-inbox coverage. |
| E12 | `pmo-portal/App.tsx:174` registers the exchange-rate route; `pmo-portal/pages/Administration.tsx:262-265` mounts its page. `pmo-portal/pages/AdministrationExchangeRates.tsx:48,172-175,220-241` gates upload UI and handles the empty state. Do not rebuild it. |
| E13 | `pmo-portal/e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts:1,18-58,61-146` owns a self-isolated upload/re-import→contract/invoice journey. `docs/qa-portfolio.md:133-140` records the affected routes and explicitly incomplete rendered matrix. An existing test is not evidence that the rendered matrix is finished. |
| E14 | `DESIGN.md:305-309,446-454` requires Inter-tabular money, muted sub-values and readable responsive values. `docs/adr/0010-test-strategy-pyramid.md:33-61` assigns each AC one lowest-sufficient owning layer. |

### Surface decision

**Retain first priority, already wired (E10/E11):**

1. Project-detail Contract tile and the Engineer/Overview financial summary: `contract_value`, `contract_date`.
2. Sales-invoice register Amount and separately displayed Total due: the displayed source amount, `invoice_date`.
3. Routed invoice detail's net and Total due: the displayed source amount, `invoice_date`.
4. Invoice register/detail Outstanding: `erp_outstanding_amount`, latest uploaded publication at/before the organization-local current day. A known zero is a real amount; a null is not.

The duplicated collection-summary outstanding figure (`pmo-portal/pages/SalesInvoices.tsx:579-583`) remains an original-only summary; the detail preview is the existing FX location. No per-line tax/receipt breakdown is added.

**Explicit follow-up inventory, not silently added to this slice:** Projects-list contract values (`pmo-portal/pages/Projects.tsx:578-588`); pipeline estimate/weighted values (`pmo-portal/pages/project-detail/PipelineLens.tsx:210-218`); Work-order values and billing totals (`pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx:192-257,394`); incoming-payment settled/cash/withheld figures (`pmo-portal/pages/IncomingPayments.tsx:354-389`); vendor/procurement ledger amounts (`pmo-portal/pages/procurement/ProcurementLedger.tsx:312`); Finance dashboard aggregates (`pmo-portal/src/components/dashboard/FinanceDashboard.tsx:343-367`); project-finances converted margin (#1008, explicitly excluded by #1012); management-pack and statement conversions (DD-MMP-5 at `docs/decisions.md:3028-3035`, native-statement authority at `:3269-3306`). This is an inventory of inspected surfaces, not a claim to exhaust every money renderer in the repository. Aggregate conversions require their own semantics and owner scope decision.

## 3. Date, display, and absence contract

- **Dated documents:** greatest *stored published date* `<= contract_date` or `<= invoice_date`. A Saturday may use Friday. Never substitute a later rate or use today for a missing document date. Keep the actual publication date, not the requested date, in every successful caption.
- **Open balances:** same selector, cutoff = organization-local today, not viewer-local today or invoice date. “Latest” means latest **uploaded** publication, not a guarantee that BI has published nothing newer.
- **Incomplete history:** PMO cannot infer from a missing uploaded date whether BI did not publish or the file was incomplete. No synthetic weekday/holiday calendar and no guessed interpolation. A prior stored rate may be used only with its actual date visibly attached; there is no silent date replacement. Missing history before the cutoff means unavailable, never zero. A transport failure is retryable error, never “no rate”.
- **Indicative, never booked:** retain `≈ Rp 1.623.456 (JISDOR 2026-10-09)` in an Indonesian-number locale, or `≈ Rp 1,623,456 (JISDOR 2026-10-09)` in an English-number locale. `≈` is the visible approximation label. This caption is not a booked IDR balance, exchange gain/loss, payment conversion, or revaluation. No “booked” label or amount is fabricated.
- **Rounding:** preserve the shipped floating-number display calculation and shared `Intl` whole-number rounding, nearest integer with half ties away from zero. Multiply first, round once for display; never round the rate or source amount first. `1 × 1000.5` displays `1.001` under id-ID; `-1 × 1000.5` displays `≈ -Rp 1.001 …` (DD-FMT-1). Preserve numeric precision in the database and all existing original figures. This does not promise decimal-exact ledger arithmetic at arbitrarily large magnitudes.
- **Bahasa:** message text follows the UI language; number separators follow the independent number-locale preference. Keep `Rp`, `JISDOR` and ISO publication dates in either language. Reuse the existing `fx.*` catalogue reasons, including `fx.noRateForDate`, `fx.missingDate`, `fx.rateError` and Retry. No translation-file edits are required by this design.
- **Eligibility/states:** retain E8's original-first ordering, same-currency omission, USD/IDR-only conversion, distinct unresolved organization/day, pending, missing-date, unsupported-pair, no-match and retryable-error states. Null/non-finite source amounts render no invented equivalent; genuine zero with a valid rate may render `≈ Rp 0`.

## 4. EARS requirements

| ID | Requirement |
|---|---|
| FR-1012-001 | When a supported dated equivalent is requested, the system shall preserve the scalar selector's on-or-before rule and return the actual publication date with the rate, including across weekends and missing uploaded dates. |
| FR-1012-002 | When an open-balance equivalent is requested, the system shall use the latest stored publication at/before organization-local today; while the organization day is unresolved, the system shall not guess a date. |
| FR-1012-003 | When eligible amounts render in the existing Contract and Sales Invoice locations in §2, the system shall retain the source amount/currency/tax basis and place the shared indicative caption alongside it without adding export fields or changing totals. |
| FR-1012-004 | When a lookup has no historical match, a document date is absent, the pair is unsupported, or a request fails, the system shall preserve the distinct visible reason and retry behavior in §3 and shall never replace unknown with zero or a later cached rate. |
| FR-1012-005 | When a valid equivalent is formatted, the system shall round once to whole rupiah through the shared number formatter, retain source/publication date and `≈`, and place a negative sign before `Rp`. |
| FR-1012-006 | While Bahasa or an independent number-locale override is active, the system shall localize status/recovery copy and render numeric separators from the number preference without changing denomination or ISO publication dates. |
| FR-1012-007 | When same-org/pair lookups are queued in one scheduler turn, the system shall read distinct cutoff dates in one bounded server batch, map each result back to its own cutoff and preserve a successful null match separately from an error. |
| FR-1012-008 | When rates are successfully uploaded/corrected, or a failed lookup is retried, the system shall refetch through the same batched seam; cancelled query subscribers shall not receive results or cancel still-active sibling subscribers. |
| NFR-1012-001 | The system shall use the existing repository/DAL/React Query seam and `FxEquivalent`; pages shall not implement their own selector, conversion or request loop. |
| NFR-1012-002 | The batch function shall be STABLE SECURITY INVOKER, accept no organization/actor parameter, reuse `fx_rate_on`, and retain existing organization-scoped read authority. It shall accept at most 64 supplied dates, reject null arrays, null/non-finite date elements and oversize input, and return one row per distinct valid cutoff with paired nullable match fields. |
| NFR-1012-003 | The client shall keep organization/pair/date cache identity and 30-second freshness, omit amount/locale from rate keys, and coalesce without keeping a second result cache. Each HTTP batch shall contain at most 64 dates; larger queued sets shall be chunked with at most one batch in flight per coalescer. Empty/disabled/cancelled-only sets shall issue no request. |
| NFR-1012-004 | The system shall not persist/export/post a converted amount or change Actual, Committed, Margin, tax, approvals, source currency, amount or per-currency aggregation (DD-MONEY-1..4, DD-CUR-6, DD-FX-1). |
| NFR-1012-005 | The implementation shall use an additive reversible function migration, preserve rate-table RLS and `org_id` seams, introduce no dependency/lockfile change, and retain accessible compact/full caption behavior using existing tokens. |

The scheduler boundary is explicit: calls queued before its zero-delay flush share a batch. A later organization-day resolution, render turn, cache miss or retry may produce another batch. This is not a promise of one request for an entire route lifetime. For 20 already-eligible distinct-date cells mounted together, the measurable budget is one **rate** RPC, not 20; organization-context reads are separate and shared.

## 5. Acceptance criteria and canonical ownership

IDs are namespaced to avoid collisions with the original AC-FX suite. Each new ID has one canonical owner; old AC-FX tests continue to own the original maintenance/display contracts.

| ID | Given / When / Then | Owning layer and exact artifact |
|---|---|---|
| AC-1012-001 | **Given** Friday and Monday publications with different rates and a cutoff before history, **when** a batch asks Friday, Saturday, Monday, duplicate Saturday and before-history, **then** it returns one row per distinct requested cutoff, Friday/Friday/Monday publication identities and paired nulls for absence, exactly matching scalar selection; unsupported/inverse pairs remain absent. | pgTAP — `supabase/tests/0331_fx_rates_on.test.sql` |
| AC-1012-002 | **Given** active readers in two isolated synthetic orgs with conflicting rates, inactive/anonymous callers and bounded/invalid inputs, **when** the new function is called, **then** results obey the caller's existing read scope; active readers can read without management rights; no org argument or write is involved; null arrays, null/non-finite elements and >64 inputs are refused, an empty array returns no rows, and the function remains STABLE invoker with authenticated-only execute. | pgTAP — `supabase/tests/0331_fx_rates_on_access.test.sql` |
| AC-1012-003 | **Given** batched matched/unmatched results, transport errors, duplicate/missing result keys and half-null match fields, **when** the DAL/repository decodes them, **then** it accepts exactly one paired result per requested date, preserves publication identity/null and normalized errors, and rejects malformed/incomplete results rather than inventing absence. | unit — `pmo-portal/src/lib/db/__tests__/fxRates.test.ts` |
| AC-1012-004 | **Given** 20 distinct dates plus repeated cells, a 65-date set, different pairs and aborted subscribers, **when** requests enter the scheduler together, **then** 20 dates use one batch, 65 dates use two sequential batches of 64/1, results map by cutoff rather than array position, separate pairs do not mix, and no empty/cancelled-only batch is sent. | unit — `pmo-portal/src/lib/fxRateBatcher.test.ts` |
| AC-1012-005 | **Given** real query hooks and mocked batch repository under independent org/query-client scopes, **when** repeated/distinct dated and latest-day cells mount, amounts/locales change, a request fails/retries or an upload invalidates queries, **then** the shared batch seam is used, org/date keys and 30-second freshness remain, failure is not cached as no-match, successful edits refresh visible captions, and cancelled subscribers do not settle into cache. | unit — `pmo-portal/src/hooks/useFxRates.test.tsx` |
| AC-1012-006 | **Given** positive/negative half-rupiah products, genuine zero and invalid numeric input, **when** the shared formatter runs with explicit en-US/id-ID number locales, **then** output rounds once, has the source/date and approximation marker, negatives precede `Rp`, zero remains real, invalid input refuses a numeric caption and originals are unmodified. | unit — `pmo-portal/src/lib/fxEquivalent.test.ts` |
| AC-1012-007 | **Given** actual `FxEquivalent` components using the batched hook with an IDR org, mixed document cutoffs, latest-day balances and missing/error/pending states, **when** they settle/retry or switch en/id copy, **then** each cell retains its own date/reason and original sibling amount, no unavailable value becomes zero, and compact captions retain full accessible text. | unit — `pmo-portal/src/components/fx/FxEquivalent.batch.test.tsx` |
| AC-1012-008 | **Given** a real Finance session in a disposable synthetic org with no rates, **when** the user uploads/previews/confirms, reloads, repeats the import and opens its USD contract and invoice, **then** persisted rows remain unique and the unchanged original amounts and date-labelled equivalents survive the new transport. | e2e — existing `pmo-portal/e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts`; append this new ID to its existing single test title, retain AC-FX-015 and every goal assertion. No second journey. |

## 6. Non-goals and risks

No table replacement, schema backfill, BI feed/fetch, additional currency pair, historical exchange-rate snapshot on documents, ERP rate import, ledger revaluation, converted margin or consolidated totals. The existing management feature and its original pgTAP tests remain in force.

- Uploaded history can lag BI or omit a publication: actual source/date disclosure is mandatory; no automatic verification is claimed. OQ-1012-2 is a business-policy follow-up, not authority to guess.
- Number multiplication is indicative and can lose whole-rupiah precision at very large magnitudes. Do not reuse this helper for ledger arithmetic. Decimal-exact display at that scale would be separately scoped.
- Deferred distinct-date fan-out is real at the client (E6); batching reduces transport round trips, not the number of indexed predecessor probes. Verify plans with a production-shaped synthetic history; do not enforce a brittle exact plan node or timing threshold.
- Timer queues, cancellation and cache invalidation need deterministic tests; do not introduce a global cross-session result cache.
- Migration 0331 is the next candidate in the inspected worktree; concurrent branches can claim it. Rebase before build; if a collision occurs, identify the next free number and use `scripts/renumber-migration.sh` to move 0331 to that verified number, updating these docs/test references together.
- No code tests or browser review were run for this docs-only specification. E13's outstanding rendered route/locale/theme/viewport checks remain required before an eventual code release. Dev is the release ceiling; this planning task authorizes no push/deploy.

## 7. OPEN QUESTIONS for the owner — recommended defaults used above

1. **OQ-1012-1 — Is a broader rollout required in the same delivery?** Recommended/default: **no**; retain contract detail + invoice register/detail now. Prioritize Projects-list contract values next if requested; leave pipeline forecasts, work orders, receipts/vendor bills, dashboards and accounting reports as separately scoped work. This is a scope/time decision, not a blocker to preserving the shipped first cut.
2. **OQ-1012-2 — Should Finance have a maximum-age warning or refusal policy for the latest uploaded rate?** Recommended/default: **no arbitrary age threshold in this slice**. Always show the actual publication date/source and treat it as an indicative uploaded reference; never claim it is today's BI publication. A customer-specific freshness promise needs an owner-selected age/calendar policy and its own ACs. Historical document-date conversions must not expire merely because the document is old.

Document dates, source, unsupported pairs, missing-rate semantics and display-only versus booked treatment are already ruled; they are not reopened as owner questions.
