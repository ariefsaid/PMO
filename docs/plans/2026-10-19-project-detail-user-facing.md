# #1044 — user-facing project details: design and implementation plan

**Execution status:** planning only; no application changes or test-run claims. Spec: [project-detail-user-facing.spec.md](../specs/project-detail-user-facing.spec.md). Source baseline: `cbacb2a0`. Owner defaults remain proposed, not signed off.

## Design decisions

1. **Reduce the default canvas, not the truth.** Keep known money, incomplete qualifiers, business identities and actionable failures. A blank integration panel is not useful delivery information; an unknown amount is not zero. Use the shipped `buildProjectMoneyPosition`, exact formatter, projection rows and existing fiscal-year ladders without recomputing them.
2. **Role presentation is not authorization.** Read `realRole` through `useEffectiveRole()` for Finance/Admin disclosure eligibility. Use `usePermission()` for every action/destination. Current Finance access produces an Admin handoff, not an accounting-setup link. Executive remains delivery-facing by recommended default.
3. **One unsolicited setup prompt.** Overview owns the category-setup prompt. Accounting-project review is closed by default. On Budget, repeated setup categories share one default prompt; per-year failure consequences and recovery controls remain visible. Do not diagnose missing configuration from loading/error/no-reading alone.
4. **Local composition over a new framework.** Finance presentation stays in its component; project-only disclosure is opt-in in the shared review component; task-card unused-state handling stays local. Use native `details`/`summary`. A two-value optional badge prop limits the adjacent copy change to opted-in callers. Do not create a global notice bus, permission registry or generic integration-state engine.
5. **Small, independently releasable PRs.** Five slices below can land independently; each supplies its own locale keys and tests. No slice imports a new module from another slice. Shared locale files and the existing `BudgetTab.test.tsx` regression run are coordination surfaces, not a new runtime dependency; rebase locale edits immediately before each PR. Do not mass-rename existing keys used by unrelated callers.
6. **No architectural change requiring an ADR.** This follows existing authorization, repository and disclosure patterns. There is no new schema, API, cache contract or irreversible decision. A later Finance permission change or statement-view redesign needs separate review, not an incidental ADR here.

### Owner sketch-glance (pending, before build)

The proposed shape is deliberately unchanged: **Overview:** business totals → one spending-availability/setup line → useful category disclosure; accounting-project details are a separate closed Finance/Admin disclosure in the existing rail/location. **Tasks:** native work first; an unused connection has no non-Admin footprint. **Budget:** forecast and actionable year outcomes → versions; technical accounting detail is closed. At 390px the same single DOM stacks in that order; no alternate duplicated status cards. Obtain the owner's ~30-second shape check and spec sign-off before build. The present docs request does not imply either approval.

### Components and data flow

- Overview: existing project-finance query + committed-spend query → existing shared money builder → existing totals → local display flags and native disclosure. `row.mapped` identifies a known category-setup gap; `as_of === null` identifies absence of a reading, not its cause. No client-supplied tenant parameter is added.
- Project link: `ProjectErpLink` reads the real-role seam and mounts shared review only for Finance/Admin. `ProjectMatchReview` retains its binding/project queries and exact match engine; optional framing wraps its loading/error/success content. Candidate reads remain gated by the existing explicit review action. Administration callers default to the original frame.
- Tasks: existing `useIntegrations()` result supplies successful organization/project-binding states. Only a settled, unused connection becomes hidden/collapsed. Saved links and uncertain reads stay visible. Project/task queries and mutations are unchanged.
- Budget: existing active-binding gate → existing year-scoped projection. Derive display-only missing-category lists in one O(n) pass, retain summary arithmetic and row values, and associate grouped explanation with the table. Keep failed/held outcomes outside quiet provenance.
- Adjacent records: local copy and opted-in badge vocabulary only. All write payloads, retries, command identities and classified errors retain their current code path.

### Error and performance boundaries

Do not treat empty cached arrays as successful reads. Require success flags before hiding optional integrations; keep stale saved links and retries on failed refresh. Avoid a second binding hook in `ProjectErpLink`: its shared child already reads the binding with a project-specific cache key. No new per-category reads, polling, cached derived totals, numeric conversions or candidate prefetch. Native disclosures add no duplicate mobile/desktop component trees. Category scans are O(n), independent of invoice/history size; do not traverse/paginate any new history for presentation.

No data/schema tasks exist. Therefore no migration or rollback migration, policy, RPC or `org_id` change is needed. Keep repository/RLS tenancy seams unchanged. Each code slice rolls back by reverting its presentation commit; nothing persisted requires repair.

## Test ownership / traceability

Every title includes the exact issue-qualified AC token. Parameterized cases may share one canonical AC; all are at the same owning layer. Existing proofs keep their original AC IDs and goal oracles. A deliberate disclosure step may change navigation steps, never the matching/money goal.

All paths below are relative to `pmo-portal/`.

