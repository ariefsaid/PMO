# Spec: Monthly billing plan, candidates against a target (#2682)

**Ticket words to ours:** "progress not yet client-certified" = quantities the client has accepted (confirmed acceptance) that are not yet claimed, i.e. accepted quantity above claimed quantity (the Cascade's "Unclaimed"), plus money-only orders with a remaining amount.

**Status:** approved by the Director (OD-MBP-2/4/5/8, currency-with-target, money-only orders, over-claim warning only: decided); phase 2 built. Ships for the 15 December 2026 release (OD-SCOPE-1). Map #2516, money path, ships alone. IDs `FR-MBP-###`, `NFR-MBP-###`, `AC-MBP-###`, `OD-MBP-#`. Plan: `docs/plans/2026-11-21-monthly-billing-plan.md`. Stacked on #2681 (`billing-board.spec.md`) and #2680 (`claim-billing-steps.spec.md`). Next ticket #2675 (age of done-not-claimed on this screen) builds on it; this spec leaves its seams.

## Owner ruling applied (OD-SCOPE-6, settled)
The billing plan only **shows candidates**. Holding a claim to the next month can be deliberate, so the plan never raises a claim, never creates an invoice and never pushes anything to billing. The done-not-claimed reminder is information, **off as an alert by default**. Over-claim stays a **warning, not a block**. OD-SCOPE-2: no client process, name, threshold or month rule in code; the target and the reminder switch are organisation settings.

## Job story
When I plan the month's billing, I want to see which items are worth billing against a target, so I choose deliberately.

## Terms (new)
- **Candidate**: a unit of work the client has accepted but not yet claimed: "progress not yet client-certified" in the owner's words. Two kinds: a **quantity line** (one work-order allocation of a contract line with accepted quantity above claimed quantity) and a **money-only order** (a customer order with no lines and a positive remaining amount).
- **Unclaimed**: the one definition already on the project Cascade: `accepted quantity - claimed quantity` (never below 0) times the contract line rate, per allocation; money-only orders use their `remaining` where figures are complete. This spec adds no second definition (see OD-MBP-1).
- **Monthly target**: an amount the organisation aims to bill in a calendar month, in one currency.
- **Plan (pick list)**: the candidates a viewer has ticked for a month, with a running total against the target. View state only (OD-MBP-4).

## What is stored (plain statement)
1. **Settings** (new): one row per organisation (`org_billing_plan_settings`): default monthly target amount + its currency, and the done-not-claimed reminder switch (default off).
2. **Month targets** (new): optional rows (`billing_plan_month_targets`), one per organisation and calendar month, overriding the default for that month.
3. **Nothing else.** Ticked candidates are NOT stored in the database: no plan table, no claim, no invoice, no claim line, no step row, no note. Ticks live in the browser view for the session and are lost on reload (OD-MBP-4). The candidates and every money figure are computed live in the database from existing records; nothing is cached or copied.

## Context and reuse (checked on the #2681 tip)
- Unclaimed per allocation is computed on the Cascade (`pages/project-detail/ContractCascade.tsx`, `lineCanInvoice` and `hasUnclaimedQuantity`) from `get_project_billing(project)` (head definition in 1046: `boq[].allocations[]` with `accepted_quantity`, `claimed_quantity`; claims counted = non-withdrawn, not-cancelled invoices, plus opening balances) times `boq_items.rate`. Money-only orders come from the `work_order_billing` view (`line_count = 0`, `figures_complete`, `remaining`), as `moneyOrderCanInvoice`, with the added rule that an order that has contract lines is not also counted as a lump. The candidate read **calls those same sources** rather than restating the arithmetic, so a figure on the plan equals the Cascade's.
- Age seam for #2675: `work_order_uninvoiced_acceptance.days` (0441) and `work_order_acceptances.confirmed_at`. The read returns `accepted_on` (latest confirmed acceptance date for the order) so #2675 can add an age column without a new read.
- Over-claim today: `remainingQuantity(contractQuantity, claimedQuantity) < 0` on the Billing tab, shown as "Over-claimed" (`progressBilling.ts`, `BillingTab.tsx`). The plan reuses that function: a ticked quantity line warns when `remainingQuantity(contract_quantity, claimed_quantity + picked quantity) < 0`. A warning, never a block.
- Visibility: claims and money are visible to Admin, Executive, Project Manager, Finance (same as `billing-board`). The read is security invoker, so RLS on `projects`, `boq_items`, `work_orders`, `work_order_acceptances`, `progress_claims` decides; an Engineer gets no rows.
- Existing screens untouched except one gated entry link (FR-MBP-050). Existing tests untouched.

## Decisions (stated plainly; Director may override)
- **OD-MBP-1 One definition of unclaimed.** The read function wraps `get_project_billing` (per project, lateral) and `work_order_billing`; it does not recompute claimed or accepted quantity. A pgTAP parity test pins the read to `get_project_billing` for a seeded project. Cost bounded by OD-MBP-6.
- **OD-MBP-2 Target per organisation per month.** A default monthly target on the settings row, plus an optional per-month override row. No per-project target (not trivial: it would need project access rules and a second currency story). Currency is stored with the target; the running total counts only candidates in that currency, and candidates in other currencies are listed with their own subtotal marked "not counted toward the target". No FX conversion here (no second money rule).
- **OD-MBP-3 Month means the calendar month of the organisation's today** (organisation time zone, not the device clock, as the board). The screen offers previous / this / next month for the target view; candidates do not depend on the month (they are what is unclaimed now). A month with no target and no default shows the plan without a target line and says "No target set".
- **OD-MBP-4 Picking is view state, not stored.** Recommended over a saved plan note: a stored note would be a second place a claim intention lives, would need its own staleness rules when quantities change, and risks being read as a commitment. Ticks reset on reload; the screen says so. A saved plan can be a later ticket if the client asks.
- **OD-MBP-5 Settings writers are Admin or Finance, DB enforced.** One security-definer function `set_billing_plan_settings(p_target, p_currency, p_reminder_on)` and `set_billing_plan_month_target(p_month, p_target)` (null target clears the override). No direct table write grant. Both check the real role (Admin or Finance) and active membership, stamp `org_id` from `auth_org_id()`, and are not callable by `anon`.
- **OD-MBP-6 Bounded read.** One security-invoker function, projects limited to those with a confirmed acceptance or a money-only order with figures, 500 candidate rows maximum (501 returned, the screen shows 500 plus a truncated notice), ordered by value descending then project name. Optional `p_project` filter.
- **OD-MBP-7 Reminder setting only.** This ticket stores `done_not_claimed_reminder_on boolean default false` and exposes it in the settings form with plain words that it is information. It does NOT show an alert, age column or day count (that is #2675). #2675 reuses the column, adds its own "after N days" column on the same row, and reads the setting through the same repository call.
- **OD-MBP-8 Entry link, no rail item.** One link "Billing plan" on the Receivables header next to "Billing board", shown only when the organisation has a settings row or the candidate read returns at least one row (FR-MBP-050). Route `/finance/billing-plan`, same gate as Receivables (`FinanceAccessRoute` + `revenue` feature), as the board. Settings opened from a "Plan settings" button on the screen, visible only to Admin and Finance (`can('edit','billingStage')`, the existing Admin/Finance finance-setup gate, reused rather than a new entity; UX only, the definers enforce).

## Requirements (EARS)
- **FR-MBP-001** The system shall provide `billing_plan_candidates(p_project uuid default null)` returning one row per candidate: kind (`line` or `order`), project id and name, currency, work order id and number, contract line id, item code and description, unit, rate, contract quantity, accepted quantity, claimed quantity, unclaimed quantity, value (`round(unclaimed quantity * rate, 2)` for a line; `remaining` for a money-only order), `accepted_on` (date of the latest confirmed acceptance of the order, null if none), and the organisation's today.
- **FR-MBP-002** The function shall be `security invoker` (RLS decides visibility) and shall return rows only to Admin, Executive, Project Manager and Finance, because Engineers can read projects but not claim money (found when the pgTAP ran: RLS alone returned rows to an Engineer); a user of another organisation gets no candidate of this organisation.
- **FR-MBP-003** A line shall be a candidate only when its accepted quantity is not null and exceeds its claimed quantity on a non-cancelled work order; a money-only order only when it has no contract lines of its own, `line_count = 0` (nothing billed against it yet), `figures_complete` and `remaining > 0`, and status Issued or Closed. (An order with contract lines is counted through those lines, never again as a lump; the Cascade's own `lineCount === 0` test counts billing records, so reusing it alone would count a lined order twice.) Archived projects shall not appear.
- **FR-MBP-004** Its figures shall equal the Cascade's: unclaimed quantity per allocation and money-only remaining equal `get_project_billing` and `work_order_billing` for the same project.
- **FR-MBP-005** When `p_project` is given, only that project's candidates return. At most 501 rows return.
- **FR-MBP-010** The system shall provide `org_billing_plan_settings` (one row per organisation: `monthly_target numeric(14,2)` null or `>= 0`, `target_currency text`, `done_not_claimed_reminder_on boolean not null default false`, audit columns) and `billing_plan_month_targets` (organisation, month first day, target `>= 0`). A target without a currency shall be refused.
- **FR-MBP-011** Reads of both tables shall be limited by RLS to Admin, Executive, Project Manager and Finance of the organisation; writes only through the two definer functions, by Admin or Finance, with `org_id` taken from the caller's membership.
- **FR-MBP-012** An organisation with no settings row shall behave as: no target, reminder off.
- **FR-MBP-020** The client shall compute the plan in one pure module `billingPlan.ts`: the picked total in the target currency (integer cents, as `progressBilling.ts`), the remaining to target (may be negative), other-currency subtotals, and the over-claim warnings via `remainingQuantity`.
- **FR-MBP-021** The screen shall list candidates grouped by project, each line with a checkbox, item, order number, unclaimed quantity, value and (reserved, not rendered here) an age cell hook for #2675; a sticky summary shows target, picked total, remaining or "above target by", and the other-currency subtotals.
- **FR-MBP-022** When a ticked quantity line would take claimed quantity past the contract quantity, the line shall show the existing over-claim warning; nothing shall be blocked and no write is made.
- **FR-MBP-023** The screen shall carry the plain statement "Candidates only. Nothing here raises a claim or an invoice." and a Select all in project / Clear control.
- **FR-MBP-024** The screen shall show an explicit empty state, a loading state, an error state that says the read failed (never a zero), the truncated notice, and "No target set".
- **FR-MBP-030** Admin and Finance shall edit the default target, its currency, the reminder switch and a month override in a form built on the shared primitives; other roles shall not see the edit control.
- **FR-MBP-040** All strings shall exist in English and Bahasa Indonesia; counts use plural forms; amounts use the shared money formatter for the target currency.
- **FR-MBP-050** The Receivables header shall show the entry link only per OD-MBP-8, with its own silent boundary (a failed read hides the link, never blocks Receivables).

## Non-functional requirements
- **NFR-MBP-001** The screen is read-only except the settings form: no database write is reachable from candidate or tick actions.
- **NFR-MBP-002** The read is one RPC; per-project work is a lateral call bounded by OD-MBP-6. If the unpaged-read guard flags the repository, add a reasoned entry, never loosen the guard.
- **NFR-MBP-003** New tables and two client-callable definer functions: isolation fragment `scripts/isolation-probe-denominator.d/2682-monthly-billing-plan.json` (tables + definers) and an anon-definer inventory entry for each definer (not executable by `anon`); `check-isolation-denominator.mjs` clean.
- **NFR-MBP-004** DESIGN.md tokens, shared primitives, 44 px touch targets on phone, `restructure` skill applied; phone 390 px and desktop 1440 px.

## Acceptance criteria and owning layer
| AC | Given / When / Then | Layer |
|---|---|---|
| AC-MBP-001 | Given allocations with accepted above claimed, when a Finance user reads candidates, then each appears once with unclaimed quantity and value = unclaimed x rate | pgTAP |
| AC-MBP-002 | Given a project, then each candidate's unclaimed quantity equals the same allocation in `get_project_billing`, and a money-only order's value equals `work_order_billing.remaining` | pgTAP |
| AC-MBP-003 | Given accepted null, accepted not above claimed, a cancelled order, an archived project, or a money-only order with incomplete figures, then none appear | pgTAP |
| AC-MBP-004 | Given an Engineer, then no rows; given another organisation's user, then none of this organisation's | pgTAP |
| AC-MBP-005 | Given `p_project`, then only that project's rows; given more than 500, then exactly 501 return, value descending | pgTAP |
| AC-MBP-006 | Given Admin or Finance, when they set the settings and a month target, then rows are stored with their org; given Project Manager, Executive, Engineer or anon, then the call is refused and nothing is stored | pgTAP |
| AC-MBP-007 | Given a client, when it inserts, updates or deletes either settings table directly, then it is refused; reads are limited to the four roles of the organisation; another organisation sees nothing | pgTAP |
| AC-MBP-008 | Given a target with no currency, a negative target, or a null reminder, then the write is refused with a plain error | pgTAP |
| AC-MBP-009 | Given no settings row, then the settings read returns none and the reminder is off; given a set row, the reminder defaults to off until switched on | pgTAP |
| AC-MBP-010 | Given picks in the target currency, then the picked total in integer cents, the remaining (or above-target) and other-currency subtotals are right; empty picks total 0 | unit |
| AC-MBP-011 | Given a picked line whose claimed + unclaimed passes the contract quantity, then the over-claim warning is returned by the same `remainingQuantity`; a line within it has none; nothing is blocked | unit |
| AC-MBP-012 | Given a month override and a default, then the override wins for that month and the default for another; with neither, "No target set" | unit |
| AC-MBP-013 | Given the plan renders, then candidates are grouped by project, ticking updates the summary, the statement "candidates only" shows, and no write function is called | unit (RTL) |
| AC-MBP-014 | Given the read fails, then an error state shows, not an empty plan; zero rows gives the empty state; truncation gives the notice | unit (RTL) |
| AC-MBP-015 | Given Admin or Finance, then the settings control shows and saving calls the settings repository; given a Project Manager, then no control | unit (RTL) |
| AC-MBP-016 | Given Bahasa Indonesia, then headings, summary, warning and empty text are translated | unit (RTL) |
| AC-MBP-017 | Given Receivables with no settings and no candidates, then no entry link; with either, the link opens the plan | unit (RTL) |
| AC-MBP-018 | Given a Finance user with a seeded accepted line, when they open the plan from Receivables, tick the line and see the total against the target, then the claim list and invoice list are unchanged | e2e (one journey) |

## Errors
| Case | Behaviour |
|---|---|
| Read fails | Error state with retry; never an empty plan or a zero total |
| Role without access | Empty state "No candidates to show"; no settings control |
| Settings write refused (role, value) | Form error from `classifyMutationError`, values kept |
| Target currency differs from a candidate | Candidate listed, subtotal shown apart, not counted toward the target |

## Out of scope
Raising claims, invoices, saved plan notes, per-project targets, FX conversion, the age column and alert (#2675), any change to the Billing tab or Cascade.

## Build plan notes (phase 1)
- Migrations **1375** `billing_plan_settings` (two tables, RLS, grants, the two definer writers) and **1376** `billing_plan_candidates_read` (the invoker function), each with a rollback in `supabase/migrations/rollback/`. **1377** reserved for a supporting index only if needed; 1378-1379 unused.
- pgTAP `supabase/tests/1375_billing_plan_settings.test.sql`, `1376_billing_plan_candidates.test.sql`; fixtures follow `1370_billing_board.test.sql`.
- Pure `pmo-portal/src/lib/billingPlan.ts`; data `src/lib/db/billingPlan.ts` + repository + hooks; page `pmo-portal/pages/BillingPlan.tsx`; `BillingPlanLink` on Receivables; route in `App.tsx`; strings en and id; glossary entries (Candidate, Monthly target, Plan).

## Build notes (#2682, as built)
- **Settings gate:** the Plan settings button uses the existing `can('edit','billingStage')` (Admin, Finance), not a new entity; the two definers are the authority (pgTAP: Project Manager, Executive, Engineer refused).
- **Candidates read:** also names the four money roles (an Engineer can read projects, so RLS alone returned rows to one; found by the first pgTAP run). A money-only order is one with no contract lines of its own, so a lined order is never counted twice.
- **Currency:** the settings form pre-fills the organisation currency; a target is stored with whatever currency is entered, and only candidates in that currency count toward it.
- **e2e:** one journey in the serial lane (it saves the organisation-wide setting). A confirmed acceptance cannot be deleted (0337), so the journey archives its project, which removes its work from every plan.
- **Topbar title:** like the billing board, the page sets its own heading and adds no route-label module (no Rail change).
- **Reminder switch:** stored and editable; nothing reads it yet (#2675 does).
