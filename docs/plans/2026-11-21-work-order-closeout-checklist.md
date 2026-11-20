# Work-Order Close-Out Checklist Implementation Plan (#2593)

> Fresh Orca worker per slice; the database slice is Director-dispatched (it gates closing, which fixes the closing value). Spec: `docs/specs/work-order-closeout-checklist.spec.md`. Starts after OD-WCO-1..7 are signed (February to March 2027). Reuses the billing-stage design of 1021; read `supabase/migrations/1021_billing_stages.sql` and `docs/specs/billing-stages.spec.md` first.

## Migration (number assigned by the Director; not numbered here)
One additive migration:
- `closeout_checklist_templates (id, org_id, position smallint 1..20, name text 1..120, required boolean default true, unique(org_id, position))`; `org_id` stamped by the existing org-stamp trigger; RLS select for active members of the org via `(select helper())`; no client write grant.
- `work_order_closeout_items (id, org_id, work_order_id references work_orders on delete cascade, project_id, position, name, required, started_on date, done_on date, document_id uuid references project_documents(id), done_by uuid references auth.users(id), done_at timestamptz, unique(work_order_id, position), check (done_on is null or (document_id is not null and done_by is not null and started_on is not null and done_on >= started_on)))` and index on `(org_id, work_order_id)`; RLS as above.
- `alter table work_orders add column closed_by uuid references auth.users(id)`; no client write grant (the existing column-grant/guard `assert_work_order_update` must permit the server stamp only: extend its allow-list for `closed_by` in the same migration and prove it in pgTAP).
- Functions (all `security definer`, `set search_path = public`, `revoke all ... from public, anon`, grant to `authenticated, service_role` where a client calls them):
  - `set_closeout_checklist(p_items jsonb) returns integer` (Admin only, whole list, at most 20, 1..120-character names, audit row), shape of `set_billing_stage_template`.
  - `instantiate_work_order_closeout_items()` trigger `after update of status on work_orders when (old.status = 'Draft' and new.status = 'Issued')`; copies the template, first item `started_on = (now() at time zone org tz)::date` via `native_org_today`. A work order already `Issued` gets nothing.
  - `lock_closeout_item(p_item uuid)` internal: member, role in (Admin, Finance, Project Manager of the project), lock the `work_orders` row `for update` (same order as `transition_work_order` and `confirm_work_order_acceptance`), refuse when not `Issued` or the item is done.
  - `attach_closeout_item_document(p_item uuid, p_document uuid)` modelled on `attach_billing_stage_document` (1021): the document is a `project_documents` row of the work order's project, status Issued or Approved, with a file (the rule in 0337 `confirm_work_order_acceptance`).
  - `complete_closeout_item(p_item uuid, p_done_on date)` modelled on `complete_billing_stage`: earlier items done, document attached, date not in the future and not before the previous item, stamp `done_by`, `done_at`, start the next item, audit row.
  - `assert_work_order_closeout_complete()` trigger `before update of status on work_orders when (new.status = 'Closed' and old.status is distinct from 'Closed')`: raise `55000`, detail `closeout-incomplete`, naming the count of open required items; otherwise set `new.closed_by := auth.uid()`. Name it so it fires after the existing closed-value guard and `assert_work_order_update` (alphabetical trigger order, as `*_zz_*` in 1021) and prove ordering in pgTAP. This one predicate covers `transition_work_order` and the final-acceptance update.
- Do **not** edit `transition_work_order` or `confirm_work_order_acceptance`; the trigger is the single gate. Their existing refusals (contract lines, closing-value rules) stay and run first or last without conflict; AC-WCO-006 proves the acceptance stays unconfirmed (one transaction).
- **Rollback:** `supabase/migrations/rollback/<number>_work_order_closeout_down.sql` drops the two triggers, the functions, the two tables and `work_orders.closed_by`, and restores the `assert_work_order_update` allow-list. Header notes that a closed work order's `closed_by` is lost.