| AC | Canonical owning test (unit/RTL) | Implementation tasks |
|---|---|---|
| AC-1044-001 | `pages/project-detail/ProjectFinancesSection.test.tsx`: `AC-1044-001 one setup prompt follows the real role and accounting capability` | 1,2 |
| AC-1044-002 | same: `AC-1044-002 category detail preserves known zero and hides configuration-only rows` | 3,4 |
| AC-1044-003 | same: `AC-1044-003 uncertainty never becomes setup diagnosis or zero money` | 5,6 |
| AC-1044-004 | `pages/project-detail/__tests__/ProjectErpLink.test.tsx`: `AC-1044-004 project accounting detail is role-scoped and closed` | 7,8 |
| AC-1044-005 | `src/components/integrations/ProjectMatchReview.test.tsx`: `AC-1044-005 framing preserves explicit match identity and cancellation` | 9 |
| AC-1044-006 | `src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx`: `AC-1044-006 confirmed unused task connection is unobtrusive` | 10,11 |
| AC-1044-007 | same: `AC-1044-007 saved links and uncertain reads retain useful actions` | 12 |
| AC-1044-008 | `pages/BudgetProjection.test.tsx`: `AC-1044-008 grouped spending explanation preserves forecast inputs` | 13,14 |
| AC-1044-009 | same: `AC-1044-009 year outcomes and permitted recovery stay visible` | 15,16 |
| AC-1044-010 | `pages/project-detail/tabs/BudgetTab.test.tsx`: `AC-1044-010 optional forecast retains native budget and binding states` | 17 |
| AC-1044-015 | `pages/BudgetProjection.test.tsx`: `AC-1044-015 empty forecast remains distinct from pending and failed reads` | 18 |
| AC-1044-011 | `pages/ProjectBudget.test.tsx`: `AC-1044-011 business version identity survives clearer revision wording` | 19 |
| AC-1044-012 | `pages/__tests__/SalesInvoices.vocabulary.test.tsx`: `AC-1044-012 invoice wording preserves historical and cancellation meaning` | 20,21 |
| AC-1044-013 | new `pages/procurement/__tests__/ProjectInternalsPresentation.test.tsx`: `AC-1044-013 record progress and document identity use business vocabulary` | 22,23,24 |
| AC-1044-014 | new `pages/project-detail/__tests__/ProjectUserFacingDetails.test.tsx`: `AC-1044-014 localized disclosures are accessible without extra reads` | 25,26 |

**No new pgTAP/e2e AC:** no new server contract is introduced. Existing curated project-finances, project-match, invoice and procurement journeys remain regression evidence for their original contracts. Do not add a serial browser suite for label/count assertions. The composed AC-014 fixture renders real frontend components with mocked repositories, not live services.

## Command conventions — exact commands

Start at repository root. Each targeted command below uses the machine-global test lock. RED means run the listed command after adding the named assertions and record its assertion failure; GREEN means run the identical command after the specified implementation and keep every pre-existing oracle intact.

```bash
# Finance-section inner loop (F)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/ProjectFinancesSection.test.tsx'
# Accounting project inner loop (L)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/__tests__/ProjectErpLink.test.tsx src/components/integrations/ProjectMatchReview.test.tsx'
# Task connection inner loop (T)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx'
# Projection inner loop (P)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/BudgetProjection.test.tsx'
# Budget mounting/version inner loop (B)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/tabs/BudgetTab.test.tsx pages/ProjectBudget.test.tsx'
# Invoice inner loop (I)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.vocabulary.test.tsx'
# Adjacent record inner loop (R)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/tasks/TaskPushBadge.test.tsx pages/procurement/__tests__/ProjectInternalsPresentation.test.tsx'
# Composed presentation inner loop (C)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/__tests__/ProjectUserFacingDetails.test.tsx'
# Locale completeness (J)
(cd pmo-portal && npm run check:i18n)
```

The command letters below refer to these exact commands, not a different unspecified verification. Scope/time estimates are per numbered task; every behavior task is RED→GREEN. If a task exceeds five minutes, split its parameter rows/copy substitutions at the listed file boundary without changing its AC.

## Slice A — Overview spending presentation (tasks 1–6)

**PR scope:** `ProjectFinancesSection.tsx`, its test, `tabs/OverviewTab.tsx`, real EN/ID catalogues. No money library or query-hook edits.

### 1. Role/setup audience test and display flags (4 min, AC-1044-001)

In `pages/project-detail/ProjectFinancesSection.test.tsx`, replace the single setup-permission mock assumption with real `usePermission()` backed by a controllable real-role provider. Keep the existing `h.query`/`h.commitments`, `payload()` and i18next fixture. Parameterize Admin, Finance, Project Manager, Engineer and Executive; use the same unmapped-category payload for all. Assert one setup instruction, the exact destination or no destination, and no second instruction. Add a view-as case retaining the actual role's capability. RED: **F**.

In `ProjectFinancesSection.tsx`, import `useEffectiveRole` and add these display-only flags after hooks (remove the old `canReviewSetup` flag):

```tsx
const { realRole } = useEffectiveRole();
const canInspectAccounting = realRole === 'Finance' || realRole === 'Admin';
const canManageAccounting = may('manage', 'orgAccounting');
// Place after data/actuals/moneyPosition are available:
const needsCategorySetup = actualPosition.basis === 'erp' &&
  actuals.categories.some((row) => !row.mapped);
```

Do not change `moneyPosition`, `money()`, request parameters or permissions. GREEN: **F** (the prompt assertions become green in task 2; retain the recorded RED until then).

### 2. One setup prompt, not a role-inaccessible handoff (3 min, AC-1044-001)

In `ProjectFinancesSection.tsx`, replace only the current `!completeCoverage` setup-link/handoff branch:

```tsx
{needsCategorySetup && canInspectAccounting && (
  <p className="text-xs text-muted-foreground" data-testid="spending-setup-prompt">
    {canManageAccounting
      ? <Link className="font-medium text-primary underline-offset-4 hover:underline"
          to="/administration/accounting#budget-account-map">
          {t('projectUserFacing.finishSpendingSetup', 'Finish spending setup')}
        </Link>
      : t('projectUserFacing.spendingAdminHandoff',
          'Ask an administrator to finish spending setup.')}
  </p>
)}
```

Add matching EN/ID values from the spec's copy table under the new `projectUserFacing` namespace. Existing category/coverage text must not introduce additional setup actions. RED: **F** before replacement; GREEN: **F**, **J** after replacement. Exactly one `data-testid="spending-setup-prompt"` is allowed in this mounted surface.

