# Gross-margin P&L on every plan, company and project

Issue #1860 (map #1718). Status: **Draft, 2026-11-15** — awaiting owner sign-off of the three open questions in
`docs/plans/2026-11-15-gross-margin-pnl.md`. Executor on sign-off: Orca worker per `docs/orca-dispatch.md`.
Owner ruling this encodes: **D16** in `docs/specs/plans-and-feature-switches.spec.md` (2026-11-04): gross margin
is core on all plans, company and project; overheads and net profit are Pro (`financial_statements`).

**Job story.** When I open the P&L, I want to see gross margin first — billed revenue less project costs, by
month, with each project's share — so I know whether the work is making money, without needing an ERP or the
Pro plan.

**Money path:** read-only. No posting, no SoD change, no new write path.

## 1. AS-IS (shipped, cited against `origin/dev` at `b321ac02`)

- **Project margin** is `deriveMargin(bucket, actuals, coverage)` in `pmo-portal/src/lib/projectFinances.ts`
  (`:506`). It returns `{amount}` or a `reason` (`different-currencies`, `restricted-rows`, `work-unavailable`,
  `actuals-unavailable`). Revenue is the invoice bucket's `work_revenue`; cost is `actuals.total`.
  It is shown by `pages/project-detail/ProjectFinancesSection.tsx` and `ProjectBlocks.tsx`, with the reason copy
  keyed `projectDetail.money.marginOut*`.
- **Cost basis today.** For an organisation without an ERP binding, the cost read is the PMO spent position
  (`project_pmo_spent_position`, `0700_pmo_spend_split.sql`: pre-tax paid purchases plus the hire charge) and the
  open commitment (`project_pmo_commitment_position`). `deriveMargin` documents that a PMO-ledger reading
  "never yields a margin", so **a no-ERP project shows no margin today**. This is the gap D16 closes.
- **Statements screen** `pages/FinancialStatements.tsx` is ERP-fed (saved reports, or the Odoo ledger). Its
  route and rail entry are gated by `financial_statements` (`src/components/shell/routeMatch.ts:226`,
  `src/components/shell/Rail.tsx:97`); with the switch off the whole screen is unreachable. The executive dashboard
  carries two company-level margin **KPIs** (`on_hand_margin`, `pipeline_projected_margin`,
  `supabase/migrations/0009_dashboard_margin.sql:56-64`), but there is **no company gross-margin read** — no
  by-month revenue/cost/margin figure and no per-project breakdown — anywhere.
- `financial_statements` is a switch in `src/lib/features.ts` (Pro and Enterprise only, per the plans spec).

## 2. TO-BE: what is new

1. A margin can be derived for a PMO-basis project (no ERP).
2. A company gross-margin read: by month, billed revenue, project costs, gross margin, plus a per-project
   breakdown, computed from the same per-project derivation.
3. The Statements screen opens with a gross-margin block on every plan; the overheads and net-profit blocks
   render only when `financial_statements` is on.

## 3. Functional requirements (EARS)

**FR-GM-001 — One derivation.** The system shall compute company gross margin by applying the project
derivation (`deriveMargin`) to each project and summing the results; no second margin formula shall exist.

**FR-GM-002 — PMO-basis project margin.** Where an organisation has no active ERP binding, the system shall
derive a project's margin as billed-work revenue less the PMO spent position (the Budget tab's Spent), in the
project currency, when both are complete (basis pending Q1).

**FR-GM-003 — ERP-basis project margin.** Where an ERP binding is active, the system shall keep today's
derivation from the ERP actuals unchanged.

**FR-GM-004 — Company read.** When Finance, Executive or Admin opens the P&L, the system shall return, per
calendar month and per project, billed revenue (sales invoices, net of tax), project cost, and gross margin.

**FR-GM-005 — Company total.** The company gross margin for a period shall equal the sum of the margins of
the projects that have one; a project without a margin shall be listed with its reason and shall not be counted
as zero.

**FR-GM-006 — Same reasons.** When a project's margin is left out, the system shall show the same reason copy
the project page uses.

**FR-GM-007 — Mixed currencies.** When projects or buckets use more than one currency, the system shall not
add across currencies; it shall show one gross-margin figure per currency and leave a cross-currency total out
with the `different-currencies` reason.

**FR-GM-008 — Gross margin first.** The Statements screen shall render the gross-margin block first.

**FR-GM-009 — Plan gating.** While `financial_statements` is off, the Statements screen shall show the
gross-margin block only, and its route and navigation entry shall remain reachable; overheads, net profit and
the other ERP-fed statements shall not render or be fetched.

**FR-GM-010 — Authority.** The company read shall be available to the roles that may view financial statements
(`view financialStatements`: Executive, Finance, Admin), shall carry the caller's org only, and shall exclude
restricted rows exactly as the project read does.

**FR-GM-011 — Exact money.** Amounts shall travel as exact decimal text and be summed in integer cents.

## 4. Acceptance criteria (Given/When/Then; owning layer per ADR-0010)

- **AC-GM-001 [Vitest]** Given a PMO-basis project with complete work revenue 1,000.00 and complete spent
  400.00, when its margin is derived, then it is 600.00; and given incomplete spend, then it is left out with
  `actuals-unavailable`.
- **AC-GM-002 [Vitest]** Given an ERP-basis project, when its margin is derived, then the result equals today's
  (the existing `projectFinances` tests stay green unchanged).
- **AC-GM-003 [pgTAP]** Given an org with no ERP, invoices and procurement on two projects, when the company
  read runs, then its total equals the sum of the two project margins.
- **AC-GM-004 [pgTAP]** Given invoices dated in two months, when the company read runs, then revenue falls in
  the month of the invoice date and cost in the month it is dated (basis pending Q2).
- **AC-GM-005 [Vitest]** Given one project with a left-out margin and one with a margin, when the company total
  is built, then the total is the second project's margin, the first is listed with its reason, and the total is
  marked partial.
- **AC-GM-006 [Vitest]** Given mixed currencies, then margin is shown per currency and the cross-currency total
  is left out with `different-currencies`.
- **AC-GM-007 [pgTAP]** Given a role without `view financialStatements` or another org's data, when the read
  runs, then it returns nothing for that caller.
- **AC-GM-008 [Vitest]** Given `financial_statements` off, when Finance opens statements, then the
  gross-margin block shows and the overheads block and the ERP statement fetches do not.
- **AC-GM-009 [Vitest]** Given `financial_statements` on, then the gross-margin block is first and overheads
  follow.
- **AC-GM-010 [e2e]** Given a no-ERP Starter org, invoices and procurement on two projects, when Finance opens
  the P&L, then company gross margin equals the sum of the two margins shown on the project pages.

## 5. Out of scope

Overheads, net profit and balance sheet (already ERP-fed); changing the project page's cost basis labels; any
change to invoice, payment or procurement writes.
