# Management pack invoice presence (#1083)

Owner-approved v0.23.0 scope, revalidated 2026-10-18. Targets dev.

Finance needs earlier invoice presence to remain visible when eligible invoices have a zero net amount. Count the existing eligible source rows independently of their net amount; preserve the current eligibility and management-pack financial calculations.

## Requirements (EARS)

- **FR-MIP-001** When the existing RPC groups earlier eligible billed-work rows by project/currency, it shall include unchanged `net` plus required `invoice_count = count(*)::int`, counting before netting. +100/−100 gives net0/count2; eligible single zero gives net0/count1.
- **FR-MIP-002** When DAL parses an earlier group, it shall require a finite nonnegative integer count; missing/null/negative/fractional/string/nonfinite values throw existing `AppError` code `pack-malformed`. Empty aggregate array remains valid. No guessed default/net inference.
- **FR-MIP-003** When an earlier group's known project has different contract currency and count>0, builder shall mark it unreconciled independent of net, retain null backlog for every selected contract-month and propagate null to contract-currency backlog totals. Moving start across the billing month retains the existing in-window count behavior.
- **FR-MIP-004** While foreign presence is absent/count0, same-currency, another project, unassigned, or outside the existing counted relation, it shall not independently hide this project's backlog.
- **FR-MIP-005** When availability changes, all other formulas, eligibility, currency inclusion, recognition, schedule/progress, net/recovery, unbilled and unclamped balances shall remain unchanged. Specifically leave the separate RF-039 `if (f.net !== 0) invoiceCurrencies.add(f.currency)` unchanged. DD-MMP-3 and #1046 remain unchanged; S-35 handles its separately queued scope later.
- **FR-MIP-006** When null backlog reaches page/export, existing unavailable/reconciliation explanation and blank export cells shall remain, with no new controls/layout/FX.
- **NFR-MIP-001** The RPC shall keep exact signature/defaults, invoker attributes, org/active-member/read audience, project inclusion and1–24month normalization. No view/policy/grants/endpoints or browser invoice scan.
- **NFR-MIP-002** Migration0323 shall be reversible to actual pre-change function body; same existing SQL aggregate scan. No speculative index or schema/table addition.

Count the exact existing `counted` relation: own org; statuses Submitted/Unpaid/Paid; non-null source `w.net`; dated before exclusive month-after-to; not down-payment; report net=`w.net+w.recovery`. Zero/negative report values count. No new docstatus/cancelled-at/credit-kind predicates. Earlier carry-in has no year cutoff. Existing project inclusion (unarchived on-hand or billed in-window) stays; earlier facts alone do not add projects.

## Interface and file ownership

```ts
export interface PackFactsInvoicedBefore {
  project_id: string | null; currency: string; net: number; invoice_count: number;
}
```

RPC remains `get_management_pack(p_from date default null,p_to date default null) returns jsonb`; only earlier aggregate rows gain field. DAL/parser/repository/hook/range signatures stay. Builder changes only foreign-project earlier presence conditional to `f.invoice_count > 0`.

Create `supabase/migrations/0323_management_pack_invoice_presence.sql`, matching `rollback/0323_management_pack_invoice_presence_down.sql`, `supabase/tests/0323_management_pack_invoice_presence.test.sql`. Modify only `pmo-portal/src/lib/db/managementPack.ts` and `src/lib/reports/managementPack.ts` plus their tests, `pages/__tests__/ManagementPack.test.tsx`, `src/lib/reports/managementPackExport.test.ts`. Typed earlier fixtures currently exist in report unit file at lines57/118; add accurate counts without changing their oracles. No locale or generated-schema change is required for JSON-only RPC addition.

## Acceptance (Given / When / Then; inherited IDs)

| AC | Criterion | Lowest owning proof |
|---|---|---|
| AC-MIP-001 | Given eligible earlier +100/−100 and separate zero rows, when real RPC reads later window, then exact net/count are0/2 and0/1. | new0323 pgTAP |
| AC-MIP-002 | Given boundary/eligibility/org/down-payment/null-net/undated/other-stage/archived/unassigned controls, when real RPC reads, then existing counted relation/window/project selection stays exact, including1001-row server aggregation. | same pgTAP |
| AC-MIP-003 | Given earlier foreign net0/count2, when real builder runs, then all contract backlog cells and subtotal are null, and crossing selected start retains existing in-window presence. | report builder Vitest |
| AC-MIP-004 | Given each no-presence/count0/same-currency/other-project/unassigned control separately, when builder runs, then none alone hides this project's known backlog; in-window foreign count1/net0 still does. | report builder Vitest |
| AC-MIP-005 | Given valid0/2 and malformed count cases, when parser runs, then valid values survive and invalid cases throw pack-malformed before builder. | DAL Vitest |
| AC-MIP-006 | Given actual built earlier-zero-net pack, when page renders, then row/subtotal unavailable explanation survives with existing period controls. | existing page RTL extended |
| AC-MIP-007 | Given same real built pack, when export runs, then affected backlog cells are blank, not0/contract, with unchanged currency/net conventions. | existing export Vitest extended |
| AC-MIP-008 | Given current RF-039/DD-MMP-3 fixtures with explicit count, when builder runs, then earlier zero-only unassigned JPY totals remain omitted and all existing money oracles remain exact. | report builder Vitest |