### 3. Separate known category readings from configuration-only rows (5 min, AC-1044-002)

First add fixtures in `ProjectFinancesSection.test.tsx` with zero known values, and with zero/positive/unmapped rows. Check disclosure absence for PM/Engineer when no known values exist; check closed disclosures, known zero, partial qualifier and Finance missing-category detail. RED: **F**.

In `ProjectFinancesSection.tsx` derive, without converting decimals:

```tsx
const knownCategories: typeof actuals.categories = [];
const unavailableCategories: typeof actuals.categories = [];
for (const row of actuals.categories) {
  const known = row.mapped && actuals.currency !== null &&
    formatExactMoney(row.amount, actuals.currency, i18n.language) !== null;
  (known ? knownCategories : unavailableCategories).push(row);
}
```

The partition above is O(n). Keep the existing table/caption/header markup, but render the normal category disclosure only for `knownCategories.length > 0`, iterate those rows and always call the existing `money(row.amount, actuals.currency)`. Its sum is **not** a new project total. Do not move the total into this disclosure. GREEN: **F**.

### 4. Finance-only unavailable-category detail (4 min, AC-1044-002)

Add a test that PM/Engineer cannot discover missing setup rows even after opening their known-category disclosure; Finance/Admin can open setup details and see each unavailable category once. RED: **F**.

Below the normal category disclosure, render:

```tsx
{actualPosition.basis === 'erp' && canInspectAccounting &&
 unavailableCategories.length > 0 && (
  <details className="min-w-0">
    <summary className="cursor-pointer text-sm font-medium">
      {t('projectUserFacing.spendingSetupDetails', 'Spending setup details')}
    </summary>
    <ul className="mt-2 list-disc pl-5 text-sm">
      {unavailableCategories.map((row) => <li key={row.category}>
        {budgetCategoryLabel(row.category as Parameters<typeof budgetCategoryLabel>[0], t)}
        {' — '}{row.mapped
          ? t('projectUserFacing.noSpendingReading', "Spending hasn't been updated yet.")
          : t('projectUserFacing.categoryNeedsSetup', 'Spending setup is not complete for this category.')}
      </li>)}
    </ul>
  </details>
)}
```

Add ID `Penyiapan pengeluaran untuk kategori ini belum selesai.` for `categoryNeedsSetup`; other translations are in the spec. This is investigation, not another setup prompt/link. GREEN: **F**, **J**.

### 5. Uncertainty copy and financially meaningful regressions (5 min, AC-1044-003)

Add the AC-003 parameter matrix in the finance-section test: query pending, query error with Retry, mapped/no reading, restricted data, incompatible currencies, missing outstanding, known zero, receipt cash vs settled invoice. Bind all assertions to the shipped component/shared builder; preserve existing money expectations. Assert a missing reading with all `mapped: true` has no setup prompt. RED: **F**.

Replace the *local* missing-outstanding label with `projectUserFacing.invoiceBalanceUnavailable` from the spec. For ERP basis with `asOf === null`, use `projectUserFacing.noSpendingReading` once; do not add an extra timestamp placeholder. Keep restricted/partial qualifier and all formatter/builder branches. Replace the scope note with a new local key `projectUserFacing.invoiceScope`: EN `Only invoices linked to this project are included.`; ID `Hanya faktur yang ditautkan ke proyek ini yang disertakan.` Do not rewrite a widely reused translation key. GREEN: **F**, **J**.

### 6. Overview summary title and slice regression (3 min, AC-1044-003)

In `pages/project-detail/__tests__/OverviewTab.test.tsx` add a failing assertion that the existing budget card is named “Budget summary” while the known/unknown amounts and budget action still match the same fixtures. Keep this as supporting regression coverage, not a second AC owner. RED/GREEN command:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/__tests__/OverviewTab.test.tsx pages/project-detail/ProjectFinancesSection.test.tsx'
```

Change only the card title in `tabs/OverviewTab.tsx` to `projectUserFacing.budgetSummary`, EN `Budget summary`, ID `Ringkasan anggaran`. Do not modify `activeSnapshot`, Actual or variance derivation. Add the locale entries; run **J** and the same command GREEN.

## Slice B — Accounting project detail on demand (tasks 7–9)

**PR scope:** `ProjectErpLink.tsx`, `ProjectMatchReview.tsx`, their tests and two disclosure locale entries. No extra binding query or match-engine change.

### 7. Gate the project-local review by real audience (3 min, AC-1044-004)

Expand the role union and provider fixtures in `pages/project-detail/__tests__/ProjectErpLink.test.tsx`. Assert PM/Engineer/Executive have no project-code panel; Finance/Admin can inspect. Assert non-audience roles do not call `getBinding`, `getProject` or match mutations. RED: **L**.

Replace the wrapper in `ProjectErpLink.tsx` with this complete component (imports retain the existing shared review and auth locations):

```tsx
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { ProjectMatchReview } from '@/src/components/integrations/ProjectMatchReview';

export function ProjectErpLink({ projectId }: { projectId: string }) {
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  if (realRole !== 'Finance' && realRole !== 'Admin') return null;
  return <ProjectMatchReview projectId={projectId}
    orgId={currentUser?.org_id} projectDisclosure />;
}
```

Do not add `useErpnextBinding()` here. The optional prop's implementation follows in task 8; run **L** after that task completes (this short intermediate state is not a commit).

### 8. Frame every shared project-review state consistently (5 min, AC-1044-004)

In `ProjectMatchReview.tsx`, extend the existing props with `projectDisclosure?: boolean`, destructured with `= false`. After the existing hooks, before the current rendering guards, define:

```tsx
const frame = (content: React.ReactNode) => projectDisclosure
  ? <details className="min-w-0">
      <summary className="cursor-pointer text-sm font-medium">
        {t('projectUserFacing.accountingProjectDetails', 'Accounting project details')}
      </summary>
      <div className="mt-3 min-w-0">{content}</div>
    </details>
  : content;
