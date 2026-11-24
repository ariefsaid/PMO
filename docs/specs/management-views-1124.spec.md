# Spec: Management views round (24 November 2026)

**Status:** implementation brief accepted for the 24 November decision round. This lane adds only the missing views and access boundaries described here. No client-specific examples or data are included.

## Job stories

- When I review the executive home, I want a sortable portfolio view of project budget and schedule health, so I can open the project that needs attention first.
- When I manage projects, I want to see work in hand for my projects, so I can plan billing without seeing the company-wide position.
- When I prepare billing, I want progress separated by client acceptance state, so I can distinguish measured work from accepted work that is ready to claim.
- When I review claims, I want each billing step to show its count and value, so I can understand the amount waiting at each step.

## Functional requirements (EARS)

- **FR-MV-001** When an Executive, Admin, or Finance user opens the executive home, the system shall show one row per active delivery project with spent vs active budget, completed and late milestone counts, and planned vs actual delivery progress.
- **FR-MV-002** When the portfolio rows load, the system shall sort rows by the descending mean of the available risk signals: over-budget fraction, planned-minus-actual progress fraction, and late-milestone fraction. Budget risk is omitted when currencies do not match or the active budget is not positive; unavailable metrics are omitted. The table shall allow sorting by each displayed metric; activating a row shall open that project.
- **FR-MV-003** Where existing home sections already show a requested portfolio fact, the system shall reuse it and add only the missing facts; the portfolio shall not list individual tasks.
- **FR-MV-004** When a Project Manager requests work in hand, the database shall return only on-hand contracts and issued work orders belonging to projects assigned to that manager; Finance, Executive, and Admin shall retain the organization-wide read.
- **FR-MV-005** Where the work-in-hand screen shows a Project Manager's totals, those totals shall aggregate only that manager's assigned projects and shall be labelled as that scoped position.
- **FR-MV-006** When a billing user opens Billing plan, the system shall show separately labelled progress not yet accepted by the client and accepted progress not yet claimed.
- **FR-MV-007** When progress has no confirmed client acceptance, the system shall show only the positive measured quantity above the accepted quantity; accepted-but-unclaimed candidates shall continue to use the existing billing-plan candidate calculation.
- **FR-MV-008** When a Finance, Executive, or Admin user opens the billing board, each visible step column shall show the number of claims and the exact total claim value by currency; individual claim cards shall continue to omit money.
- **FR-MV-009** When a Project Manager or any other role outside Finance, Executive, and Admin calls the billing-board read, the database shall reject the call or return no rows.
- **FR-MV-010** When an organisation has not enabled the `management_views` entitlement, the system shall hide the new home portfolio and unaccepted-progress group and skip their dedicated reads; all existing plan defaults shall leave this entitlement off until an Operator enables the organisation's override.
- **NFR-MV-001** Reads shall be batched, organization-scoped, bounded, and use the repository seam; no N+1 project reads are permitted.
- **NFR-MV-002** Money shall remain exact and separate by currency; no cross-currency total shall be presented.
- **NFR-MV-003** All changed user-facing labels shall have English and Bahasa Indonesia translations and preserve loading, error, empty, keyboard, and responsive states.

## Acceptance criteria and owning layer

| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-MV-001 | Given projects with different budget and schedule health, when the executive home opens, then all active delivery projects appear with spend/budget, completed/late milestones and planned/actual progress, ordered worst first, sortable by the displayed measures, and linked to their project; no task rows appear. | RTL/unit |
| AC-MV-002 | Given a project manager assigned to a subset of projects, when they call the work-in-hand read, then only assigned project contracts/work orders are returned and no company-wide undated-invoice count is disclosed; Finance, Executive and Admin retain company-wide data. | pgTAP |
| AC-MV-003 | Given a Project Manager, when they open work in hand, then the page is available and the totals and label describe only their assigned projects; other roles retain existing permissions. | RTL/unit |
| AC-MV-004 | Given assessed quantity above confirmed accepted quantity, when Billing plan opens, then the positive difference appears under “Progress not yet accepted by client”; accepted quantities not yet claimed remain under their own labelled group. | RTL/unit + pgTAP |
| AC-MV-005 | Given claims in multiple board steps and currencies, when an authorized user opens the billing board, then each column shows claim count and exact totals separated by currency, while cards show no amount. | RTL/unit + pgTAP |
| AC-MV-006 | Given a Project Manager or Engineer, when they call billing_board directly, then the database returns no board rows; Finance, Executive, and Admin can still read it. | pgTAP |
| AC-MV-007 | Given an organisation without the management_views override, when home or Billing plan loads, then the portfolio and unaccepted-progress group are hidden and their dedicated reads are skipped; after the organisation is opted in, those surfaces can load. | RTL/unit + pgTAP |

## Error handling

| Case | Behaviour |
|---|---|
| Portfolio read fails | Keep the existing dashboard visible and show a retryable error state for the new portfolio table. |
| No active delivery projects | Show the table's empty state. |
| Work-in-hand read denied | Show the existing access-denied surface; no data or company-level totals render. |
| Billing candidate read fails | Show an error state for the affected group; do not imply an empty group. |
| Billing-board read fails | Keep the existing board error state; do not show fabricated zero totals. |

## Implementation checklist

- [ ] Add one batch project-milestone overview RPC plus reversible migration and pgTAP coverage.
- [ ] Compose portfolio rows from existing project, budget, and delivery repositories; add sortable accessible table.
- [ ] Scope `get_work_in_hand` for Project Managers and add a dedicated permission/route affordance.
- [ ] Add a bounded, read-only unaccepted-progress candidate read and separate group on Billing plan.
- [ ] Add exact per-currency totals to the billing-board read and columns; enforce role at the read boundary.
- [ ] Update the billing-board decision, glossary, existing specs, English/Indonesian strings, and targeted tests.
