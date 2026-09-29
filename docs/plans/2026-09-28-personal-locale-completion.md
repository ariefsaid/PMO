# Personal Locale Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete a user's personal language, number-format, and timezone preferences, and apply them consistently to on-screen values and money entry while preserving neutral stored and exported values.

**Architecture:** Keep `resolveLocale(profile, org)` as the sole preference-resolution seam and extend the existing `format.ts` facade for locale-sensitive parsing, formatting, and timezone-aware instant display. Keep money drafts as locale-formatted strings in the shared number field, parse them through one shared locale-aware helper at validation and persistence boundaries, and use a separate neutral parser for imports. Extend the existing profile preference repository/UI over the shipped nullable columns; make no schema, auth, or RLS changes.

**Tech Stack:** React 19, TypeScript, React Router 8, `Intl`, Vitest/RTL, Playwright, Supabase repository layer.

**Spec:** `docs/specs/personal-locale-completion.spec.md` (#684)

## Global Constraints

- `resolveLocale` remains the only resolver; a `NULL` profile preference means inherit the live organization default.
- Explicit values are language `id` or `en`, number locale `id-ID` or `en-US`, and a valid IANA timezone.
- Save all three nullable profile values, refresh the signed-in profile, and show success only after the refresh succeeds.
- A money field must use the same locale-aware parse for validation and persistence, and reject values that exceed the target's supported scale before writing.
- A two-decimal target accepts `1.234` as 1234 under `id-ID` and rejects 1.234 under `en-US`; the low-level parser still returns those respective numeric values.
- Spreadsheet and CSV imports use a viewer-independent dot-decimal parser and enforce the target scale separately.
- Exports keep numeric cells numeric, date cells typed, and machine values ISO/raw; no exported value passes through a display formatter or translation function.
- Date-only values preserve their calendar day; instant-derived times and dates use the resolved profile timezone; elapsed relative time stays elapsed.
- The UI remains usable in English and Bahasa Indonesia, both themes, keyboard navigation, and a 390px viewport.
- Do not add dependencies or regenerate `package-lock.json` on macOS.
- Use `../scripts/with-test-lock.sh` for targeted Vitest runs and `VITEST_MAX_WORKERS=3 npm run verify:locked` for the full suite on this shared machine.
- Do not push, open a PR, merge, or deploy from this task.
- `#680` owns `pmo-portal/src/components/integrations/IntegrationsView.tsx` and its test right now. Leave both files untouched until #680 lands on `dev`; then rebase `codex/personal-locale` and apply the instant-date migration to the merged code.

## Review Focus

1. The ambiguous text `1.234`: test both locale interpretations, and prove a two-decimal English target rejects before its repository write while the Indonesian interpretation persists 1234.
2. Grouped and partially typed input: test grouping and decimal separators during typing, a trailing decimal separator, paste, and caret position so the mask never changes the amount silently.
3. Preference transitions: test explicit values that happen to match current organization defaults, resetting one field while preserving the other two, invalid timezone rejection, and both write and refresh failures retaining retryable choices.
4. A boundary instant viewed under contrasting timezones: test its wall-clock time and instant-derived date, while an ISO date-only value remains on its original day and relative time remains elapsed.
5. Neutral data paths: test imports under both active number locales, reject imported precision the target cannot store, and assert XLSX/CSV output remains typed and unlocalized.

## AC Traceability

| AC | Owning proof in this plan |
|---|---|
| AC-PLC-001, AC-PLC-002, AC-PLC-003, AC-PLC-006 | `ProfileSettings.test.tsx` plus the profile repository contract test |
| AC-PLC-004 | `format.locale.test.ts` and representative money-form tests in Tasks 5–7 |
| AC-PLC-005 | `format.timezone.test.ts` plus the date-only and instant consumer tests in Task 8 |
| AC-PLC-007 | Dedicated serial journey `e2e/serial/AC-PLC-007-personal-locale-preferences.spec.ts` |
| AC-PLC-008 | `toWorkbookBuffer.dateTz.test.ts` export regression |
| AC-PLC-009 | Locale parser, tax-fact, on-screen money-form, and viewer-independent import tests in Tasks 1, 5–7 |

---

### Task 1: Locale-aware money parse and target precision

**Files:**
- Modify: `pmo-portal/src/lib/format.ts`
- Modify: `pmo-portal/src/lib/format.test.ts`
- Modify: `pmo-portal/src/lib/format.locale.test.ts`
- Create: `pmo-portal/src/lib/format.moneyPrecision.test.ts`
- Modify: `pmo-portal/src/lib/taxTreatment.ts`
- Create: `pmo-portal/src/lib/taxTreatment.test.ts`
- Create: `pmo-portal/src/lib/taxTreatment.neutral.test.ts`

**Interfaces:**
- `parseMoneyInput(raw: string, locale?: string): number | null` reads the active number locale when `locale` is omitted.
- `parseMoneyInputAtScale(raw: string, scale?: number, locale?: string): number | null` returns the same parsed number only when it fits the requested decimal scale; use scale 2 only for targets whose storage is actually scale-2.
- `parseNeutralMoneyInput(raw: string): number | null` accepts the import convention: dot decimal with optional correctly placed ASCII comma grouping, independent of the active display locale.
- `parseNeutralMoneyInputAtScale(raw: string, scale?: number): number | null` combines the neutral parser with a target scale check.
- `parseNeutralTaxFacts(treatment: string, amountRaw: string)` validates imported tax facts with the same neutral amount grammar and scale-2 limit.

- [ ] **Step 1: Add the failing locale-parser oracle.** In `format.locale.test.ts`, set the active locale to `id-ID` and assert `parseMoneyInput('1.234') === 1234`; set it to `en-US` and assert the result is `1.234`. Keep legacy syntax assertions (`1e5`, blank, invalid grouping, and `0x10`) in the same test file.
- [ ] **Step 2: Run the focused tests and confirm the missing locale behavior fails.** Run from `pmo-portal/`: `../scripts/with-test-lock.sh npm run test -- src/lib/format.locale.test.ts src/lib/format.test.ts`.
- [ ] **Step 3: Implement locale parsing.** Derive the decimal and grouping symbols from `Intl.NumberFormat(locale).formatToParts(12345.6)`. Strip only correctly placed locale grouping symbols, replace the locale decimal symbol with `.`, reject malformed grouping or multiple decimals, then use strict `Number()` and `Number.isFinite`. Keep the existing blank, sign, exponent, and `Number()`-accepted hexadecimal contracts.
- [ ] **Step 4: Add failing scale and neutral-import tests.** In `format.moneyPrecision.test.ts`, assert target scale 2 accepts Indonesian `1.234` as 1234, rejects English `1.234`, preserves `0.29` and `1.2300`, and rejects excess exponent precision. Assert neutral `1.234` remains 1.234 under both active locales but the scale-2 helper rejects it. In `taxTreatment.test.ts`, assert Indonesian `1.234` becomes 1234 while English rejects the three-decimal amount; in `taxTreatment.neutral.test.ts`, assert dot-decimal imports stay independent of the active locale. Run all three files under `../scripts/with-test-lock.sh` and confirm they fail before implementation.
- [ ] **Step 5: Implement scale and neutral parsing.** Count meaningful decimal places from the normalized decimal/exponent representation rather than rounding. Keep neutral parsing dot-decimal with optional correctly placed ASCII comma grouping, independent of `getNumberLocale()`. Reject malformed grouping. Make `parseTaxFacts` and `parseNeutralTaxFacts` use their corresponding scale-2 parser.
- [ ] **Step 6: Run the complete parser boundary tests.** Run: `../scripts/with-test-lock.sh npm run test -- src/lib/format.locale.test.ts src/lib/format.moneyPrecision.test.ts src/lib/format.test.ts src/lib/taxTreatment.test.ts src/lib/taxTreatment.neutral.test.ts`.

### Task 2: Separate date-only and instant formatters

**Files:**
- Modify: `pmo-portal/src/lib/format.ts`
- Modify: `pmo-portal/src/lib/locale/activeLocale.ts`
- Modify: `pmo-portal/src/lib/format.test.ts`
- Modify: `pmo-portal/src/lib/format.locale.test.ts`
- Create: `pmo-portal/src/lib/format.timezone.test.ts`

**Interfaces:**
- `formatDateOnly(iso: string | null | undefined): string` is for `YYYY-MM-DD` business dates and never receives the profile timezone; migrate every existing `formatDate` call to this or an instant formatter.
- `formatDateOnlyNumeric(iso: string | null | undefined): string` is the numeric-date shape for a `YYYY-MM-DD` string, parsed at local midnight rather than through `new Date(iso)`.
- `formatInstantDate(iso: string | null | undefined): string` displays the calendar date of an ISO instant in the active profile timezone.
- `formatInstantDateNumeric(iso: string | null | undefined): string` provides the numeric-date shape for an instant-derived calendar date.
- `formatDateTime(instant: Date): string` uses the active profile timezone; `formatRelativeTime` continues to represent elapsed time.

- [ ] **Step 1: Add failing tests for the split.** In `format.timezone.test.ts`, use `2026-06-14T23:30:00.000Z` and assert its displayed date differs between `UTC` and `Asia/Jakarta`; assert the same `2026-06-14` date-only string renders June 14 under both. Assert `formatDateTime` changes wall-clock hour between those zones. Keep a relative-time assertion based on elapsed duration.
- [ ] **Step 2: Run the focused tests and confirm timezone output currently follows the runtime.** Run: `../scripts/with-test-lock.sh npm run test -- src/lib/format.timezone.test.ts src/lib/format.locale.test.ts src/lib/format.test.ts`.
- [ ] **Step 3: Add the formatter APIs.** Preserve date-only parsing at local midnight; parse instants with `parseISO` and pass `getActiveLocale().timezone` to `Intl.DateTimeFormat`. Include timezone in the date formatter cache key. Keep UTC-pinned chart formatters and date-only formatters pinned to their existing zone behavior.
- [ ] **Step 4: Verify malformed and empty inputs still render an em dash.** Add invalid-input assertions for both date-only and instant APIs, then run the focused formatter tests.

### Task 3: Shared locale-aware number-field mask

**Files:**
- Modify: `pmo-portal/src/lib/format.ts`
- Modify: `pmo-portal/src/components/ui/FormFields.tsx`
- Modify: `pmo-portal/src/components/ui/__tests__/FormFields.test.tsx`

**Interfaces:**
- `formatMoneyInputDraft(raw: string, locale?: string): string` groups a valid or partially typed input using the locale's symbols while preserving an unfinished decimal part.
- `NumberFieldProps.localeAware?: boolean` opts an amount/rate/tax field into the shared input mask; ordinary counts remain unchanged.

- [ ] **Step 1: Add failing mask tests.** Assert the draft formatter produces `1.234.567,89` for Indonesian input and `1,234,567.89` for English input, preserves `1,234.` and `1.234,`, and leaves an invalid draft available for the existing validator instead of silently dropping digits.
- [ ] **Step 2: Run the focused test and confirm the formatter is absent.** Run: `../scripts/with-test-lock.sh npm run test -- src/components/ui/__tests__/FormFields.test.tsx`.
- [ ] **Step 3: Implement `formatMoneyInputDraft` and the `localeAware` input behavior.** Preserve the number of digits and whether the decimal separator is before the caret; restore the selection after React applies the formatted value. Keep the existing label/error wiring, prefix, `inputMode="decimal"`, 32px control height, and disabled state.
- [ ] **Step 4: Prove the rendered field updates as the user types.** Add RTL cases for both locales, mid-string edits, and a trailing decimal separator; run the focused test and existing `FormFields` tests.

### Task 4: Profile preferences form and repository seam

**Files:**
- Modify: `pmo-portal/src/lib/repositories/profilePreferences.ts`
- Modify: `pmo-portal/src/lib/repositories/profilePreferences.test.ts`
- Modify: `pmo-portal/src/hooks/useResolvedLocale.ts`
- Modify: `pmo-portal/pages/ProfileSettings.tsx`
- Modify: `pmo-portal/pages/ProfileSettings.test.tsx`
- Modify: `pmo-portal/public/locales/en/common.json`
- Modify: `pmo-portal/public/locales/id/common.json`
- Create: `pmo-portal/src/lib/locale/timezones.ts`
- Create: `pmo-portal/src/lib/locale/timezones.test.ts`

**Interfaces:**
- `profilePreferencesRepository.setLocalePreferences(userId, { locale, numberLocale, timezone })` delegates to the existing `setMyLocalePreferences` DAL function.
- `useOrgLocaleDefaults()` exposes the existing cached organization defaults; `useResolvedLocale()` continues to return only `resolveLocale(profile, org)` output.
- The settings form stores each control as `inherit` or one supported explicit value; `inherit` maps to `null` only at save time.
- `isValidTimeZone(value: string): boolean` validates with `Intl.DateTimeFormat`; the searchable choice list contains valid IANA identifiers plus a valid current/default zone if the runtime's list omits it.

- [ ] **Step 1: Add failing repository and settings tests.** Assert the repository writes all three columns together. Assert the settings page shows stored choices separately from inherited effective values, shows both number examples, lists a searchable timezone, writes `NULL` only for the reset field, and awaits refresh before success. Add invalid-timezone, write-error, and refresh-error retry cases.
- [ ] **Step 2: Run the focused tests and confirm the new controls and repository method are missing.** Run: `../scripts/with-test-lock.sh npm run test -- src/lib/repositories/profilePreferences.test.ts pages/ProfileSettings.test.tsx src/lib/locale/timezones.test.ts`.
- [ ] **Step 3: Extend the repository wrapper and share the organization-default query.** Keep the database columns, auth context, and RLS model unchanged; reuse `setMyLocalePreferences` and the existing org-default React Query key.
- [ ] **Step 4: Implement the grouped settings form.** Use the existing `SelectField` for language and number format and the existing searchable `Combobox` for timezone; include an organization-default choice that names the inherited effective value. Display `1.234.567,89` and `1,234,567.89` previews. Save all three values in one repository call, call `refreshCurrentUser()`, and show success only when refresh returns no error. Preserve pending choices on either failure and show an accessible retryable alert.
- [ ] **Step 5: Add English and Bahasa strings and verify accessibility.** Keep field labels, examples, statuses, errors, and save copy in both catalogues; add an axe assertion and 390px-oriented layout assertions in the component tests. Run the focused tests and `npm run check:i18n`.

### Task 5: Apply the mask and scale guard to project, budget, and work-order forms

**Files:**
- Modify: `pmo-portal/components/ProjectFormModal.tsx`
- Modify: `pmo-portal/components/ProjectFormModal.numericValidation.test.tsx`
- Modify: `pmo-portal/components/ProjectFormModal.contractTax.test.tsx`
- Modify: `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx`
- Modify: `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.test.tsx`
- Modify: `pmo-portal/pages/ProjectBudget.tsx`
- Modify: `pmo-portal/pages/ProjectBudget.test.tsx`
- Modify: `pmo-portal/pages/BudgetProjection.tsx`
- Modify: `pmo-portal/pages/BudgetProjection.test.tsx`
- Modify: `pmo-portal/pages/project-detail/WorkOrderValueModal.tsx`
- Modify: `pmo-portal/pages/project-detail/WorkOrderFormModal.tsx`
- Modify: `pmo-portal/pages/project-detail/__tests__/WorkOrderForms.test.tsx`
- Modify: `pmo-portal/src/lib/taxTreatment.ts`

- [ ] **Step 1: Add failing no-write tests for scale-2 money inputs.** For a representative field in each form family, submit `1.234` under `en-US` and assert the field reports a precision error and its save callback is untouched; repeat under `id-ID` and assert the callback receives 1234. Add tax-amount scale checks through `parseTaxFacts`.
- [ ] **Step 2: Run the affected tests to confirm the current forms accept excess scale.** Run: `../scripts/with-test-lock.sh npm run test -- components/ProjectFormModal.numericValidation.test.tsx components/ProjectFormModal.contractTax.test.tsx pages/project-detail/__tests__/ProjectDetailHeader.test.tsx pages/ProjectBudget.test.tsx pages/BudgetProjection.test.tsx pages/project-detail/__tests__/WorkOrderForms.test.tsx`.
- [ ] **Step 3: Wire locale-aware fields and the scale-2 parser into each form.** Keep draft strings in form state, call `parseMoneyInputAtScale` for both validation and write value, and reject before mutation/RPC when parsing or precision fails. Replace the header's local en-US digit grouper with `formatMoneyInputDraft`.
- [ ] **Step 4: Seed edit drafts in the active display convention.** Use the shared money input formatter for existing numeric model values; keep the persisted payload numeric. Verify valid Indonesian and English entries preserve magnitude and currency.
- [ ] **Step 5: Run affected tests, including the existing contract tax and budget suites.** Run the same focused command from Step 2 under the test lock.

### Task 6: Apply the mask and neutral precision rules to procurement forms and imports

**Files:**
- Modify: `pmo-portal/pages/procurement/LineItemsSection.tsx`
- Modify: `pmo-portal/pages/procurement/LineItemsSection.numericValidation.test.tsx`
- Modify: `pmo-portal/pages/procurement/VendorQuotesTab.tsx`
- Modify: `pmo-portal/pages/__tests__/VendorQuotesTab.test.tsx`
- Modify: `pmo-portal/pages/procurement/RecordCaptureForm.tsx`
- Modify: `pmo-portal/pages/procurement/RecordCaptureForm.grvi.test.tsx`
- Modify: `pmo-portal/pages/procurement/ProcurementDecisionZone.tsx`
- Modify: `pmo-portal/pages/__tests__/ProcurementDetails.wave3.test.tsx`
- Modify: `pmo-portal/src/lib/import/projectDescriptor.ts`
- Modify: `pmo-portal/src/lib/import/__tests__/projectDescriptor.test.ts`
- Modify: `pmo-portal/src/lib/import/budgetDescriptor.ts`
- Modify: `pmo-portal/src/lib/import/__tests__/budgetDescriptor.test.ts`
- Modify: `pmo-portal/src/lib/import/procurementCycle/validate.ts`
- Modify: `pmo-portal/src/lib/import/procurementCycle/__tests__/validate.test.ts`
- Modify: `pmo-portal/src/lib/import/procurementCycle/commit.ts`
- Modify: `pmo-portal/src/lib/import/procurementCycle/__tests__/commit.test.ts`
- Modify: `pmo-portal/src/lib/taxTreatment.ts`
- Modify: `pmo-portal/src/lib/taxTreatment.test.ts`

- [ ] **Step 1: Add failing procurement-form and import tests.** Assert locale-aware entries reach create/transition callbacks as numeric values, excess scale triggers no callback, and imported `1.234` remains 1.234 regardless of the active locale but is rejected before create for a two-decimal target.
- [ ] **Step 2: Run the focused form/import tests and confirm the current paths use fixed parsing or unguarded `Number()`.** Run: `../scripts/with-test-lock.sh npm run test -- pages/procurement/LineItemsSection.numericValidation.test.tsx pages/procurement/RecordCaptureForm.grvi.test.tsx pages/__tests__/VendorQuotesTab.test.tsx pages/__tests__/ProcurementDetails.wave3.test.tsx src/lib/import/__tests__/projectDescriptor.test.ts src/lib/import/__tests__/budgetDescriptor.test.ts src/lib/import/procurementCycle/__tests__/validate.test.ts src/lib/import/procurementCycle/__tests__/commit.test.ts`.
- [ ] **Step 3: Upgrade the procurement input paths.** Use the shared locale mask for money fields in line items, quotes, record capture, and invoice capture. Keep count fields as count fields. Use the locale-aware scale-2 helper for screen entry and preserve numeric persistence.
- [ ] **Step 4: Keep imports neutral.** Use `parseNeutralMoneyInputAtScale` for project imports, budget imports, procurement-cycle amount validation, and commit guards. Use `parseNeutralTaxFacts` for imported tax rows; test both active locales and do not consult `getNumberLocale()` in an import path.
- [ ] **Step 5: Run the focused tests and inspect each import payload assertion.** Repeat the test command from Step 2 under the test lock.

### Task 7: Apply the mask and scale guard to invoices, payments, and credit grants

**Files:**
- Modify: `pmo-portal/pages/SalesInvoices.tsx`
- Modify: `pmo-portal/pages/__tests__/SalesInvoices.createForm.test.tsx`
- Modify: `pmo-portal/pages/__tests__/SalesInvoices.dueDate.test.tsx`
- Modify: `pmo-portal/pages/IncomingPayments.tsx`
- Modify: `pmo-portal/pages/__tests__/IncomingPayments.createForm.test.tsx`
- Modify: `pmo-portal/pages/AdministrationCredits.tsx`
- Modify: `pmo-portal/pages/__tests__/AdministrationCredits.saveError.test.tsx`
- Modify: `pmo-portal/pages/__tests__/AdministrationCredits.balanceUnit.test.tsx`

- [ ] **Step 1: Add failing tests for localized values and target-specific precision.** Test English `1.234` rejects with no write for scale-2 invoice/payment targets and Indonesian `1.234` reaches them as 1234. Credits use unrestricted numeric storage: English `1.234` reaches the grant as 1.234, Indonesian `1.234` reaches it as 1234, and invalid or non-positive values never grant. Verify the displayed credit balance retains meaningful fractional digits. Test sales-invoice line rate input preserves the locale-formatted draft until submit.
- [ ] **Step 2: Run the focused tests to confirm direct `Number()` conversions disagree with the selected locale.** Run: `../scripts/with-test-lock.sh npm run test -- pages/__tests__/SalesInvoices.createForm.test.tsx pages/__tests__/IncomingPayments.createForm.test.tsx pages/__tests__/AdministrationCredits.saveError.test.tsx pages/__tests__/AdministrationCredits.balanceUnit.test.tsx`.
- [ ] **Step 3: Store monetary drafts as strings and parse at the write boundary.** Convert sales-invoice line-rate drafts from number state to string state; leave quantity as a non-money number. Use `parseMoneyInputAtScale` for invoice and payment targets stored at scale 2. Parse credit grants with the locale-aware strict parser, require a finite value greater than zero, and pass that single parsed number to the repository without applying a two-decimal limit.
- [ ] **Step 4: Replace amount fields with the shared `NumberField` mask and run the focused tests.** Preserve existing field labels, error summaries, mutation failure feedback, command-intent behavior, and numeric API payloads. Format the unrestricted numeric credit balance without the old two-fraction-digit truncation so accepted fractional units remain visible.

### Task 8: Migrate instant-derived dates and times to the timezone-aware API

**Files:**
- Modify: `pmo-portal/pages/Meetings.tsx`
- Modify: `pmo-portal/pages/MeetingDetail.tsx`
- Modify: `pmo-portal/pages/IncidentDetail.tsx`
- Modify: `pmo-portal/pages/MyTasks.tsx`
- Modify: `pmo-portal/pages/Timesheets.tsx`
- Modify: `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx`
- Modify: `pmo-portal/pages/project-detail/ProjectDetailRail.tsx`
- Modify: `pmo-portal/pages/project-detail/tabs/TasksTab.tsx`
- Modify: `pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx`
- Modify: `pmo-portal/pages/ContactDetail.tsx`
- Modify: `pmo-portal/pages/CompanyDetail.tsx`
- Modify: `pmo-portal/src/components/AccountingSnapshotProvenance.tsx`
- Modify: `pmo-portal/src/components/integrations/M365ConnectionCard.tsx`
- Modify: `pmo-portal/pages/project-detail/PipelineLens.tsx`
- Modify: `pmo-portal/pages/procurement/ProcurementProgressionTimeline.tsx`
- Modify: `pmo-portal/pages/procurement/ProcurementLedger.tsx`
- Modify: `pmo-portal/pages/IncomingPayments.tsx`
- Modify: `pmo-portal/pages/SalesInvoices.tsx`
- Modify: `pmo-portal/pages/BudgetProjection.tsx`
- Modify: `pmo-portal/src/lib/export/__tests__/toWorkbookBuffer.dateTz.test.ts`
- Modify: `pmo-portal/pages/Meetings.test.tsx`
- Modify: `pmo-portal/pages/MeetingDetail.test.tsx`
- Modify: `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.test.tsx`
- Modify: `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.dateTz.test.tsx`
- Modify: `pmo-portal/pages/project-detail/__tests__/WorkOrdersTab.test.tsx`
- Modify: `pmo-portal/pages/project-detail/tabs/__tests__/OverviewTab.dateTz.test.tsx`
- Modify: `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx`
- Modify after #680 lands and branch is rebased: `pmo-portal/src/components/integrations/IntegrationsView.tsx`
- Modify after #680 lands and branch is rebased: `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`
- Modify: `pmo-portal/src/components/AccountingSnapshotProvenance.test.tsx`
- Modify: `pmo-portal/pages/IncidentDetail.test.tsx`
- Modify: `pmo-portal/pages/Timesheets.test.tsx`
- Modify: `pmo-portal/pages/__tests__/MyTasks.test.tsx`
- Modify: `pmo-portal/pages/__tests__/ContactDetail.g3c.test.tsx`
- Modify: `pmo-portal/pages/__tests__/CompanyDetail.g3c.test.tsx`
- Modify: `pmo-portal/pages/project-detail/__tests__/PipelineLens.writePolicy.test.tsx`
- Modify: `pmo-portal/pages/procurement/ProcurementProgressionTimeline.test.tsx`
- Modify: `pmo-portal/pages/procurement/ProcurementLedger.test.tsx`

- [ ] **Step 1: Add failing consumer tests.** Use an instant near UTC midnight for meeting occurrence, connection/snapshot timestamps, and procurement progression events; assert the profile timezone determines its displayed wall time/date. Keep invoice dates, due dates, contract dates, timesheet days, procurement ledger dates, and other `YYYY-MM-DD` values on `formatDateOnly`.
- [ ] **Step 2: Run the focused date tests and confirm consumers use the browser-local path.** Run from `pmo-portal/`: `../scripts/with-test-lock.sh npm run test -- pages/Meetings.test.tsx pages/MeetingDetail.test.tsx pages/IncidentDetail.test.tsx pages/Timesheets.test.tsx pages/__tests__/MyTasks.test.tsx pages/project-detail/__tests__/ProjectDetailHeader.test.tsx pages/project-detail/__tests__/ProjectDetailHeader.dateTz.test.tsx pages/project-detail/__tests__/WorkOrdersTab.test.tsx pages/project-detail/tabs/__tests__/OverviewTab.dateTz.test.tsx pages/__tests__/ContactDetail.g3c.test.tsx pages/__tests__/CompanyDetail.g3c.test.tsx src/components/AccountingSnapshotProvenance.test.tsx src/components/integrations/__tests__/M365ConnectionCard.test.tsx pages/project-detail/__tests__/PipelineLens.writePolicy.test.tsx pages/procurement/ProcurementProgressionTimeline.test.tsx pages/procurement/ProcurementLedger.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx src/lib/export/__tests__/toWorkbookBuffer.dateTz.test.ts src/lib/format.timezone.test.ts src/lib/format.test.ts src/lib/format.locale.test.ts`. Add `src/components/integrations/IntegrationsView.test.tsx` only after #680 lands and the branch is rebased.
- [ ] **Step 3: Migrate every existing date call explicitly.** Use `formatDateTime` for instants with a time; `formatInstantDate` or `formatInstantDateNumeric` for instant-only dates (`connected_at`, `disconnected_at`, activity timestamps, `decided_at`, snapshot `as_of`, `actualsAsOf`, and progression event `at`); `formatDateOnlyNumeric` for ISO invoice/due/payment dates; and `formatDateOnly` for business dates and calendar days (`contract_date`, task dates, valid-until/order dates, incident date, timesheet days, procurement ledger dates, and project start/end dates). Keep `formatRelativeTime` elapsed-time semantics unchanged. Keep the formatter's UTC-pinned chart API unchanged. Do not modify either #680 IntegrationsView file until the planned rebase.
- [ ] **Step 4: Add a locale-switch export regression.** Under both active locales, assert the workbook cell for a numeric amount remains a `number` and its date cell remains a `Date`/typed date with the existing neutral format; do not modify export production code unless this test proves a display formatter has entered the data path.
- [ ] **Step 5: Run formatter, consumer, and export tests under the test lock.** Repeat the focused test command and read the complete test output.

### Task 9: Extend the profile acceptance journey and run the rendered Discover pass

**Files:**
- Create: `pmo-portal/e2e/serial/AC-PLC-007-personal-locale-preferences.spec.ts`
- Modify: `pmo-portal/pages/ProfileSettings.test.tsx`
- Modify: `pmo-portal/src/lib/format.locale.test.ts`

- [ ] **Step 1: Add the AC-specific serial acceptance journey.** Leave `AC-L10N-060-language-switch.spec.ts` as the existing language proof. Put the new spec under `e2e/serial/`, start with `// @e2e-isolation: serial` and a one-line reason that it changes the shared seed profile, and name its test `AC-PLC-007: ...`. Choose all three preferences, assert the language/number/timezone display updates without a reload, reload and assert persistence, and restore all three overrides to `inherit` in `afterEach` even after an assertion failure. The serial lane is required because this journey mutates the shared signed-in seed profile.
- [ ] **Step 2: Run the acceptance journey with the database lock.** From `pmo-portal/`, run `../scripts/with-db-lock.sh npm run e2e:serial -- --grep 'AC-PLC-007'` and verify the final output reports the selected test passed with no skipped result.
- [ ] **Step 3: Render Profile & preferences at 390px in English and Bahasa, in light and dark themes.** Capture the complete form, timezone search/open state, validation/error state, and success state; verify controls remain reachable, labels and inherited values do not clip, and feedback stays associated with its control.
- [ ] **Step 4: Record and graduate every rendered finding.** For any defect, add a test that fails against the rendered behavior, fix it, and rerender until the audited states are clean. Retain screenshots as task evidence rather than adding them to tracked docs.

### Task 10: Independent reviews, mutation check, full verification, and commit

**Files:**
- Review-only: the complete branch diff.

- [ ] **Step 1: Run the locale-parser mutation check.** Temporarily swap the locale's decimal/group separator selection in `parseMoneyInput`, run `src/lib/format.locale.test.ts` under `../scripts/with-test-lock.sh`, confirm the named `1.234` oracle fails, restore the implementation, and rerun that test green. Do not keep the mutation.
- [ ] **Step 2: Run three independent reviews.** Request spec conformance, code quality, and security/authorization review on the completed diff. Resolve every actionable finding within this signed scope; if a reviewer identifies a need for schema/auth/RLS changes, stop and report it to the Director before widening scope.
- [ ] **Step 3: Run the complete project gate.** From `pmo-portal/`, run `VITEST_MAX_WORKERS=3 npm run verify:locked`; read the full output and require every configured gate to pass. Run the locale acceptance journey from Task 9 after any review fixes.
- [ ] **Step 4: Check the final diff and commit only after green.** Confirm only intended files changed, `git diff --check` is clean, no public tracked additions contain PII/secrets/secret coordinates, and no unrelated generated files or lockfile changes exist. Commit on `codex/personal-locale`; do not push or open a PR.
- [ ] **Step 5: Send the Director the review packet.** Include branch and commit IDs, changed-file list, exact verification output, the acceptance journey result, rendered Discover screenshot paths/states, review outcomes, and any remaining risk or limitation.
