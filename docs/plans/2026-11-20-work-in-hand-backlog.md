# Work in Hand and Backlog Implementation Plan (#2575)

## Built on defaults (owner to confirm)

Built to the spec's recommended defaults; none is a ruling. Each is one place to change.

- OD-WIH-1 Billed to date = invoiced work (Submitted, Unpaid, Paid; net of tax plus down-payment recovery), read only from `sales_invoice_work_billed`. Billed to date runs through the end of the as-of month, as the management pack's invoiced to date does.
- OD-WIH-2 Billing window = the last 6 complete months (`WINDOW_MONTHS` in `pmo-portal/src/lib/workInHand.ts`); months counted run from the first billing month inside the window.
- OD-WIH-3 A zero rate shows "No billing rate" and ranks after every row with a rate. A row with Left to bill 0 shows 0.0 months and ranks after open work with a rate, before rows with no rate.
- OD-WIH-4 Default order is Left to bill descending; months of backlog is the alternate order (a toggle on the screen).
- OD-WIH-5 Access: Admin, Executive, Finance (database function and route). Project Manager is refused.
- OD-WIH-6 Work in hand = the Contract on hand set (`Won, Pending KoM`, `Ongoing Project`, `On Hold`, `Close Out`, not archived) plus `Issued` work orders of those contracts; the two levels are shown in their own rows and never added.
- OD-WIH-7 Months of backlog derives from Left to bill (invoice basis), not Remaining work.
- OQ-WIH-1 The screen follows whatever `contract_value` holds.
- OQ-WIH-2 A work order with no billing yet does not borrow its contract's rate: it shows "No billing rate".
- OQ-WIH-3 Bahasa Indonesia wording is the spec's default ("Sisa tagihan", "Bulan backlog", with "invoice" for invoice per the id catalogue rule); to confirm.
- OQ-WIH-4 Not changed: contract value stays readable through the existing project reads; the role gate is a presentation gate only.

Build notes: migration number is 1060 (assigned range 1060-1064); the screen lives at `pmo-portal/pages/finance/WorkInHand.tsx` beside the other finance pages (the plan named `pages/WorkInHand.tsx`); the route sits behind the `revenue` module switch as well as `can('view','finance')`; the entry is a link on the Finance hub, not a new rail item. Work orders whose contract is not ranked (no value, incomplete) are listed at the top level of their currency table.

> Fresh Orca worker per slice. Spec: `docs/specs/work-in-hand-backlog.spec.md`. Read-only money path; no posting, no SoD change. Starts after sign-off of OD-WIH-1..6 and the owner's layout sketch-glance (scheduled after the December go-live). Builds on `sales_invoice_work_billed` (0498), `work_order_billing` (0337), `get_project_billing` (0921), `org_current_month` (0245) and the work-order record page (#2518).