```

Apply `frame(...)` to the existing loading, retry/error and final section return nodes, including project-read errors; keep `return null` for no organization, confirmed disconnected, and ineligible/unlinked pre-delivery project. Do not move hooks into branches or change query keys. Exact early-return source range is `ProjectMatchReview.tsx:260–318` at baseline. The final section is framed once, not once per row.

Before implementation extend AC-004 with successful disconnected, pending binding, failed binding and linked Finance fixtures; assert no empty heading on confirmed disconnect, initially closed details otherwise, keyboard opening and no candidate fetch merely on opening the outer disclosure. RED: **L**. Add EN/ID disclosure values from the spec. GREEN: **L**, **J**.

### 9. Preserve deliberate reviewed identity (5 min, AC-1044-005)

In `src/components/integrations/ProjectMatchReview.test.tsx`, extend `mount` with an optional `projectDisclosure` boolean defaulting false. Add AC-005 cases using true for the project and default false for the queue: open disclosure, open review, select the synthetic candidate, review exact old/new identity, cancel (no call), review again and confirm (one original-argument mutation). Assert default queue keeps its heading/candidate/ambiguity behavior without an outer disclosure. RED: **L**.

In the existing project wrapper tests, deliberately add the new disclosure-opening step before the original canonical-link/rematch assertions; retain all original href/old-target/new-target/mutation/create-path oracles. Replace the former Engineer-visible-link expectation with the approved role presentation assertion while keeping Finance read-only-link coverage. This is a deliberate UX change, not weakening an identity oracle. Fix any framing/toggle issue in `ProjectErpLink.tsx`/`ProjectMatchReview.tsx`; do not change match selection, proposal completeness, write arguments or error classification. GREEN: **L**.

## Slice C — Unused task connection without hiding task work (tasks 10–12)

**PR scope:** `ProjectIntegrationsCard.tsx`, its test and locale entries. No Tasks tab mount/query/mutation changes.

### 10. Explicitly distinguish settled unused from unknown (4 min, AC-1044-006)

In `src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx` add real hook-return fields `isSuccess`, `isPending`, `isError`, `isBindingsError`; set success explicitly in the baseline success fixture. Add AC-006 cases for every real role with no connection and no saved link. RED: **T**.

In `ProjectIntegrationsCard.tsx`, destructure the existing binding-query `isSuccess`, `isPending`, `isError`, `refetch` from `useIntegrations()` (do not introduce another hook). After all `useState` hooks and before rendering compute:

```tsx
const confirmedUnused = isSuccess && !isPending && !isError &&
  !isBindingsPending && !isBindingsError && !clickupConnected &&
  !projectClickUpBinding;
```

Use these display flags for task connection only. Project/task hooks remain unchanged. GREEN: **T** after task 11 implements the presentation (do not commit an intermediate red state).

### 11. Hide/collapse only the confirmed-unused card (4 min, AC-1044-006)

Before implementation assert exactly one Admin disclosure, no default setup warning for other roles, and no link mutation on opening it. RED: **T**.

At the main component return, before the normal existing card tree:

```tsx
if (confirmedUnused && !canManageIntegrations) return null;
if (confirmedUnused) return (
  <details className="min-w-0">
    <summary className="cursor-pointer text-sm font-medium">
      {t('projectUserFacing.taskConnection', 'Task connection')}
    </summary>
    <div className="mt-2">{renderNotLinked()}</div>
  </details>
);
```

Keep the existing Admin setup destination inside `renderNotLinked`; retain its `canManageIntegrations` condition. Translate the summary from the spec. No project task is inside this component, so hiding this card does not hide the task list. GREEN: **T**, **J**.

### 12. Unknown/error, saved-link and active-connection recovery (5 min, AC-1044-007)

Add cases for binding pending, binding error, saved project binding during organization refresh failure, active connection with no link, failed list refresh and incomplete initial transfer. Assert appropriate retry calls; no guessed “not connected”; the saved list and transfer-not-confirmed message remain; existing PM permitted matching and unlink confirmation still work. RED: **T**.

In `ProjectIntegrationsCard.tsx`, retain saved-link rendering first. When there is no saved link and organization binding is pending, render localized `ListState` loading. For binding error with no saved link, render the existing `ListState` error shape with `onRetry={() => void refetch()}` and EN `Couldn't check the task connection`, ID `Tidak dapat memeriksa koneksi tugas`. Use existing generic request-failed description; do not present disconnected setup as a diagnosis. Preserve binding/list-specific retries where a saved link exists. Do not call candidates/linking automatically. GREEN: **T**. Add translations and run **J**.

## Slice D — Budget explanation, not a forecast redesign (tasks 13–19)

**PR scope:** `BudgetProjection.tsx`, `ProjectBudget.tsx`, `tabs/BudgetTab.tsx`, their tests and local catalogue keys. No projection SQL, arithmetic, phase editor or money-helper changes.

### 13. Group repeated spending explanation (5 min, AC-1044-008)

Add AC-008 fixtures in `BudgetProjection.test.tsx`: all unmapped with a reading, mapped but unread, and partial known zero/positive spending with known budgets and cost-to-finish. Assert one grouped visible explanation, no repeated per-row setup sentence, valid amounts unchanged, unknown derived cells still unavailable and cost-to-finish editable. RED: **P**.

