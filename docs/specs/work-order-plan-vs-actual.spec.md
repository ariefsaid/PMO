# Plan versus actual and profit per work order (WPVA)

Issue #2519 (map #2516, blocked by #2517). Status: **Draft, 2026-11-20**. Executor on sign-off: **Director-dispatched
Orca worker, ships alone** (money figures; read-only, but a wrong figure here is a wrong business decision). Plan
`docs/plans/2026-11-20-work-order-plan-vs-actual.md`. IDs: `FR-WPVA-###`, `AC-WPVA-###`.
**Money path: read-only derivation.** No posting, no SoD change. The only new writes are plan figures and a split
setting, both ordinary table writes by finance-capable roles (below).

**Reuses, does not fork:** cost attribution (`docs/specs/cost-attribution.spec.md`, FR-CAT-005/022: percentages sum
to exactly 100, per-target cents rounding with the last target taking the remainder) and the gross-margin
derivation (`docs/specs/gross-margin-pnl.spec.md`, FR-GM-001: one margin formula, summed, never a second one).
**Builds on #2517:** `work_order_cost_lines` and the repository function returning cost lines per work order by source.

**Job story.** When a work order is under way, I want its planned budget next to what it has actually cost and
earned, with the margin before and after the project's shared costs, so I can see which work orders and which
disciplines make or lose money while there is still time to act.

## 1. AS-IS
- Project margin is `deriveMargin` (`src/lib/projectFinances.ts`): billed work revenue less cost; a project-level
  figure only. Budgets are per project and per category (`budget_versions`, `budget_line_items`, 0001): no work-order
  or discipline dimension.
- #2517 gives every cost line an optional work order and discipline. A cost line with **no** work order is a
  project-level cost. Project totals do not read the new columns, so they are unchanged.
- Billing per work order is derived (`workOrderBilling.ts`, DD-BWO-1..13). Equipment usage is hours or days
  (`equipment_usage_entries.unit`, 0447); timesheet lines carry hours.
- There is no planned figure per work order, no equipment-hour or crew plan, and no shared-cost allocation.

## 2. Definitions (proposed glossary entries)
- **Direct cost** of a work order: cost lines naming that work order, in the work order's currency.
- **Shared cost**: cost lines of the same project that name **no** work order (project-level cost).
- **Direct margin** = revenue - direct cost. **Result after shared costs** = direct margin - allocated shared cost.
- **Revenue** of a work order: billed work revenue (excl. tax) from the shipped per-work-order billing derivation.
  Order value is shown as the ceiling, never as revenue.

## 3. Requirements (EARS)

**Plan figures**
- FR-WPVA-001 The system shall hold, per work order and optionally per discipline, planned figures of four kinds:
  direct budget (money), indirect budget (money), equipment hours, crew hours; each with an optional note.
- FR-WPVA-002 A plan figure shall be non-negative, finite, within the work order's org and project, and use the
  work order's currency for money kinds. A discipline shall be on the org's list.
- FR-WPVA-003 Only Admin, Executive, Finance and Project Manager shall write plan figures (RLS + pgTAP). A Cancelled
  work order's plan is frozen. Edits write an audit row (before/after).
- FR-WPVA-004 Planned figures never change an actual, a project total or a budget version.

**Actuals**
- FR-WPVA-010 Actual direct cost per work order shall be the sum of its cost lines, by source and discipline, from
  one SQL read that sources every figure from the same rows #2517 exposes; the UI shall not re-sum differently.
- FR-WPVA-011 Actual equipment hours shall be the sum of equipment usage quantity in hours for the work order
  (days convert only if the org sets hours-per-day; otherwise shown separately, never mixed).
- FR-WPVA-012 Actual crew hours shall be timesheet hours naming the work order; crew size shown is the count of
  distinct people with hours (a figure, not a stored plan of names).
- FR-WPVA-013 A source whose money the caller may not read shall make the dependent totals "restricted", never
  zero or partial; margin is not shown for a restricted work order.
- FR-WPVA-014 Cost in a currency other than the work order's shall be listed separately and shall make margin
  "not comparable" (same rule as `different-currencies` in `deriveMargin`); never blended.

**Shared-cost allocation**
- FR-WPVA-020 By default, each work order's share of a project's shared cost shall equal its share of the project's
  direct cost (its direct cost / sum of all work orders' direct cost on that project, Cancelled included only if it
  carries cost), subject to the project-actuals basis ruling below.
- FR-WPVA-021 Where a project has no direct cost on any work order, the default split shall be an equal split over
  its non-Cancelled work orders, flagged "equal split, no direct cost yet".
- FR-WPVA-022 Where a user sets a custom split for a project, the system shall store one percentage per work order
  (0 to 100, up to 4 decimals, summing to exactly 100, as FR-CAT-005); only Admin, Executive and Finance set or
  clear it; each change is audited; clearing returns to the default.
- FR-WPVA-023 Allocated amounts shall round to cents per work order, the last (by work-order number) taking the
  remainder, so the allocations sum exactly to the shared total.
- FR-WPVA-024 A work order added or cancelled after a custom split was saved shall make the split "stale"; the
  screen shall say so and fall back to the default until a user re-saves (a split that does not sum to 100 is never used).

**Project-actuals basis (owner ruling, 2026-11-20)**
- The project total shall equal the existing project actuals; work-order amounts and Not assigned shall sum to that total.
- A paid amount shall follow the most specific document through which it passed: vendor bill, then purchase order or
  receipt, then purchase request. A payment linked to a bill shall follow that bill; an unlinked payment shall follow
  its purchase's documents. Amounts without a work-order link shall remain Not assigned; links shall never be inferred.