## Slice 1: pure derivation (Orca)
- [ ] Test first `pmo-portal/src/lib/closeoutChecklist.test.ts` (AC-WCO-008), then `pmo-portal/src/lib/closeoutChecklist.ts`: `closeoutItemAgeDays`, `closeoutRemaining(items)` (open required count). Reuse `stageAgeDays` rather than a second age rule (import or generalise it in `src/lib/billingStages.ts` only if a test shows the need).

## Slice 2: database (Director-dispatched Orca worker, Opus)
- [ ] pgTAP `supabase/tests/<number>_work_order_closeout.test.sql`: AC-WCO-001..007, 009, 010. Fixtures follow `supabase/tests/0960_billing_stages.test.sql` (owner-written rows, client checks as `authenticated`); include a work order with contract lines and a final acceptance (follow the 0337 acceptance tests), a second organisation, Admin, Finance, Project Manager, Engineer.
- [ ] Mutation checks: drop the closing trigger (AC-WCO-005 and 006 red); remove the role check in `complete_closeout_item` (AC-WCO-003 or the role case red); let a Draft document attach (AC-WCO-003 red); restore each.
- [ ] `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` as one lock hold.

## Slice 3: data seam and screen (ui-implementer; `restructure` skill, `docs/ux/screen-rules.md`)
- [ ] `pmo-portal/src/lib/db/closeoutChecklist.ts` (typed reads and the four calls; validates every field, never defaults a missing one), `pmo-portal/src/lib/repositories/closeoutChecklist.ts` with a contract in `src/lib/repositories/contracts/`, hook `src/hooks/useCloseoutChecklist.ts`; mocked-client unit tests for error classification (`classifyMutationError` gets `closeout-incomplete`, `item-out-of-order`, `item-document-missing`).
- [ ] `can()` entries in `pmo-portal/src/auth/policy.ts`: `closeoutItem` edit for Admin, Finance, Project Manager (UX only; the database is the authority), `closeoutChecklist` edit for Admin.
- [ ] Screen: owner sketch-glance first. `pmo-portal/pages/work-order-detail/CloseoutSection.tsx` on `/work-orders/:id` (ordered items, age, document picker from the project's issued or approved documents, done date, who and when; the Close action shows the remaining required count). Admin list editor beside the other organisation settings, built with the shared form primitives. RTL `CloseoutSection.test.tsx` (AC-WCO-011), behaviour only.
- [ ] Strings: `pmo-portal/public/locales/en/closeout.json` and `.../id/closeout.json`, registered where the other namespaces are; Bahasa Indonesia confirmed by the owner.
- [ ] E2E `pmo-portal/e2e/AC-WCO-012-work-order-closeout.spec.ts` (read `docs/e2e-parallel-conventions.md`; tag isolation class).
- [ ] `scripts/ux-proof.sh` on `/work-orders/:id` and the settings route.

## Traceability

| AC | Owning layer | File |
|---|---|---|
| AC-WCO-001..007, 009, 010 | pgTAP | `supabase/tests/<number>_work_order_closeout.test.sql` |
| AC-WCO-008 | Unit | `pmo-portal/src/lib/closeoutChecklist.test.ts` |
| AC-WCO-011 | RTL | `pmo-portal/pages/work-order-detail/CloseoutSection.test.tsx` |
| AC-WCO-012 | E2E | `pmo-portal/e2e/AC-WCO-012-work-order-closeout.spec.ts` |

## Glossary and docs
- [ ] `docs/glossary.md`: Close-out checklist, Close-out item. Add the close rule to `docs/specs/work-order-record-page.spec.md` and the work-order sections of `docs/money-path-primer.md`. ADR: none expected; if the owner rules a second approver (OD-WCO-7), record it in an ADR.
- [ ] Update the roadmap issue (#1571) in the same session as the build ships.

## Final gate
`cd pmo-portal && npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, the touched pgTAP file, the touched e2e journey (`scripts/e2e-local.sh <fragment>`), `node scripts/affected-e2e.mjs`, `scripts/ux-proof.sh`. No full local suite. Reviewers: spec, code quality, security-auditor.