After `rows`/`translatedCategory` are available in `BudgetProjection.tsx`, derive one display list and render it above the table:

```tsx
const missingSpending = rows.filter((row) => row.actualsToDate === null);
const missingSpendingNames = missingSpending.map((row) => translatedCategory(row.category)).join(', ');
// Render only when nonempty, using the existing component's projectId:
const spendingStatusId = `forecast-spending-${projectId}`;
```

```tsx
{missingSpending.length > 0 && <p id={spendingStatusId}
  className="mt-2 text-xs text-muted-foreground">
  {t('projectUserFacing.missingSpendingCategories',
    'Spending is not available yet for: {{categories}}.', { categories: missingSpendingNames })}
</p>}
```

Add `aria-describedby={missingSpending.length ? spendingStatusId : undefined}` to the existing table. For `visibleReasonFor`, return `null` for missing spending (covered by the grouped line); keep the existing budget-year/phasing explanation branch. Keep individual null cells and their distinct accessible reasons. ID value: `Pengeluaran belum tersedia untuk: {{categories}}.` GREEN: **P**, after task 14 updates the deliberate reason wording/assertions.

### 14. Plain accessible reasons and Finance setup investigation (5 min, AC-1044-008)

First assert that no accessible null-cell reason requires interpreting ERP/account-map vocabulary, and that unread vs setup gaps remain distinguishable. Assert that partial totals are never inferred from known rows alone. RED: **P**.

Replace local missing-spending strings, not financial branches: `NO_ERP_ACCOUNT` becomes a translated component-local string with EN `Spending is not available for this category yet.`, ID `Pengeluaran untuk kategori ini belum tersedia.`; `NO_LEDGER_READING` becomes EN `Spending has not been updated for this project and year yet.`, ID `Pengeluaran untuk proyek dan tahun ini belum diperbarui.` Move only these two constants into the component so they can call `t`; keep budget-reason sentinels used by equality checks unchanged.

For Finance/Admin, append a closed “Spending setup details” disclosure listing only rows with `actualsToDate === null && actualsAsOf !== null`; the existing projection contract identifies these as setup gaps. Show unread rows separately as no-reading, never as a map gap. Reuse existing `translatedCategory`. Known rows do not enter this list; preserve their table values. Call `useEffectiveRole()` unconditionally with the other hooks and use its `realRole`, not an impersonated role, for this disclosure only. Update old visible-row-reason assertions to inspect the grouped explanation and per-cell reason, retaining their category/unknown/amount goal. GREEN: **P**, **J**.

### 15. Keep per-year consequences, simplify quiet provenance (5 min, AC-1044-009)

Extend existing `AC-BFY-026` fixtures under AC-009: two years with different outcomes, retryable failure, held releasable work, stale attribution and no recorded year. Assert failed consequences/retry/release outside closed details; technical `erpBudgetName` only in Finance/Admin accounting details. RED: **P**.

Wrap the existing quiet sources/status `<details>` in the real Finance/Admin display check and rename its summary with a local key to “Accounting details” / `Detail akuntansi`. Keep the visible selected year and spending update date outside it. Do not move `blockedRows.map` or its controls. For a non-Finance/Admin viewer, render a concise non-technical per-year quiet statement only when needed to avoid hiding an in-progress/known outcome; preserve the fiscal year with each statement.

Use these local quiet-state labels/details in `QuietPushStatus` and the delivery summary (add a `technical?: boolean` prop default true; `erpBudgetName` renders only when true):

| state | EN label / detail | ID label / detail |
|---|---|---|
| pending | Waiting to send / This budget has not been sent yet. | Menunggu pengiriman / Anggaran ini belum dikirim. |
| pushing | Sending budget / This budget is being sent now. | Mengirim anggaran / Anggaran ini sedang dikirim. |
| pushed | Spending limit in effect / The accounting system is applying this budget. | Batas pengeluaran berlaku / Sistem akuntansi menerapkan anggaran ini. |

This states accounting enforcement, not approval or forecast certainty. Keep stale-attribution warning with its year and phasing remedy; do not label a failed year as enforced because another succeeded. Replace only the local blocked headline/description strings with these exact EN/ID pairs (do not edit the shared error classifier):

- Never arrived headline: `No accounting spending limit is in effect for this project.` / `Belum ada batas pengeluaran akuntansi yang berlaku untuk proyek ini.`
- Previous-limit headline: `The previous budget is still the accounting spending limit.` / `Anggaran sebelumnya masih menjadi batas pengeluaran akuntansi.`
- Never-sent detail: `This budget has not been sent, so it is not being used as the accounting spending limit.` / `Anggaran ini belum dikirim sehingga belum digunakan sebagai batas pengeluaran akuntansi.`
- Unstamped-version detail: `This version cannot be sent. Create a revision with “Clone to revise”, then activate it.` / `Versi ini tidak dapat dikirim. Buat revisi dengan “Salin untuk direvisi”, lalu aktifkan.`

Retain the unstamped version's existing named-control remedy and correct year; localize it with the same business wording rather than exposing activation bookkeeping. GREEN: **P**, **J**.

### 16. One capability-appropriate category setup remedy (5 min, AC-1044-009)

Add a role matrix on the existing unmapped-category failure fixture: Admin gets one anchored setup link, Finance one Admin handoff, delivery readers no configuration task; year-specific consequence and existing permitted retry/release remain. For two failed years with the same category cause, assert exactly one **setup prompt**, while preserving two consequences/two valid recovery controls. RED: **P**.

In `BudgetProjection.tsx` hoist setup-prompt rendering outside `blockedRows.map`. Derive the union of category names only from rows whose **current** `describePushError(row.pushError).code === 'budget-category-unmapped'`; never reuse stale categories from a different error. Use `new Set<string>()`, and preserve per-year failures and their current classifiers.

