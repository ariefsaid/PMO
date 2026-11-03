# Plans and feature switches — spec

Status: **draft for owner sign-off** · Map: [Plans and feature switches](https://github.com/ariefsaid/PMO/issues/1718) (child of "PMO as a product") ·
Builds on: `ops-admin-surface.spec.md` FR-ENT-001..007 (per-org `org_features`, Operator-only writes),
ADR-0049, migration 0081 (server-side write enforcement).

## Job story

When I sell PMO to more than one organisation, I want to give each one a plan (Starter, Growth, Pro,
Enterprise) that switches whole features on or off and caps seats, active projects and AI messages, and
to switch a single feature off for one org or for every org at once, so each customer sees only what they
pay for and what fits how they work, without a release.

## Decisions (owner grill, 2026-11-02)

| # | Decision |
|---|---|
| D1 | Three layers. **Global** (every org) → **org override** → **plan default**. A global *off* beats any org *on*. |
| D2 | A plan is a named bundle of switches and limits. The org gets a plan; the Operator may override single switches per org. |
| D3 | Limits are part of the plan: seats, active projects, AI messages per month. Switches ship first, limits second. |
| D4 | One switch per row of the tier table that differs between tiers; a "Basic vs Full" row is two switches. |
| D5 | Never switchable: projects, budgets vs actual, approvals with SoD (fixed rules, chains, audit trail), roles, expense claims, dashboard, administration. Timesheets and CRM stay switchable. |
| D6 | **Off** = hidden from navigation, route blocked, server refuses writes, syncs and jobs for it, assistant tools for it removed. Data kept; switching back on restores it. |
| D7 | Only the Operator changes plans and switches. The org Admin sees a read-only "Your plan" page. The existing Admin-owned `feedback_surveys` switch is unchanged. |
| D8 | No billing, no prices in the system. The Operator assigns plans by hand. Prices stay in the pricing ticket. |
| D9 | Existing orgs (RIS, the demo org) start on Enterprise, so nothing changes for them. RIS's warehouse is switched off by an Operator override (temporary, not a seed default). |
| D10 | AI messages: one pool per org, monthly reset. Users see "AI messages"; metering stays on real model cost, one message credit covers up to $0.005 and a heavier message uses more. Quotas are Operator-editable per plan. |
| D11 | Hitting a limit blocks only new things (invite past seats, create past the project cap); existing users and projects keep working. AI at zero disables the composer (shipped behaviour). |
| D12 | A downgrade applies immediately: removed features hide with data kept; over-limit items stay, nothing new may be added. |
| D13 | Every new module ships with: a switch, a row in the plan table, and assistant tools (a read tool always; a draft-and-confirm write tool where the screen writes). CI fails a module that lacks any of the three. |
| D14 | Switches live in our database, not PostHog (they decide entitlement and must be server-enforced). The org's plan is sent to PostHog as a group property so analytics can split by plan. |
| D15 | When the assistant cannot answer for lack of a tool, it emits one PostHog event (no message text), so missing tools show on a chart. |

## Switch catalogue (recommended placement — owner signs off per row)

`S` Starter · `G` Growth · `P` Pro · `E` Enterprise. Existing keys keep their names.

| Key | Feature | S | G | P | E |
|---|---|---|---|---|---|
| `timesheets` *(exists)* | Timesheets | ✓ | ✓ | ✓ | ✓ |
| `crm` *(exists)* | Companies and contacts | ✓ | ✓ | ✓ | ✓ |
| `sales_pipeline` | Sales pipeline and opportunities (split out of `crm`) | – | ✓ | ✓ | ✓ |
| `procurement` *(exists)* | Procurement cases, basic flow | ✓ | ✓ | ✓ | ✓ |
| `procurement_full` | Procurement full flow (definition: owner ticket) | – | ✓ | ✓ | ✓ |
| `sales_invoices` | Raise and track sales invoices, basic | ✓ | ✓ | ✓ | ✓ |
| `revenue` *(exists)* | Incoming payments, receivables ageing, reports | – | ✓ | ✓ | ✓ |
| `budget_projection` | Budget projection / forecasting | – | ✓ | ✓ | ✓ |
| `imprest` | Imprest / petty-cash floats | – | ✓ | ✓ | ✓ |
| `user_views` *(exists)* | Custom fields and saved views/reports | – | ✓ | ✓ | ✓ |
| `m365_integration` *(exists)* | Microsoft 365 document linking | – | ✓ | ✓ | ✓ |
| `clickup_sync` | ClickUp sync | – | ✓ | ✓ | ✓ |
| `erp_sync` | ERPNext/Odoo connection: budget push, actuals, statements feed | – | – | ✓ | ✓ |
| `erp_purchases` | Payables view of ERP purchases | – | – | ✓ | ✓ |
| `financial_statements` | P&L, balance sheet, cash flow | – | – | ✓ | ✓ |
| `management_pack` | Management pack | – | – | ✓ | ✓ |
| `budget_phasing` | Multi-year budget phasing | – | – | ✓ | ✓ |
| `multi_currency` | Exchange rates / multi-currency | – | – | ✓ | ✓ |
| `stock` | Warehouse and stock | – | – | ✓ | ✓ |
| `api_access` | API / webhooks | – | – | ✓ | ✓ |
| `sso` | SSO / SCIM | – | – | – | ✓ |
| `incidents` *(exists)* | Incidents | ✓ | ✓ | ✓ | ✓ |
| `import_export` *(exists)* | Import / export | ✓ | ✓ | ✓ | ✓ |
| `agent_assistant` *(exists)* | AI assistant (quota per plan below) | ✓ | ✓ | ✓ | ✓ |
| `feedback_surveys` *(exists, Admin-owned)* | Feedback widget and surveys | ✓ | ✓ | ✓ | ✓ |

**Limits (starting values, Operator-editable):**

| Limit | S | G | P | E |
|---|---|---|---|---|
| Included seats | 10 | 25 | 50 | per contract |
| Active projects | 25 | 100 | unlimited | unlimited |
| AI messages / month (org pool) | 300 | 1,500 | 5,000 | per contract |

Meetings, tasks and the dashboard are not in the tier table and stay core until a ticket says otherwise.

## Functional requirements (EARS)

**FR-PLN-001 — Plan registry.** The system shall hold the four plans, each with a switch set and limit
values, in tables the Operator edits through security-definer RPCs; no client role shall write them.

**FR-PLN-002 — Org plan.** Every organisation shall have exactly one plan; an organisation with none
shall resolve as Enterprise.

**FR-PLN-003 — Global switch.** The system shall hold one all-orgs switch per key, default on, written
only by the Operator.

**FR-PLN-004 — Resolution.** When a switch is resolved for an org, the system shall return *off* if the
global switch is off; otherwise the org override if one exists; otherwise the plan's value. Core keys
(D5) shall always resolve *on* and shall be rejected by every write RPC.

**FR-PLN-005a — Receivables display rule (plan 2026-11-02).** Where no org override exists, the
receivables (`revenue`) screens shall additionally hide when an ERP owns revenue (today's behaviour,
OD-NAR-2). This is a display rule only: server enforcement keys `revenue` on global / override / plan, so
ERP invoice sync for such an org keeps working.

**FR-PLN-005 — One resolver.** `org_has_feature` (DB), `useFeature` (FE) and the assistant's tool list
shall all read the same resolved result; no layer re-implements the order.

**FR-PLN-006 — Server enforcement.** While a key resolves *off* for an org, writes to its tables, its
RPCs, its outbox/sync jobs and its edge functions shall refuse with a typed `feature_off` error.

**FR-PLN-007 — Data kept.** When a key turns off, the system shall not delete or archive data; when it
turns back on, the data shall be visible again unchanged.

**FR-PLN-008 — Assistant tools follow switches.** While a key resolves *off*, the assistant shall not be
offered that key's tools, and shall answer that the feature is not on the org's plan. While
`agent_assistant` resolves *off*, every assistant run (interactive chat and fired automations alike)
shall be refused before any model call, and an assistant write may never proceed while its own key is
off or could not be resolved.

**FR-PLN-009 — Missing-tool signal.** When the assistant answers that it has no tool for a request, the
system shall emit one PostHog event carrying org, route, a module guess and a source code (a missing
capability vs. a switched-off module), and no message text.

**FR-PLN-010 — Seats limit.** When an Admin invites a user that would exceed the plan's seats, the
system shall refuse the invite with a message naming the limit; existing members are unaffected.

**FR-PLN-011 — Active-project limit.** When a user creates or reactivates a project that would exceed
the cap, the system shall refuse it; existing projects are unaffected.

**FR-PLN-012 — AI quota.** The system shall grant each org its plan's monthly AI allowance into the
existing org credit pool on a monthly reset, metered as in D10.

**FR-PLN-013 — Operator console.** The Operator Features page shall show, per org: plan picker,
per-key effective state with its source (global / override / plan), override toggles, and an all-orgs
column for global switches. Every change is audit-logged with who and when.

**FR-PLN-014 — Your plan.** An org Admin shall see a read-only page listing the plan, switches on, and
usage against each limit.

**FR-PLN-015 — Module completeness gate.** CI shall fail when a route, nav item or entity is added
without a registered switch key (or an explicit core marking), a plan-table row, and at least one
assistant read tool.

**FR-PLN-016 — Plan in analytics.** The FE shall register the org's plan as a PostHog group property.

## Acceptance criteria (Given/When/Then, owning layer)

- **AC-PLN-001 [pgTAP]** Given the global `stock` switch is off and org A has an override `stock = on`,
  when `org_has_feature(A, 'stock')` runs, then it returns false.
- **AC-PLN-002 [pgTAP]** Given org A on Starter with no override, when `stock` resolves, then false; and
  given an override `stock = on`, then true.
- **AC-PLN-003 [pgTAP]** Given any client role (Admin included), when it writes plans, plan values, org
  plan or global switches directly or via the RPCs, then it is refused; the Operator succeeds.
- **AC-PLN-004 [pgTAP]** Given a core key, when the Operator tries to switch it off at any layer, then
  `core_not_gatable`.
- **AC-PLN-005 [pgTAP]** Given `imprest` off for org A, when a member inserts an imprest float, then
  `feature_off`; when it turns back on, then previous floats are readable unchanged.
- **AC-PLN-006 [Deno unit]** Given `stock` off for the caller's org, when agent-chat builds its tool
  list, then no stock tool is offered and the reply states the feature is not on the plan.
- **AC-PLN-007 [Deno unit]** Given the assistant replies that it lacks a tool, then exactly one
  missing-tool analytics event is emitted with no message text.
- **AC-PLN-008 [Vitest]** Given a key resolves off, then its nav item is absent and its route renders the
  not-available state; given on, both render.
- **AC-PLN-009 [pgTAP]** Given org A at its seat limit, when an Admin invites one more, then refused; the
  existing members still sign in.
- **AC-PLN-010 [pgTAP]** Given org A at its active-project cap, when a project is created, then refused.
- **AC-PLN-011 [pgTAP]** Given a monthly reset, then each org's pool gains exactly its plan allowance
  once (idempotent re-run).
- **AC-PLN-012 [Vitest]** Given the Operator console, then each key shows its effective state and its
  source; an override toggle calls the override RPC.
- **AC-PLN-013 [Vitest]** Given an org Admin, then "Your plan" lists plan, switches and usage, with no
  editable control.
- **AC-PLN-014 [script self-test]** Given a fixture module with a route but no switch key, plan row or
  assistant read tool, then the completeness gate fails naming what is missing.
- **AC-PLN-015 [e2e, one journey]** Given the Operator turns `stock` off for org A, when a user of org A
  opens the app and asks the assistant about stock, then the warehouse is absent from navigation, its
  URL shows not-available, and the assistant says it is not on the plan; a user of org B still sees it.
- **AC-PLN-016 [pgTAP]** Given existing orgs after migration, then each resolves as Enterprise and every
  key's user-visible value is unchanged (for `revenue`: the display rule in FR-PLN-005a).

## Slices (planner refines)

1. **Resolution core** — plans, org plan, global switch, resolver, new keys, Enterprise backfill
   (AC-PLN-001..004, 016). Migrations from the lane's range.
2. **Enforcement** — `feature_off` on writes/RPCs/jobs for each gated module (AC-PLN-005).
3. **FE + console** — `useFeature` on the resolver, Operator console, "Your plan" (AC-PLN-008, 012, 013).
4. **Assistant** — tools follow switches, missing-tool event, plan group property (AC-PLN-006, 007).
5. **Limits** — seats, active projects, AI monthly grant (AC-PLN-009..011).
6. **Completeness gate** — CI check + self-test (AC-PLN-014); then the e2e journey (AC-PLN-015).

Slices 1–3 touch Operator auth and ship alone.

## Out of scope

Billing, payment gateways and prices; self-serve plan change; per-user (not per-org) switches; PostHog
feature flags for entitlement (experiments may still use them).

## Open (owner tickets on the map)

- [Plans: sign off which plan gets each feature switch](https://github.com/ariefsaid/PMO/issues/1719).
- [Plans: what basic leaves out for procurement and sales invoices](https://github.com/ariefsaid/PMO/issues/1720).