## Migration (1060)
One migration, additive: a `security invoker`, `stable` function `get_work_in_hand(p_as_of date default null)` returning one `jsonb` value. No table, column or grant change.
- Gate first: `is_active_member()` and `auth_role() in ('Admin','Executive','Finance')`, else raise `42501` (same shape as `get_project_finances`, 0498).
- As-of = `coalesce(p_as_of, org_current_month-aware local date)` from `organizations.default_timezone`; the window is the 6 complete months before the as-of month.
- Contracts: `projects` in the Contract on hand set (status in `Won, Pending KoM`, `Ongoing Project`, `On Hold`, `Close Out`; `archived_at is null`; the 0919 `on_hand` rule); net value by the 0901 expression; value 0 listed under `no_value`.
- Billed: read only `sales_invoice_work_billed` (status in Submitted/Unpaid/Paid, `net + recovery`, down payment zero, `net is not null`, `invoice_date is not null`, currency equal to the contract's). An undated invoice is excluded and counted once; a valued invoice in another currency, or a priced invoice with a null `net`, marks that contract `incomplete` and is counted by contract (the pack only counts unpriced invoices org-wide because its unpriced read carries no project — here the view has `project_id`, so attribute it). Per contract and per work order return `billed_to_date` and the window's billed per local month (`invoice_date` bucketed in the organisation timezone). No rate and no backlog in SQL: the arithmetic lives in the unit-tested TypeScript function so it has one implementation.
- Work orders: `Issued` only, value as `work_order_billing.order_net`, and `figures_complete` taken from that view rather than re-derived. A closing value exists only on a Closed work order, so no work-in-hand row carries one.
- Bounds: 500 contracts, 3,000 work orders, `truncated` flag.
- `revoke all ... from public, anon; grant execute ... to authenticated`. RLS-initplan rule: any policy wrapper uses `(select helper())` (none added).
- **Rollback:** `supabase/migrations/rollback/1060_work_in_hand_down.sql` = `drop function if exists public.get_work_in_hand(date);`.
- ADR candidate: none expected; if the owner rules a different billed definition (OD-WIH-1), record it in an ADR amending ADR-0077 decision 9 because every billing reader shares it.

## Slice 1: pure derivation (Orca)
- [ ] Write first `pmo-portal/src/lib/workInHand.test.ts` with the hand-calculated fixture and AC-WIH-001..008, then `pmo-portal/src/lib/workInHand.ts` exporting `deriveWorkInHand(rows, asOf)` and `rankWorkInHand(rows, order)`. Integer cents via `parseExactCents` / `formatExactCents` from `src/lib/exactDecimal.ts`; no float arithmetic; half-up one-decimal rounding; ranking within currency; undefined rate as a distinct state. Verify: `cd pmo-portal && npx vitest run src/lib/workInHand.test.ts`.
- [ ] Display helpers reuse `formatExactMoney` (`src/lib/format.ts`) and, where a compact form is wanted, `formatDashboardMoney` (`src/lib/dashboardMoney.ts`); none new unless a test shows a gap.

## Slice 2: database read (Orca)
- [ ] pgTAP `supabase/tests/work_in_hand.test.sql`: AC-WIH-009..016 and 018 (fixture invoices including a down payment, Draft, Cancelled, paired copy, an other-currency invoice, an undated invoice, an invoice with no amount, a late-month invoice in a UTC+7 organisation, a Closed work order with a stamped closing value, a zero-value contract, a second organisation, a Project Manager and an offboarded account). AC-WIH-009 also asserts equality with `get_project_billing(project).work_billed`. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/work_in_hand.test.sql'`.
- [ ] Migration as described above. Mutation check: remove the role gate (AC-WIH-013 red), add Draft to the status filter (AC-WIH-009 red), allow undated invoices through (AC-WIH-018 red); restore.
- [ ] `pmo-portal/src/lib/db/workInHand.ts` (typed read, validates every figure; a missing or non-numeric one is an error, never 0, as in `src/lib/db/workOrderBilling.ts`), `src/lib/repositories/workInHand.ts` repository seam (ADR-0017), hook `src/hooks/useWorkInHand.ts`. Unit tests with mocked client for error classification.

## Slice 3: screen (ui-implementer; `restructure` skill and `docs/ux/screen-rules.md`)
- [ ] Owner sketch-glance first (directional layout only).
- [ ] `pmo-portal/pages/WorkInHand.tsx`, route `/finance/work-in-hand` in `pmo-portal/App.tsx` inside `FinanceAccessRoute` (`can('view','finance')`), preloaded entry beside the other finance routes, link from the finance hub. Per currency: total remaining and total rate; ranked table, contract rows with their work orders beneath, sort switch (remaining / backlog), month-by-month drill-down of the window, one data finding line, one hidden-figures line (no value set, no billing rate, figure incomplete with its cause, undated invoices, truncated). Order on screen follows the screen rules (what is off first: "no billing rate" and over-billed rows, then position, then table). Empty, loading and error states; phone width.
- [ ] Strings: new namespaces `pmo-portal/public/locales/en/workInHand.json` and `.../id/workInHand.json`, registered where the other namespaces are. English: "Work in hand", "Left to bill", "Billed to date", "Billing rate per month", "Months of backlog", "No billing rate", "Billed over value". Bahasa Indonesia (to confirm, OQ-WIH-3): "Pekerjaan dalam tangan", "Sisa tagihan", "Sudah ditagih", "Laju penagihan per bulan", "Bulan backlog", "Belum ada laju penagihan", "Penagihan melebihi nilai".
- [ ] E2E `pmo-portal/e2e/AC-WIH-017-work-in-hand-ranking.spec.ts` (Finance user; seeded contracts; assert ranking, sort switch, row opens its page). Read `docs/e2e-parallel-conventions.md` first and tag isolation class.
- [ ] Unit/RTL: render of the hidden-figures line and truncation (AC-WIH-016); behaviour assertions only, no look-pinning.
- [ ] `scripts/ux-proof.sh` on `/finance/work-in-hand`.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-WIH-001..008 | Unit | `pmo-portal/src/lib/workInHand.test.ts` |
| AC-WIH-009..015, 018 | pgTAP | `supabase/tests/work_in_hand.test.sql` |
| AC-WIH-016 | pgTAP (owner) | `supabase/tests/work_in_hand.test.sql`; also referenced: Unit render in `pmo-portal/pages/WorkInHand.test.tsx` |
| AC-WIH-017 | E2E | `pmo-portal/e2e/AC-WIH-017-work-in-hand-ranking.spec.ts` |

## Glossary and docs
- [ ] Terms in `docs/glossary.md` (added with this spec): work in hand, Left to bill, billed to date, current billing rate, months of backlog.
- [ ] Update the roadmap issue (#1571) in the same session as the build ships.

## Final gate
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, the touched pgTAP file and e2e journey (`scripts/e2e-local.sh <fragment>`), `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh` on the touched route. No full local suite.