Add typed prop `showCategorySetup?: boolean` default true to `BlockedPushStatus`; project forecast passes false so its row does not repeat setup list/link **or the classifier's category-setup remedy**. Keep non-category remedies unchanged. For the category-gap message use a local EN `This budget cannot be used as a spending limit until spending setup is finished.` / ID `Anggaran ini belum dapat digunakan sebagai batas pengeluaran hingga penyiapan pengeluaran selesai.` This is a consequence, not an instruction to a delivery reader. Render a single default Finance/Admin category setup block before blocked rows, with the union category list in closed setup detail and exactly the same Admin action/Finance handoff vocabulary and `may('manage','orgAccounting')` predicate specified in the spec. This slice uses its own local copy entries and existing hooks, not a module from Slice A. Keep a plain availability/consequence sentence for other readers. Do not change `offerRetry`, `offerRelease`, error classification, variables or mutation arguments. GREEN: **P**, **J**.

### 17. Optional forecast stays optional for the reader (4 min, AC-1044-010)

In `tabs/BudgetTab.test.tsx`, extend the real-role fixture and binding-state matrix. Preserve unconditional PMO budget and fail-closed active-binding gate assertions; add no dormant explanation for delivery roles and one collapsed Admin connection hint on confirmed inactivity. RED: **B**.

In `tabs/BudgetTab.tsx`, leave the active-binding condition unchanged. Import and call `usePermission()` with the other hooks. Gate only the current inactive-connection explanation by `may('manage','integration')` and put it in a closed “Accounting details” disclosure. The current hint has no link: retain that fact, rather than inventing a setup destination. Do not render a setup explanation while binding is pending/error; do not invent a new setup route. Finance does not become an integration manager. GREEN: **B**.

### 18. Successful empty forecast, not an activation instruction (4 min, AC-1044-015)

In `pages/BudgetProjection.test.tsx`, add AC-015 using its existing repository/Toast/Bahasa fixtures: resolve rows to `[]`, test supplied-year and no-year results, then use pending and rejected query fixtures. Assert one neutral empty line, no empty grid, and distinct pending/error Retry behavior. AC-010 separately proves the native budget stays mounted. Do not copy projection logic into a mocked component. RED: **P**.

Replace only the projection's `rows.length === 0` `ListState` body with a quiet paragraph using supplied year, not a synthesized calendar year: EN `Forecast figures are not available for {{year}} yet.` / ID `Angka prakiraan untuk {{year}} belum tersedia.`; when there is no supplied year use EN `Forecast figures are not available yet.` / ID `Angka prakiraan belum tersedia.` Keep any genuine blocked outcomes above it. No generic “activate/push” imperative. GREEN: **B**, **P**, **J**.

### 19. Expand revision shorthand without rewriting history (4 min, AC-1044-011)

In `ProjectBudget.test.tsx`, add a fixture whose stored name is `Imported plan v1`, plus existing Draft/Active/Archived/sole-operator fixtures. Assert “Version N”, unchanged name/status/qualifier, correct amounts and original activation/archive/clone permissions. RED: **B**.

In `ProjectBudget.tsx:521–527`, replace only the revision span content `v{version.version}` with `t('projectUserFacing.budgetVersion', 'Version {{number}}', { number: version.version })`. Replace the picker text at baseline 1009 with `` `${t('projectUserFacing.budgetVersion', 'Version {{number}}', { number: v.version })} · ${v.name}` ``. In `versionLabel` at baseline 761–763 replace only its synthesized `(vN)` suffix with `` `(${t('projectUserFacing.budgetVersion', 'Version {{number}}', { number: v.version })})` ``; keep `v.name` and the unknown-ID fallback unchanged. Update deliberate dialog-label assertions to require the same exact name and numeric identity under the expanded label, not merely a dialog's existence. Do not alter user-supplied name text or underlying version number/value. Do not rename meaningful Draft/Active/Archived status or hide the activation qualifier. ID `Versi {{number}}`. GREEN: **B**, **J**.

## Slice E — Same-pattern invoice/procurement wording (tasks 20–24)

**PR scope:** local invoice/procurement labels, opt-in badge vocabulary, two callers, tests and new locale keys. No lifecycle/write-path edits.

### 20. Historical invoice and register wording (5 min, AC-1044-012)

In `SalesInvoices.vocabulary.test.tsx`, make the mocked sales-invoice result/mode controllable (currently hardcoded empty), reuse typed synthetic historical/carryover fixtures from `pages/__tests__/SalesInvoices.native.test.tsx`, and add assertions for the historical badge, explanation, original carryover amount/date and absence of disallowed actions. Test both locales. RED: **I**.

In `SalesInvoices.tsx`, replace the register's accounting-connected subtitle, historical badge/explanation and opening-balance note with new `projectUserFacing` keys and exact spec values. Keep the standalone-mode subtitle unchanged, current `preErp` predicate, frozen actions and carryover conditions/formatters unchanged. Historical invoice identity stays visible. GREEN: **I**, **J**.

### 21. Cancel consequence and invoice progress/item copy (5 min, AC-1044-012)

First add a permitted cancellable fixture and open the real existing cancellation confirmation from its menu; assert the irreversible business consequence, no numeric protocol transition, cancel-before-confirm means zero mutations, and confirm retains existing arguments. Add draft progress/item label assertions and unavailable-total assertion. RED: **I**.

