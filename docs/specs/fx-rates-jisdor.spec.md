# JISDOR display-only exchange rates — #1012

Date: 2026-10-14. Status: specified for Director review; this document does not claim an additional owner sign-off. Owner source: [#1012](https://github.com/ariefsaid/PMO/issues/1012), read on 2026-10-14. Plan: `docs/plans/2026-10-14-fx-rates-jisdor.md`.

## Job story and locked scope

When I review a USD contract or invoice in an IDR organization, I want an explicitly approximate rupiah equivalent beside the original, so I can understand its home-currency scale without mistaking it for a ledger amount. Finance uploads the published BI reference history; Admin can enter/correct one day.

The owner ruling is not reopened: JISDOR, manual upload, document-date lookup with previous-publication fallback, latest for open balances, explicit absence, and originals retained. Finance/Admin have database INSERT/UPDATE rights and upload rights. **The single-day add/edit affordances are Admin-only**, following the issue's more specific ruling; this is the permitted stricter frontend projection of the Finance/Admin write-policy constraint, not an expansion of Finance's manual-edit UX. Other members may read rates for equivalents but do not see the Exchange rates navigation item or maintenance page. Operator status alone grants no FX management rights.

Only USD → IDR is supported. No inverse rate, triangulation, EUR conversion, converted margin, mixed-currency aggregate conversion, automatic fetch, external accounting write, or changes to exact invoice/project amounts. Existing procurement per-currency breakdowns and exports remain unchanged.

## Evidence / reuse

- `docs/decisions.md`, DD-CUR-6; closed #530 (currency seam): exact per-record denomination and per-currency totals remain authoritative.
- `supabase/migrations/0187_money_currency_seam.sql`: projects, sales invoices and procurement headers carry their own immutable denomination; `organizations.default_currency` is the operating currency, defaulted into new money documents by a trigger. Child procurement lines inherit the header denomination.
- `pmo-portal/src/lib/format.ts`: money formatting separates record currency from viewer number locale. New equivalent formatting must preserve that distinction.
- `pmo-portal/pages/Administration.tsx`: route-backed section shell with localized labels and role/operator access. Finance needs an FX-only doorway, not access to unrelated administration controls.
- `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx` and `tabs/OverviewTab.tsx`: finance-forward header versus Engineer overview financial summary.
- `pmo-portal/pages/SalesInvoices.tsx`: list and routable invoice detail; detail uses `pages/approvals/SalesInvoiceApprovalRow.tsx`'s preview. Do not create a second invoice route.
- `pmo-portal/src/lib/import/parseWorkbook.ts`: shared workbook parser, first-row headers, 500-row limit, dynamically imported **ExcelJS**. `package.json` has ExcelJS, **not SheetJS/xlsx**. The existing create-per-row descriptor wizard is not an atomic date-keyed upsert and must not be misreported as one.
- `src/auth/policy.ts`, repository seam, shared modal/form/table/error primitives, `DESIGN.md`, ADR-0010, `docs/qa-portfolio.md` are binding.
- `pages/__tests__/Administration.a11y.test.tsx` already covers composed Administration pages with the Layer-1 axe helper; FX joins that gate.

## Functional requirements (EARS)

| ID | Requirement |
|---|---|
| FR-FX-001 | The system shall store org-scoped `fx_rates` with `rate_date`, USD base, IDR quote, positive finite numeric rate, JISDOR source, creation/update actor and timestamps, and unique `(org_id, source, base_currency, quote_currency, rate_date)`. |
| FR-FX-002 | While a caller is an active member, the system shall permit reads only in the caller's organization; when Finance/Admin writes, the system shall enforce that same organization scope and server-stamp organization/audit fields. Other roles, inactive members and anonymous callers shall not write. |
| FR-FX-003 | When an equivalent requests a document date, the system shall use the latest published `rate_date <= document date`, return both rate and actual publication date, and return absence rather than a numeric substitute when none exists. |
| FR-FX-004 | When an open balance requests the latest rate, the system shall use the latest publication not after the current organization-local calendar day, independent of invoice date. |
| FR-FX-005 | Where the record currency equals the resolved organization default, the system shall render only the existing original amounts. Where the currency differs, the system shall retain each original first and add a subordinate approximation for supported USD/IDR, including source and actual publication date. |
| FR-FX-006 | When a document's currency pair is unsupported, its date is missing, rates are unavailable, or a rate lookup fails, the system shall state that distinct reason without converting, substituting zero, or using today's rate for an undated document. |
| FR-FX-007 | When Finance/Admin opens Administration → Exchange rates, the system shall show the USD/IDR JISDOR history newest first with bounded pagination, upload access, loading/empty/retryable error states, and no delete action. Other roles shall not see that section link or mount its maintenance queries on direct navigation. |
| FR-FX-008 | When Admin adds or edits one publication day, the system shall validate date/rate, preserve entries on failed save, ask for confirmation before overwriting an existing rate, and persist through the shared repository/form/error primitives. |
| FR-FX-009 | When Finance/Admin chooses a BI JISDOR Excel download or plain `date,rate` CSV, the system shall detect the date/rate header row and parse calendar dates, Indonesian/English month names, Excel date values and the Indonesian/English rate number conventions without depending on viewer locale. |
| FR-FX-010 | When input contains a bad date, non-finite/non-positive rate, implausible rate, malformed grouping, conflicting duplicate date, excessive size, or unsupported encoding, the system shall refuse that row/file with an actionable reason and shall not silently reinterpret a separator or round excess precision. |
| FR-FX-011 | When parsing finishes, the system shall show a preview of new/changed/unchanged counts, normalized dates/rates, and rejected physical row numbers/reasons before any write. While any row is rejected, confirmation shall be disabled; the user fixes/reuploads the file rather than accidentally committing a partial history. |
| FR-FX-012 | When the user confirms a valid preview, the system shall atomically upsert that file's unique dates, preserve unrelated dates, update changed rates, leave identical rates and their audit stamps unchanged, report actual committed counts, and invalidate list/equivalent caches. When a write fails, no success shall be shown and the preview shall remain available for retry. |
| FR-FX-013 | Where a foreign-currency contract value is displayed in the project detail header or relocated overview financial summary, the system shall attach its equivalent using `contract_date`; it shall not attach converted margin or reinterpret a pipeline estimate as a dated contract. |
| FR-FX-014 | Where sales invoice amount, separately displayed total due, or outstanding amount is shown in the invoice list/detail, the system shall attach equivalents using `invoice_date` for amount/total due and latest for outstanding; null source amounts shall remain unavailable, not become zero. |
| FR-FX-015 | While the viewer uses Bahasa, the system shall localize Administration navigation, actions, preview, validation, status and unavailable copy; JISDOR and ISO currency codes shall retain their identity. |

### Parser contract / bounded engineering choices

These are validation and resource choices, not a new commercial rate/staleness policy:

- Accept a positive USD/IDR rate **between 1,000 and 100,000 inclusive**, at most six decimal places. This deliberately broad band admits historical rupiah reference magnitudes while rejecting both thousandfold readings of a 16,234-rate token (16.234 and 16,234,000). A legitimate out-of-band BI value requires a reviewed band change, never a bypass checkbox. The database enforces the same band, in addition to `rate > 0`.
- Support `16234.56`, `16.234,56`, `16,234.56`, numeric Excel cells, and integer `16234`; repeated thousands groups must be exactly three digits. Consider only syntactically valid grouping/decimal candidates; accept exactly one in-band interpretation, otherwise reject. Do not globally remove punctuation or run locale-dependent `parseMoneyInput` on downloaded files.
- Dates: ISO `YYYY-MM-DD`, Indonesian day-first numeric `DD/MM/YYYY` or `DD-MM-YYYY`, and day + Indonesian/English full or abbreviated month + four-digit year. Reject impossible dates, missing years and future dates relative to the org calendar day. Do not guess US numeric month-first ordering. Preserve calendar dates, not browser-local instants. Excel's 1900/1904 workbook date system must be honored.
- Scan the first 20 rows for one header containing `date`/`tanggal` and `rate`/`kurs`/`JISDOR` (case/space insensitive); reject ambiguous header/column matches rather than choose arbitrarily. Ignore wholly blank rows; nonblank footer rows are rejected with their row number rather than discarded as valid data.
- CSV obeys quoted-field/escaped-quote rules, including commas inside quoted rates and a leading BOM; exactly the `date,rate` columns. No spreadsheet formula evaluation. Files are processed in memory; no original file is uploaded to storage.
- Max 5 MiB file; 500 data rows (existing shared import limit). Duplicate date+equal normalized rate collapses to one candidate with an explicit duplicate count; differing rates reject every conflicting row.
- The Director supplies a **real public BI export before merge**. Synthetic Excel fixtures are development aids, never evidence of BI compatibility. The real sample decides decoder support: ExcelJS reads OOXML `.xlsx`, not legacy BIFF `.xls`. If the actual download is unsupported by existing engines, stop and return that format constraint to the Director; do not add a package, change the lockfile, or require users to manually convert BI's download while claiming acceptance.

### Display contract

Supported example (en-US number locale): original `$100.00`, then `≈ Rp 1,623,456 (JISDOR 2026-10-09)` for rate 16,234.56. The explicit `Rp` label is retained in both languages; numeric grouping follows the viewer's number locale. Round only the *display* equivalent to whole rupiah; no converted value is persisted or used in totals. Publication date is an unambiguous ISO date, independent of timezone.

Absent historical rate: `no rate for 2026-10-10` / `tidak ada kurs untuk 2026-10-10`. Latest absence names the org-local lookup day. Separate strings cover missing document date, unsupported USD/quote pair, org-currency resolution failure, loading rates and lookup error (with Retry). A valid original zero may yield `≈ Rp 0`; absence may never masquerade as zero. Org-currency placeholder USD is not considered resolved.

## Non-functional requirements (EARS)

| ID | Requirement |
|---|---|
| NFR-FX-001 | The system shall keep exact document currencies, amounts, tax basis, ledger/export values and existing per-currency aggregations unchanged. |
| NFR-FX-002 | The system shall force RLS on the new table, explicitly restrict grants, preserve the `org_id` seam, and audit actual rate changes server-side; client input shall not supply organization or actor stamps. |
| NFR-FX-003 | The system shall use one stable security-invoker date-lookup function and one typed formatter/component seam; historical selection shall not be reimplemented in page code. |
| NFR-FX-004 | The system shall use indexed bounded reads: 50-row management pages and at most one lookup per distinct `(org, base, quote, requested date)` per mounted working set, shared through React Query; amounts shall not be part of rate query keys. |
| NFR-FX-005 | The system shall load ExcelJS only when a file is selected, enforce file/row limits, discard file buffers after parsing/closing, and introduce no dependency or lockfile change. |
| NFR-FX-006 | The system shall follow DESIGN.md responsive/token/keyboard conventions and pass composed-page Layer-1 axe checks; state reasons shall be visible rather than color-only or tooltip-only. |
| NFR-FX-007 | The implementation shall use reversible migration **0291**, regenerate Supabase types, register the new isolation-probe surface, and pass the named local and CI gates with at least 80% coverage of changed code. |

## Acceptance criteria (Given / When / Then)

| ID | Given | When | Then |
|---|---|---|---|
| AC-FX-001 | Synthetic rates, five active roles, inactive members, anonymous access and another org | Those callers read/write directly and through the invoker writer | Active members read own-org only; Finance/Admin alone insert/update own-org; unauthorized writes fail or affect zero rows; no cross-org data or stamp alteration is possible. |
| AC-FX-002 | A valid date/rate key and server-stamped audit values | An identical upsert, changed upsert and invalid rate/pair/source are attempted | One row remains; identical rerun preserves stamps; change records actor/time and audit delta; invalid data is refused. |
| AC-FX-003 | Friday 2026-10-09 = 16234.56 and Monday 2026-10-12 = 16300 | Lookup requests Friday, Saturday, Monday, a date before both, unsupported pair, or null date | Results are Friday/Friday/Monday with their actual dates, then absence/absence/absence; future rates never substitute. |
| AC-FX-004 | Dated USD/IDR original amounts, including zero, and missing/unsupported inputs | The shared formatter/component renders in en/id with settled, pending and failed lookups | Original stays first; supported approximation is correctly rounded and labeled; all unavailable states have distinct copy, no guessed zero, and errors offer retry. |
| AC-FX-005 | Workbooks with title rows, numeric/text date/rate cells and localized dates/numbers | The parser reads them in either viewer locale | The normalized date/rate rows are identical and correct, including 1900/1904 dates and physical row numbers. |
| AC-FX-006 | Quoted CSV, malformed rates/dates, conflicting duplicates, formula cells and over-limit input | Parse/validation runs | Valid quoted values normalize; each invalid row/file has a specific reason; precision and bounds are enforced; no partial commit is enabled. |
| AC-FX-007 | Existing and incoming dates with equal/changed/new values | Upload reaches preview, is cancelled, confirmed, or fails | Counts and rejected rows are visible before writes; cancel writes nothing; rejected preview cannot commit; valid confirm uses one atomic call, reports committed counts, invalidates caches, and failure preserves preview. |
| AC-FX-008 | More than 50 own-org publications or pending/empty/failed reads | Finance/Admin opens Exchange rates and pages/retries | Newest-first bounded pages and correct navigation states render; no premature empty state; retry recovers and boundary controls disable. |
| AC-FX-009 | An Admin, a Finance viewer and an impersonating viewer | Single-day add/edit is offered and used | Admin-only manual controls validate date/rate; existing-day overwrite requires confirmation; cancel writes nothing; failed save retains entries and persistent error; view-as cannot write. |
| AC-FX-010 | Finance/Admin versus other roles and Operator-only authority | Rail/palette/Administration navigation or direct URL is used | Finance can discover the FX-only Administration doorway; only Finance/Admin see/open Exchange rates; unrelated section rights and existing Operator behavior remain unchanged. |
| AC-FX-011 | Foreign USD project with contract date, an IDR project, and a missing-date contract | Finance-forward header and Engineer financial overview render | Contract equivalent uses contract date in each existing location; originals/tax basis/actions remain; IDR is not converted; missing date is stated; no margin equivalent appears. |
| AC-FX-012 | USD invoices with different invoice dates, a null amount and an IDR invoice | The real list and routable detail compositions render | Amount/total-due equivalents request their invoice dates; outstanding requests latest org-day; no extra table column/export conversion; IDR and null amounts do not trigger guessed conversions. |
| AC-FX-013 | en/id and 1280/390px Administration shell, list, upload preview and manual dialog states | Keyboard interaction and Layer-1 axe scan run | Controls have localized names, labels and focus restoration; no critical/serious WCAG-AA violations; no duplicate mounted panel. |
| AC-FX-014 | The Director-supplied, unmodified public BI download and independently read expected values | The real file goes through the shipped decoder/parser | It is accepted without a dependency or manual file conversion and every selected oracle date/rate is exact; synthetic fixtures cannot satisfy this criterion. |
| AC-FX-015 | A real Finance session and an isolated synthetic organization/document set | User uploads, previews, confirms, opens a USD contract/invoice, and repeats the same upload | Reload retains one row per date; originals remain intact; document-date and latest equivalents show the actual JISDOR publication dates; rerun reports unchanged. |

## Traceability / canonical ownership (ADR-0010)

Each listed test file contains one AC-leading canonical test/case group for the named AC. Supporting tests may reference the ID but do not change its owning layer.

| AC | Requirements | Owning layer | Canonical test artifact |
|---|---|---|---|
| AC-FX-001 | FR-001/002; NFR-002 | pgTAP | `supabase/tests/0291_fx_rates_rls.test.sql` |
| AC-FX-002 | FR-001/010/012; NFR-002 | pgTAP | `supabase/tests/0291_fx_rates_write.test.sql` |
| AC-FX-003 | FR-003/004; NFR-003/004 | pgTAP | `supabase/tests/0291_fx_rate_on.test.sql` |
| AC-FX-004 | FR-003..006; NFR-001/003 | Unit | `pmo-portal/src/components/fx/FxEquivalent.test.tsx` |
| AC-FX-005 | FR-009/010; NFR-005 | Unit | `pmo-portal/src/lib/import/__tests__/fxRateParser.test.ts` |
| AC-FX-006 | FR-009/010/011; NFR-005 | Unit | `pmo-portal/src/lib/import/__tests__/fxRateParser.invalid.test.ts` |
| AC-FX-007 | FR-011/012 | Unit | `pmo-portal/src/components/fx/FxRateUpload.test.tsx` |
| AC-FX-008 | FR-007; NFR-004 | Unit | `pmo-portal/pages/__tests__/AdministrationExchangeRates.test.tsx` |
| AC-FX-009 | FR-008/015 | Unit | `pmo-portal/src/components/fx/FxRateForm.test.tsx` |
| AC-FX-010 | FR-007/015; NFR-002 | Unit | `pmo-portal/pages/__tests__/Administration.fxAccess.test.tsx` |
| AC-FX-011 | FR-013; NFR-001 | Unit | `pmo-portal/pages/project-detail/__tests__/ProjectFxEquivalent.test.tsx` |
| AC-FX-012 | FR-014; NFR-001 | Unit | `pmo-portal/pages/__tests__/SalesInvoices.fx.test.tsx` |
| AC-FX-013 | FR-015; NFR-006 | Unit | `pmo-portal/pages/__tests__/Administration.a11y.test.tsx` |
| AC-FX-014 | FR-009; NFR-005 | Unit (real-file golden) | `pmo-portal/src/lib/import/__tests__/fxRateParser.bi.test.ts` |
| AC-FX-015 | FR-003/004/005/007/009/011/012/013/014 | E2E | `pmo-portal/e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts` |

## Decision entry for Director to copy into decisions.md

### DD-FX-1 — JISDOR is stored for labelled display equivalents, not consolidated accounting (owner #1012, 2026-10-14)

**Context.** DD-CUR-6 declined acquiring rates until an organization genuinely needed a home-currency view. The owner has now selected BI's manually uploaded USD/IDR JISDOR publications and ruled the date/source semantics.

**Decision.** PMO stores org-scoped JISDOR history and shows an approximate rupiah equivalent **beside**, never instead of, the exact contract/invoice amount. Dated documents use the latest publication at or before their own date; open balances use the latest available publication as of the organization day. Missing rate/date and unsupported pair remain explicitly unavailable. Finance/Admin upload; Admin has the single-day correction UX. No automatic feed or accounting conversion is introduced.

**Consequences.** Supersedes only DD-CUR-6's “PMO holds no exchange rates” and its blanket ban on **display-only equivalents**. Its exact per-currency procurement/revenue breakdown ruling remains in force. Stored original currencies/amounts, tax basis, exports, money transitions and margins remain unchanged. Changing a reference rate can change a labelled display approximation on a later read, never a document or ledger. Schema/API rationale is recorded in ADR-0085.

## Director dependencies / open questions

No owner-product question is reopened. **Merge dependency:** supply one real public BI export, including its actual file encoding, before AC-FX-014 can be green. The 1,000–100,000 validation band and 5 MiB resource bound are explicit reviewable engineering choices. If the supplied export requires an unsupported decoder, escalate the no-new-dependency constraint rather than invent compatibility. No client files or client data may be committed as fixtures.