- Where bills on one purchase name different work orders, each bill's paid amount shall go to its own work order and the
  remainder of the purchase's 0909-basis amount shall follow the purchase's work order.
- ERP-ledger actuals and allocated overhead without a work-order link shall remain Not assigned, unless the project has
  a configured shared-cost split, in which case that split applies.

**Roll-ups**
- FR-WPVA-030 The system shall roll the same figures up to discipline (within a project), project and contract with
  one function; project and contract totals equal the sum of their work orders plus any cost naming no work order
  and no allocation (shown as "Not assigned").
- FR-WPVA-031 A discipline's allocated shared cost is its work orders' allocation split by that discipline's share
  of each work order's direct cost; cost with no discipline rolls under "No discipline".
- FR-WPVA-032 Project totals shall equal today's project totals: every cost line appears exactly once, direct or shared.

**Read and screens**
- FR-WPVA-040 The work-order page (#2518) shall show plan vs actual, revenue vs actual and both margins; a project
  tab shall list work orders and disciplines with the same figures and roll-up row.
- FR-WPVA-041 Every figure shall show its basis on demand (the contributing cost lines); overspend (actual over
  plan) shall read as such in words, not only in colour.

## 4. Acceptance criteria

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-WPVA-001 | Given plan figures on a work order, when an Engineer writes one, then it is refused; when a Finance user writes it, it saves and one audit row exists. | pgTAP |
| AC-WPVA-002 | Given a plan figure for a work order of another org, project or an archived discipline, when saved, then it is refused. | pgTAP |
| AC-WPVA-003 | Given cost lines on a WO from 3 sources, when actuals are read, then total = sum of those source rows and by-discipline groups sum to the total. | Layer-1 money test (vitest on the read + pgTAP fixture) |
| AC-WPVA-004 | Given WO A direct 600 and WO B direct 400 and shared cost 100, when no custom split exists, then A gets 60.00, B gets 40.00 and results after shared cost are revenue - direct - allocated. | Unit (pure function) + pgTAP |
| AC-WPVA-005 | Given three WOs and shared cost 100.00 with a 33.3333/33.3333/33.3334 split, when allocated, then amounts are 33.33/33.33/33.34 and sum to 100.00. | Unit |
| AC-WPVA-006 | Given a custom split not summing to 100, when saved, then it is refused. | pgTAP |
| AC-WPVA-007 | Given a custom split and a WO added later, when I view, then the split reads "stale" and the default is used. | Unit |
| AC-WPVA-008 | Given no direct cost on any WO and shared cost 90 over 3 WOs, then each is allocated 30.00 with the equal-split flag. | Unit |
| AC-WPVA-009 | Given a caller who cannot read one source's money, when I view, then dependent totals are "restricted" and margin is hidden. | Unit + pgTAP (read denied) |
| AC-WPVA-010 | Given a vendor bill in a second currency, then it is listed apart and margin is "not comparable". | Unit |
| AC-WPVA-011 | Given disciplines civil and electrical on a WO, then discipline direct cost and allocated shared cost sum to the WO's figures. | Layer-1 money test |
| AC-WPVA-012 | Given a project with several WOs and unattributed cost, then project total = sum of WOs + "Not assigned", and equals the pre-#2517 project total. | Layer-1 money test + pgTAP |
| AC-WPVA-013 | Given equipment usage in hours and days, then hours show as hours and day entries show separately (no silent conversion). | Unit |
| AC-WPVA-014 | Given overspend, then the screen states "over plan by X" in text. | Unit |
| AC-WPVA-015 | Given a custom split saved by a Project Manager, then it is refused (Admin/Executive/Finance only). | pgTAP |
| AC-WPVA-016 | Given a work order opened from the project tab, then its plan-vs-actual matches the project tab row. | E2E (one journey) |

Mutation check (required): break the allocation (`share := 0.5`) and AC-WPVA-004/005 go red; break the project-total
sum and AC-WPVA-012 goes red; restore.

## 5. Open questions
1. **Money seam.** `work_order_cost_lines` carries no money. Proposed: one definer-free `security_invoker` read per source returning the amount the source's own money read allows, unioned in a new view `work_order_cost_amounts`. Alternative: reuse the ERP actuals (ERP-bound orgs). Which cost basis for ERP-bound orgs: PMO records or the ledger (gross-margin spec Q1)?
2. **What is "cost" per source and when?** Committed (PO) vs received vs billed: stock issues at ledger value, timesheet hours at which rate, equipment hours at which rate (the equipment spec says rates are never required)? Proposed v1: purchases at vendor-bill amount (pre-tax), stock at ledger value, timesheet and equipment at a rate only where the org has set one, otherwise shown as hours with no money.
3. **Contract.** Treated as the project's client contract (one per project). If a project can hold several contracts, a contract table is needed first.
4. **Shared-cost pool.** Defined as cost lines with no work order. Should the owner also be able to mark a cost as shared explicitly, or exclude some (e.g. head-office overhead) from the pool?
5. **Indirect budget** is a plan figure the user enters; does it map to a budget category, or stay free-standing? Proposed free-standing in v1.
6. **Crew plan** as crew hours only, or head-count x days? Proposed hours.
7. **Currency:** which currency do project and contract roll-ups use when work orders differ? Proposed: per currency, never blended.
8. Which roles read margin? Proposed Admin, Executive, Finance, PM (as project margin today).

## 6. Out of scope
Posting shared costs anywhere (read-side only, like cost attribution); forecasts to completion; tax; ERP write-back.