In `SalesInvoices.tsx`, replace only the connected-invoice cancellation `description` string at baseline 1209 with the spec's exact cancel consequence under `projectUserFacing.cancelInvoiceConsequence`. Do not change the native-invoice description or predicates. Replace visible draft progress at 1473 with “Sending invoice…” / `Mengirim faktur…`, and the item field/noun at 1533/1539 with local “Item”. Keep item option identity and the existing tax/final-total-unavailable branch. Add all EN/ID entries together. GREEN: **I**, **J**.

### 22. Opt-in business write-status badge (5 min, AC-1044-013)

Create `pages/procurement/__tests__/ProjectInternalsPresentation.test.tsx`. Its canonical AC-013 parameterized test initially renders the real badge with the new optional prop and all four states under real EN/ID catalogues; assert idle absence, exact visible/AT state, retained classified error and no claim of client delivery. RED: **R**.

In `src/components/tasks/TaskPushBadge.tsx`, extend the interface:

```tsx
export interface TaskPushBadgeProps {
  state: PendingPushState;
  vocabulary?: 'technical' | 'business';
}
```

Default to `technical`. Call `useTranslation()` before the existing idle early return. Derive `business = vocabulary === 'business'`; replace only the three labels/aria/title choices on that branch. Business labels use the exact spec states. Generic titles EN `The change is being sent.` / `The change was sent.` / `The change could not be sent.`; ID `Perubahan sedang dikirim.` / `Perubahan telah dikirim.` / `Perubahan tidak dapat dikirim.` Keep specific classified error headline/detail when present; the business failure accessible name is localized “Couldn't send: {{reason}}” / `Tidak dapat mengirim: {{reason}}`. If no specific error exists, do not duplicate the generic failure label. Keep icon/tokens/register/state enum and the entire technical-default copy contract. Existing `TaskPushBadge.test.tsx` stays green without rewriting its assertions. GREEN: **R**, **J**.

### 23. Opt in only the two audited callers (3 min, AC-1044-013)

Extend the canonical record presentation test to render `ProcurementDecisionZone` with its existing idle/pending mutation fixture, assert business badge wording and unchanged original create callback arguments. Supporting task-tab tests assert the project-task badge uses the same prop. RED command:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/procurement/__tests__/ProjectInternalsPresentation.test.tsx pages/project-detail/__tests__/TasksTab.pendingPush.test.tsx src/components/tasks/TaskPushBadge.test.tsx'
```

Add `vocabulary="business"` to the `TaskPushBadge` invocation(s) in `pages/project-detail/tabs/TasksTab.tsx` and `pages/procurement/ProcurementDecisionZone.tsx` only. Do not change other badge callers or route/write selection. GREEN: identical command.

### 24. Business document and project-purchase scope labels (4 min, AC-1044-013)

Extend the real ledger fixture in the canonical record test to assert the unchanged synthetic document number under “Document number”, with both locales. Supporting `pages/project-detail/__tests__/ProcurementTab.newrequest.test.tsx` asserts its scope sentence still excludes purchases not created in PMO. RED: **R**, plus:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/__tests__/ProcurementTab.newrequest.test.tsx'
```

In `ProcurementLedger.tsx`, change `LedgerHeader`'s existing system-number conditional arm to `translationKey === 'projectUserFacing.documentNumber' ? t('projectUserFacing.documentNumber', 'Document number')`; change the static system-number column header to `<LedgerHeader translationKey="projectUserFacing.documentNumber" fallback="Document number" />`. The discriminator and catalogue key must agree; changing only the fallback would still select the old branch. Keep column key/cell/identity unchanged. In `tabs/ProcurementTab.tsx`, use a local `projectUserFacing.purchaseRequestScope` key with the spec's exact scope text. Add EN/ID. Do not rename document kinds or vendor record numbers. GREEN: both commands, **J**.

## Acceptance composition and release work (tasks 25–29)

Tasks 25–26 are **test-only acceptance aggregation**, included in the lane-closing UI PR after the production slices. They introduce no new production behavior: tasks 1–24 own RED→GREEN before their implementations. Tasks 27–29 are verification/evidence tasks. None changes dependencies between the five production slices.

### 25. Composed role/localization contract (5 min, AC-1044-014)

Create `pages/project-detail/__tests__/ProjectUserFacingDetails.test.tsx`. Use `QueryClientProvider` with retries disabled, `ImpersonationProvider`, `MemoryRouter`, the real EN/ID finance i18next fixture, and mocked repository/hook results; mount real `ProjectFinancesSection`, `ProjectErpLink`, `ProjectIntegrationsCard` and `BudgetTab` **one selected-tab fixture at a time**. Do not copy component logic into the test. Use real Admin/Finance/PM/Engineer/Executive role cases and genuine zero/partial data from their existing test helpers.

Add assertions for initially closed summaries, no raw keys, one default setup prompt on the selected tab, correct Finance/Admin/PM audience and no duplicated responsive disclosure. Verify with **C**. The production behavior already had its failing component proof in tasks 1–24; do not manufacture a new RED or add a notice framework for this test-only aggregation. An unexpected failure is a blocker: retain its failing assertion and route the narrowly identified behavior back to its owning slice before acceptance.

### 26. Keyboard/axe and request-admission assertions (5 min, AC-1044-014)

Extend the test-only composed proof: Tab reaches the native summary, activating it toggles the disclosure, opening project accounting detail does not fetch candidates until “Review project match”, error Retry calls its existing refetch, and scoped finance hook/repository call counts do not increase by opening local details. Use axe on each selected-tab fixture in both locales; no arbitrary timing sleeps. Verify with **C**, **J**. Check native Enter activation additionally in rendered acceptance; do not emulate a browser's missing default keyboard action with production JavaScript just for a DOM test runner.

