# Shared project money position (#1081)

Owner-approved v0.23.0 scope, revalidated 2026-10-18. Targets dev.

When checking a project, users need the same Actual, mapping coverage and contract remaining after cost in the header, Overview and Project finances. Preserve existing financial behavior and cash/settlement separation; disable demand from a hidden header observer.

## Requirements (EARS)

- **FR-PMP-001** When any named consumer derives Actual or mapping coverage, it shall consume one pure `buildProjectMoneyPosition` exported by `src/lib/projectFinances.ts`, retaining the existing `deriveActualPosition` primitive and completeness semantics.
- **FR-PMP-002** When header/Overview compares Actual with contract or Active budget, it shall consume the builder's exact remainder, sign, comparable Actual and rounded percentage. Currency mismatch or incomplete money remains unavailable; genuine zero remains zero. No conversion or new clamp.
- **FR-PMP-003** While the header money strip is hidden, its existing query observer shall have demand disabled. When visible, it shall retain current org/project/permission gating. The hook is always called, with optional `{ enabled?: boolean }`; default true, same existing key and return.
- **FR-PMP-004** When another permitted Overview/section observer needs the shared reading, disabling the header observer shall preserve that request, mount, cached data and refetch/invalidation semantics. Pipeline Overview still mounts its Project finances section.
- **FR-PMP-005** While readings are pending, failed, partial, empty or cached, current labels, state precedence, formatting, dates, provenance, retry and section-specific coverage placement shall remain unchanged.
- **FR-PMP-006** When status/role/context changes, current `projectStatusGroup`, `hasFinanceView(realRole)` and permission gates shall continue to determine placement and eligibility. Delivery is on-hand plus internal, including Close Out.
- **FR-PMP-007** While receipt-backed cash is present, its fields/states and separate settlement display shall remain unchanged. Current contract is `ProjectReceiptCash` / optional `cash_received`; AC-UWC-009 is already shipped, not future work.
- **NFR-PMP-001** The builder shall be deterministic, mutation-free, request-free, translation-free and directly unit-testable. No SQL, DAL, dependencies, query identity, permissions, locale or design-token changes.
- **NFR-PMP-002** Existing test files/assertions shall remain byte-identical to the execution base. New tests shall bind to real builder/hook/callers; do not duplicate money implementations.

## Exact interface

```ts
type ProjectMoneyPositionInput = {
  projectCurrency: string; contractValue: number | null; activeBudget: number | undefined;
  ledgerBasis: ActualPosition['basis']; committedSpend: number | undefined;
  commitmentPending: boolean; commitmentError: boolean;
  actuals: ProjectFinances['actuals'] | undefined;
};
type ProjectMoneyPosition = {
  actual: ActualPosition;
  headlineState: 'available' | 'loading' | 'partial' | 'unavailable';
  coverage: { kind: 'pmo' | 'complete' | 'partial' | 'unavailable'; mapped: number; total: number };
  comparableActual: number | null; contractAfterCost: ExactMoney | null;
  contractAfterCostTone: 'neg' | 'pos' | undefined; spendPercent: number | null;
};
export function buildProjectMoneyPosition(input: ProjectMoneyPositionInput): ProjectMoneyPosition;
export function useProjectFinances(projectId: string, options?: { enabled?: boolean });
```

Use existing exact-money primitive for contract subtraction. Coverage means mapping coverage: all mapped with a missing amount still has complete mapping coverage but incomplete money. Headline precedence remains available → PMO loading → unmapped/restricted partial → unavailable. Preserve PMO successful empty PO zero, ERP empty category unavailable, restricted marker, ERP source currency display, and separate budget pending/error/no-positive-Active precedence. Source permissions select inputs before builder invocation. Section retains its own loading/error early returns and setup guidance.

## Acceptance (Given / When / Then; all Vitest/RTL owning)

| AC | Criterion | Owning file under pmo-portal |
|---|---|---|
| AC-PMP-001 | Given PMO/ERP/unavailable, zero/nonfinite/null and complete/empty/unmapped/missing-amount/restricted categories, when real builder runs, then source/completeness/headline/coverage match current semantics and inputs stay unchanged. | new `src/lib/projectMoneyPosition.test.ts` |
| AC-PMP-002 | Given decimals 0.30−0.10, negative/zero remainder, missing contract, currency mismatch and absent/zero/positive budget, when comparisons run, then exact remainder/sign and existing rounded ratio survive; unusable operands remain null. | same unit file |
| AC-PMP-003 | Given current ERP/PMO fixtures and real role placements, when real consumers render, then established Actual/coverage/remainder/spend text and section-specific presentation remain unchanged in en/id. | new `pages/project-detail/__tests__/ProjectMoneyPosition.parity.test.tsx` |
| AC-PMP-004 | Given cold isolated pipeline/lost header, when mounted with real hook and mocked repository, then no finance repository call starts; delivery finance-forward positive control starts normally. | new `pages/project-detail/__tests__/ProjectDetailHeader.financeDemand.test.tsx` |
| AC-PMP-005 | Given enabled/disabled observers sharing current key, when toggled, invalidated or supplied warm cache, then disabled-only demand starts nothing and visible demand/cache continues normally, including missing context/denied roles. | new `src/hooks/useProjectFinances.enabled.test.tsx` |
| AC-PMP-006 | Given permitted pipeline Overview plus disabled header, when rendered, then Project finances remains visible and can fetch; Engineer retains current PMO and permission behavior. | new parity file |
| AC-PMP-007 | Given state/currency edge cases and current known/incomplete/invalid cash, when surfaces render, then cash, settlement and Actual remain separate and no missing amount becomes zero. | new parity file; existing AC-UWC-009 unchanged |

