# Profit views: earned and billed revenue side by side

Issue #2733 (map #2516). Status: **Draft, 2026-11-21**. IDs: `FR-EBR-###`, `AC-EBR-###`.
Executor: Director-dispatched Orca worker; money read, ships alone. Plan `docs/plans/2026-11-21-earned-billed-revenue.md`.
**Money path: read-only derivation.** No posting, no recognition entry, no SoD change. Stacked on #2669
([discipline-profit](discipline-profit.spec.md)): reuses its setting, its revenue read (`basis` column) and its pure join.
Not in this ticket: statutory revenue recognition, ledger posting.

**Job story.** When I read the profit of a work order, a discipline or a project, I want revenue from work done and
revenue billed side by side, so I can see what the work has earned even where the claim has not gone out yet.

## 1. AS-IS
- Earned (validated daily progress at the contract rate frozen at validation) exists per work order
  (`work_order_validated_revenue`) and per discipline (`project_discipline_revenue`, basis `validated_progress`, #2669).
- Billed exists per work order (`work_order_billing`, `work_order_billing_lines`: invoices at billed work excl. tax, live
  unraised claims) and per project (`sales_invoice_work_billed`, the one definition shared with the management pack).
  Progress-claim lines (`progress_claim_lines`) carry a BoQ item and an amount, so billed can reach a discipline.
- Work-order and project profit (`pages/project-detail/WorkOrderPlanVsActual.tsx`) show billed revenue only. The pack
  (`get_management_pack`, `ManagementPack.tsx`) shows recognised, invoiced, unbilled; it carries no cost and no margin.

## 2. Definitions
- **Earned revenue**: as discipline revenue (#2669 §2): frozen amount of validated, non-superseded, non-archived progress
  lines. A work order with **no** validated line has earned "not available", never 0.00. A validated line frozen without a
  rate makes the figure "incomplete" (a floor, named), as in #2669.
- **Billed revenue**: claims and invoices excluding tax, exactly the figure the shipped work-order billing derivation
  gives (`work_order_billing_lines.billed`: down payments bill 0, withdrawn claims and cancelled invoices excluded).
  Per discipline: `progress_claim_lines.amount` of live claims (not withdrawn, invoice not cancelled), by the BoQ item's
  discipline; billed work that no claim line itemises is shown as "Not itemised", never spread over disciplines.
- **Gap** = earned - billed (positive: work done and not yet billed; negative: billed ahead of validated work). Shown
  only when both figures exist and share a currency.
- **Margin on a basis** = revenue on that basis - cost, with the one existing margin formula (`deriveMargin` semantics).
  Cost is unchanged from the existing views; only the revenue basis differs.

## 3. Requirements (EARS)
**Setting**
- FR-EBR-001 The feature shall sit behind the existing organisation setting `discipline_profit_enabled` (Admin-only,
  **off by default**). While off, no screen, read or total changes and every new read returns nothing.
**Reads**
- FR-EBR-010 Where on, one read per project shall return, per work order and currency: earned, earned-line count,
  unrated-line count, billed, and whether billed could be totalled. Same revenue-reader gate as `project_discipline_revenue`
  (Admin, Finance, Executive, the project's Project Manager; others refused 42501; other org's project absent).
- FR-EBR-011 Where on, `project_discipline_revenue` shall also return rows with `basis = 'billed_claims'` per discipline
  and currency (from live claim lines), plus one "not itemised" row (null discipline, `basis = 'billed_unitemised'`)
  holding project billed work minus itemised billed, so the billed rows sum to the project billed work.
- FR-EBR-012 Per work order, billed shall equal `work_order_billing` (invoiced + pending, excl. tax); earned per work
  order shall equal `work_order_validated_revenue`. Summed per project, earned discipline rows equal summed work-order
  earned (as FR-DPR-012).
**Screens**
- FR-EBR-020 Where on, the work-order profit rows, the "Profit per discipline" table and the project total shall show
  earned and billed revenue, the gap, and margin on each basis. Not-available, incomplete, restricted, not-comparable
  and cost-unknown read as words, never zero (as FR-DPR-021). A loss reads "loss of X" in text.
- FR-EBR-021 The management pack shall, where on and for callers who may see revenue, add per project: earned to date
  from validated progress (a column next to the existing recognised/invoiced), the gap to invoiced, and margin on the
  earned and billed bases using the project's existing cost figure (restricted or incomplete cost reads as such). Existing
  pack columns and totals are unchanged.
- FR-EBR-022 Usable at 390 px; English and Bahasa Indonesia; no currency blending.

## 4. Settings
| Setting | Where | Default |
|---|---|---|
| `organizations.discipline_profit_enabled` (reused from #2669) | org settings screen (existing toggle, copy extended) | **false** |
No new setting, rate or list. Existing organisations see no change.

## 5. Database-enforced rules and proofs
| Rule | Enforced by | pgTAP |
|---|---|---|
| FR-EBR-001/010 setting off returns nothing; revenue-reader roles only; other org absent | security-definer RPC `project_work_order_earned_billed` | `supabase/tests/1270_earned_billed_revenue.test.sql` |
| FR-EBR-011/012 billed basis rows, reconciliation to `work_order_billing` and `sales_invoice_work_billed` | `project_discipline_revenue` (replaced, adds rows) | same file |
| FR-EBR-021 pack earned read gated by setting and role | security-definer RPC `management_pack_earned` | same file |

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-EBR-001 | Given setting off, then `project_work_order_earned_billed`, `management_pack_earned` and the billed rows return nothing and no screen gains a figure. | pgTAP + Unit |
| AC-EBR-002 | Given an Engineer or another project's PM, then each new read is refused 42501; Finance/Admin/Executive/own PM succeed; another org's project is absent. | pgTAP |
| AC-EBR-003 | Given work order A with validated 100.00 and invoices 60.00 excl. tax and a down payment, then earned 100.00, billed 60.00, gap 40.00 (down payment counts 0). | pgTAP |
| AC-EBR-004 | Given a work order with no validated line but billed 60.00, then earned is not available (null), gap not available, margin on the earned basis reads "not available". | pgTAP + Unit |
| AC-EBR-005 | Given a withdrawn claim and a cancelled invoice, then neither counts in billed; a draft/superseded report never counts in earned. | pgTAP |
| AC-EBR-006 | Given claim lines 70.00 (civil), 20.00 (none) and project billed work 100.00, then billed rows are 70.00, 20.00 and "not itemised" 10.00; their sum is 100.00. | pgTAP (Layer-1 money test) |
| AC-EBR-007 | Given the per-work-order read, then billed equals `work_order_billing` invoiced + pending and earned equals `work_order_validated_revenue` for each work order. | pgTAP |
| AC-EBR-008 | Given earned 100.00, billed 60.00, cost 70.00, then margin earned 30.00, billed -10.00 reads "loss of 10.00", gap 40.00. | Unit (pure `earnedBilledProfit`) |
| AC-EBR-009 | Given a validated line without a rate, then earned reads "incomplete", never zero; revenue and cost in different currencies read "not comparable". | Unit |
| AC-EBR-010 | Given a caller who cannot see revenue, then both bases read "restricted". | Unit |
| AC-EBR-011 | Given the setting on, when Finance opens the work-order profit and discipline table, then earned, billed, gap and both margins show and the totals equal the project figures. | E2E (one journey) |
| AC-EBR-012 | Given the setting on, when Finance opens the management pack, then each project shows earned, gap to invoiced and margin on both bases; existing columns equal today's. | E2E + Unit |
| AC-EBR-013 | Given Bahasa Indonesia, every new string is translated and tables fit at 390 px. | Unit (i18n) + screenshots |

**Mutation check (required):** make `project_work_order_earned_billed` count draft reports (or `billed` include a down
payment / withdrawn claim) and AC-EBR-003/005/007 go red; skip the role gate and AC-EBR-002 goes red; make
`billed_unitemised` return 0 and AC-EBR-006 goes red; restore.

## 7. Open questions (for the orchestrator)
1. The pack has no cost today. Default here: `management_pack_earned` also returns the project's cost per currency summed
   from `work_order_cost_lines` (the #2517 read), null when any restricted row exists, so pack margin uses the same cost as
   the project tab. Alternative: pack shows earned, billed and gap only and defers margin. Confirm.
2. Per-discipline billed uses claim lines only; direct manual invoices land in "Not itemised". Confirm that is acceptable.
3. The earned-basis project margin treats a work order with no validated progress as not available (never 0) for that work
   order; the project total then reads "incomplete" rather than a partial sum. Confirm.

## 8. Out of scope
Statutory recognition, ledger posting, re-pricing, forecast, tax, a second setting.