No production code is added in this task. A failing accessibility/request oracle blocks acceptance and returns to the responsible slice's RED→GREEN loop. Do not mock away axe findings or duplicate queries. The canonical composed test proves frontend interaction behavior, not service-side authorization.

### 27. Per-slice local gate evidence (3–5 min to dispatch/check each slice; no full-suite local run)

Before any code PR, run the local final gate under the required lock and record **output bodies**, not just exit codes:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
(cd pmo-portal && npm run check:i18n)
```

Run exact scoped lint command for the slice (include test files added by that slice):

```bash
# A
(cd pmo-portal && npx eslint --max-warnings=0 pages/project-detail/ProjectFinancesSection.tsx pages/project-detail/ProjectFinancesSection.test.tsx pages/project-detail/tabs/OverviewTab.tsx pages/project-detail/__tests__/OverviewTab.test.tsx)
# B
(cd pmo-portal && npx eslint --max-warnings=0 pages/project-detail/ProjectErpLink.tsx pages/project-detail/__tests__/ProjectErpLink.test.tsx src/components/integrations/ProjectMatchReview.tsx src/components/integrations/ProjectMatchReview.test.tsx)
# C
(cd pmo-portal && npx eslint --max-warnings=0 src/components/projects/ProjectIntegrationsCard.tsx src/components/projects/__tests__/ProjectIntegrationsCard.test.tsx)
# D
(cd pmo-portal && npx eslint --max-warnings=0 pages/BudgetProjection.tsx pages/BudgetProjection.test.tsx pages/ProjectBudget.tsx pages/ProjectBudget.test.tsx pages/project-detail/tabs/BudgetTab.tsx pages/project-detail/tabs/BudgetTab.test.tsx)
# E + lane closure
(cd pmo-portal && npx eslint --max-warnings=0 pages/SalesInvoices.tsx pages/__tests__/SalesInvoices.vocabulary.test.tsx src/components/tasks/TaskPushBadge.tsx pages/procurement/ProcurementDecisionZone.tsx pages/procurement/ProcurementLedger.tsx pages/procurement/__tests__/ProjectInternalsPresentation.test.tsx pages/project-detail/tabs/TasksTab.tsx pages/project-detail/tabs/ProcurementTab.tsx pages/project-detail/__tests__/TasksTab.pendingPush.test.tsx pages/project-detail/__tests__/ProcurementTab.newrequest.test.tsx pages/project-detail/__tests__/ProjectUserFacingDetails.test.tsx)
```

No DB change means no local reset or new pgTAP test. CI still runs the normal four unit shards, verify and pgTAP for every slice PR to `dev`; changed-code coverage must reach 80%. Never weaken tests to obtain green.

### 28. Rendered Discover and retained journey regression (5 min to initiate bounded review/evidence collection)

Use the project-rich local fixture, not an empty project, to render Overview, Tasks, Budget, invoice detail/cancel and procurement detail for the affected real roles at 390px and desktop; inspect both themes and EN/ID for changed copy. Check useful partial data, unknown figures, focus, closed disclosures, recovery controls and absence of repeated setup prompts. Save review evidence in the normal private handoff location; do not publish real customer values or access coordinates. Every finding graduates to an owning test, a `routes × oracles` matrix cell in `docs/qa-portfolio.md` and a `DESIGN.md`/`docs/decisions.md` retention note after resolution.

The canonical browser journeys are pre-existing; run touched ones through the shared wrapper, without reset because there is no migration/seed change:

```bash
scripts/e2e-local.sh AC-PFIN-016
scripts/e2e-local.sh AC-SETUP-001
```

The second journey is served-fixture-dependent; absence is **not a pass** and must be recorded as unavailable evidence, not silently skipped proof. No new live ERP calls are needed for presentation AC ownership. No invoice/procurement e2e file is edited by this plan: their presentation is owned by the named RTL proofs and the lane-closing CI integration run protects existing journeys. If build evidence reveals an affected e2e selector, amend this plan with its exact existing file, intentional step change and wrapper command before editing; preserve the user's goal. Run `scripts/check-e2e-isolation.sh` if an e2e file is edited; follow `docs/e2e-parallel-conventions.md` and retain its isolation class/cleanup. Do not expand this task into a local full-suite run.

### 29. Review and dev-only lane-closing gate (3 min orchestration task)

Before build dispatch, the Director chooses the executor per `docs/factory-workflow.md`: bounded FE presentation is the factory's default route, not permission for a planner to build it. Each slice gets spec/quality/security review; UI gets rendered Discover and graduated findings. Dispatch the browser integration gate only for the lane-closing PR through the logged `scripts/ci-e2e.sh` wrapper; observe shared concurrency caps and post-2–3-merge `dev` browser cadence. A red `dev` run stops merges. Require CI output showing required jobs green and Director merge approval. Dev is the ceiling; no production/main promotion is authorized. No owner checkpoint is invented between approved factory slices.

## Owner questions, recommended defaults, risks

- Finance setup authority? **Default:** unchanged, Admin handoff; never grant capability as a presentation fix.
- Executive technical detail? **Default:** delivery-facing; financial access remains unchanged.
- Empty services? **Default:** hide for non-Admin, one collapsed Admin action; uncertain/saved/failed operational states are not “unused”.
- Import wording in stored names? **Default:** keep names and meaningful version/status identities; only expand shorthand.
- Bigger statement/setup/form redesign? **Default:** separate follow-ups listed in the spec.

Largest risks: masking a real failure while reducing noise; confusing partial sums or known zero with unavailable; dropping per-year recovery; broad shared-badge or locale fallout. Guardrails are the named ACs, unchanged money/write paths, opt-in framing/vocabulary, changed-importer unit tests, rich rendered Discover and normal CI. These docs are not a claim that the implementation or visual acceptance has passed.
