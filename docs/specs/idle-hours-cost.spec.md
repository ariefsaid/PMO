# Idle hours turned into cost per work order (IHC)

Issue #2673 (map #2516, target 15 December 2026). Status: **Approved, 2026-11-21** (open questions 1-3 answered yes). Plan
`docs/plans/2026-11-21-idle-hours-cost.md`. IDs: `FR-IHC-###`, `AC-IHC-###`. Size S. Stacked on #2670 (labour cost in money).
**Money path: read-only costing.** It posts nothing, changes no approval, no site-report rule and no ledger. Migrations 1255-1256.

**Job story.** When a crew stands idle for a recorded reason, I want that time costed to the work order, so lost time shows as money.

## 1. AS-IS
- A daily site report (1040/1041) carries idle periods: minutes (1-1440) and a reason from the organisation's own list
  (`dsr_idle_reasons`, Admin-maintained, archivable). Idle periods are per report, not per person.
- #2670 prices approved timesheet hours per work order (`work_order_cost_amounts`, reason `counted`, hours in `quantity`).
- Nothing turns idle minutes into money.

## 2. Definitions (glossary entry added with the build)
- **Work-order hourly cost**: the work order's priced labour amount divided by its priced labour hours (a weighted average
  over all its `counted` timesheet lines). No priced hours, no hourly cost.
- **Idle cost**: idle hours (minutes / 60) x work-order hourly cost. It is a **lost-time view of money already counted**
  in labour cost (the idle hours were paid hours), so it is never added to direct cost.
- Only **validated, current** reports count (status validated, not superseded, not archived).

## 3. Requirements (EARS)
- FR-IHC-001 The organisation shall have one switch, **idle hours as cost**, **OFF by default** (no row = off). It takes
  effect only while labour cost in money (#2670) is also on. While either is off, nothing in this feature returns a row or shows.
- FR-IHC-002 Only Admin and Finance shall write the switch, enforced in the database.
- FR-IHC-003 Where both switches are on, a read shall return per work order and per idle reason: minutes, hours, hourly
  cost, amount (2 decimals, organisation currency) and a reason `counted` or `no-rate` (no priced hours on that work order:
  hours shown, no money). Reasons are the client's own list; archived reasons with history still appear.
- FR-IHC-004 Idle cost shall not alter work-order direct cost, plan versus actual totals, project actuals, margin or the ledger.
- FR-IHC-005 The read shall be database-side, read-only, org-scoped (another organisation's project reads as absent) and
  limited to Admin, Executive, Finance and Project Manager; it reveals no person and no rate, and gives a Project Manager no hourly cost.
- FR-IHC-006 Work-order plan versus actual shall show an "Idle time" block (per reason: hours and amount, plus a total)
  only where the read returns rows. Copy says "cost", never "pay". English and Bahasa Indonesia; phone and desktop.
- FR-IHC-007 Administration > Labour cost shall carry the switch (Admin, Finance), using the shared form primitives.
  Idle reasons stay maintained where they already are.

## 4. Acceptance criteria (owning layer in brackets)
- AC-IHC-001 Given the switch never turned on, then the read returns no row and no idle block shows. [pgTAP 1255 + vitest]
- AC-IHC-002 Given the idle switch on but labour cost off (or the reverse), then no row. [pgTAP 1255]
- AC-IHC-003 Given both on, validated reports with 60 idle minutes in all for reason A and work-order hourly cost 62500, then
  that row: 1.00 h, amount 62500.00, `counted`. [pgTAP 1255]
- AC-IHC-004 Given priced lines of 8 h at 400000 and 8 h at 600000 (weighted 62500/h) and 60 idle minutes, then 62500.00. [pgTAP 1255]
- AC-IHC-005 Given two reasons across two days, then one row per reason with summed minutes. [pgTAP 1255]
- AC-IHC-006 Given draft, submitted, returned, superseded or archived reports, then their idle minutes are excluded. [pgTAP 1255]
- AC-IHC-007 Given a work order with idle minutes but no priced labour hours, then hours shown, amount null, `no-rate`. [pgTAP 1255]
- AC-IHC-008 Given a non-Admin/Finance caller, then the switch write is refused (42501); others' reads of the setting follow the
  labour-cost rule. [pgTAP 1255]
- AC-IHC-009 Given another organisation's project, then it reads as absent; a role outside the four is refused. [pgTAP 1255]
- AC-IHC-010 Given idle rows, then the work order's direct cost and totals are unchanged and the block shows idle money
  apart from them. [vitest `workOrderPlanVsActual` + component]
- AC-IHC-011 Given the Administration section, then Admin/Finance can toggle the switch; a refusal shows its reason; EN and
  Bahasa Indonesia. [vitest + one e2e journey]

## 5. Settings added and defaults (existing organisations see no change)
| Setting | Where | Default | Enforced by |
|---|---|---|---|
| Idle hours as cost (switch) | `idle_cost_settings.enabled` (one row per org) | no row = OFF | RPC `save_idle_cost_setting(boolean)` Admin/Finance; read gated on it AND labour cost; pgTAP 1255 |
| Idle reasons | existing `dsr_idle_reasons` | client's own list | unchanged (1040) |
No new rate: the hourly cost comes from #2670 rates. Database-enforced: who writes the switch, both-switch gate, report
eligibility, org scoping, role gate. Not DB-enforced (UX only): visibility of the Administration control.

## 6. Open questions (answered yes by the Director; 3 is a known v1 limit)
1. "Hourly cost of the work order" = weighted average of its priced labour (no per-person split, as idle periods name no
   person). Assumed yes.
2. Idle cost is shown apart and not added to direct cost (it would count paid hours twice). Assumed yes.
3. KNOWN LIMIT (v1): idle periods are not split by overtime or by date rate; the average is over the work order's whole history. Assumed yes.
