# Review requests (#980) implementation plan

> Follow `docs/orca-dispatch.md` and TDD. Planning artifact; do not build until the spec is signed off.

**Goal:** Let an author hand a Draft budget or work order to a reviewer in-app, with queue entry, duplicate guard,
withdraw, and a "Waiting for" line; show procurement's real routing the same way.
**Architecture:** One new table `review_requests` + three security-definer RPCs + notify triggers; DAL/repository
under the existing seam; two new kinds in the `/approvals` selector; a shared `WaitingForLine` component.
**Spec:** `docs/specs/review-requests.spec.md`. **Tier:** money path; ships alone; Opus builder; three reviewers.

## Migration `NNNN_review_requests.sql` (number on request) + `rollback/NNNN_review_requests_down.sql`

```sql
create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references public.organizations(id),
  kind text not null check (kind in ('budget_version','work_order')),
  record_id uuid not null,
  requested_by uuid not null default auth.uid() references public.profiles(id),
  reviewer_id uuid references public.profiles(id),
  note text check (note is null or length(note) <= 500),
  state text not null default 'Open' check (state in ('Open','Withdrawn','Resolved')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index review_requests_one_open on public.review_requests (kind, record_id) where state = 'Open';
alter table public.review_requests enable row level security;
alter table public.review_requests force row level security;
-- select: same org AND (requested_by = auth.uid() OR reviewer_id = auth.uid() OR public.review_request_pool_has(id, auth.uid()))
-- no insert/update/delete policy; revoke all on the table from anon, authenticated except select.
```

RPCs (all `security definer set search_path = public, pg_temp`, active-member gate, `revoke ... from public, anon`):
`request_review(p_kind text, p_record_id uuid, p_reviewer uuid default null, p_note text default null) returns uuid`,
`withdraw_review_request(p_id uuid) returns void`, `review_request_pool(p_kind text, p_record_id uuid) returns table(id uuid, full_name text)`.
Triggers: AFTER UPDATE OF status on `budget_versions` (Draft→Active) and `work_orders` (Draft→Issued/Cancelled)
resolve the Open request and notify the requester. Notify via `notify_workflow_user` (`0237`). Pool logic copies the
live predicates (`0579` activate arm; `work_order_issue_eligibility` per candidate); comment each with a MIRRORS note.
Rollback drops triggers, functions, then the table (disposable local DB only).

## Tasks (2–5 min each; red → green → commit)

1. pgTAP `supabase/tests/review_requests_core.test.sql`: AC-RRQ-001/002/012 (create, duplicate refused by the unique
   index, non-Draft and no-edit-rights refused). Then table, index, RLS, `request_review`.
2. pgTAP `review_requests_pool.test.sql`: AC-RRQ-003/004 (pool excludes requester, editors, drafter; named outside pool
   refused; notification counts). Then `review_request_pool` + notifications.
3. pgTAP `review_requests_resolve.test.sql`: AC-RRQ-006/007/011 (activate/issue/cancel resolves and notifies; withdraw
   by requester and Admin only; re-request after withdraw). Then triggers + `withdraw_review_request`.
4. pgTAP `review_requests_rls.test.sql`: AC-RRQ-010 (other org, unrelated user, anon see/write nothing; direct DML
   denied). Mutation-check: set the org predicate true, tests must go red.
5. DAL `pmo-portal/src/lib/db/reviewRequests.ts` + repository `src/lib/repositories/reviewRequests.ts` + hook
   `src/hooks/useReviewRequests.ts` (Vitest: forwards args, maps rows, classifies duplicate error via
   `classifyMutationError`; never sends `org_id`).
6. Selector: add `'budget_review' | 'work_order_review'` kinds to `src/lib/selectors/approvals.ts`; Vitest AC-RRQ-005
   (reviewer sees, ineligible does not, keys stay distinct). Add sections in `pages/Approvals.tsx`.
7. `pages/approvals/ReviewRequestSection.tsx` + unit test (renders kind, project, requester, age; links to record).
8. `src/components/WaitingForLine.tsx` + test AC-RRQ-008/009 (named vs pool label, sent time, procurement route
   names, Bahasa copy); mount on the budget draft view, `WorkOrdersTab.tsx` draft row, and the procurement detail.
9. Request/withdraw buttons gated by `can()` / `<CanWrite>` on the draft budget and WO; confirm-less request,
   `ConfirmDialog` for withdraw. i18n keys en + id (FR-RRQ-012).
10. One curated e2e `pmo-portal/e2e/AC-RRQ-006-request-activate-handoff.spec.ts`: author requests, reviewer sees it in
    `/approvals`, activates, request resolved, author notified. Isolation tag per `docs/e2e-parallel-conventions.md`.
11. Docs: add "review request" to `docs/glossary.md`; ADR only if the owner picks the per-kind-table alternative.

**Verify (local gate, per CLAUDE.md):** `npm run check:guards`; `npm run typecheck`; `npx eslint --max-warnings=0
<touched>`; the touched vitest files; `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db
supabase/tests/review_requests_*.test.sql'`; `scripts/e2e-local.sh AC-RRQ-006`; `scripts/ux-proof.sh` on `/approvals`.

## Traceability (ADR-0010: one owning layer each)

| AC | Owning layer / test |
|---|---|
| AC-RRQ-001, 002, 012 | pgTAP `review_requests_core` |
| AC-RRQ-003, 004 | pgTAP `review_requests_pool` |
| AC-RRQ-005 | Vitest selector `approvals.test.ts` |
| AC-RRQ-006 | e2e `AC-RRQ-006-request-activate-handoff` (SQL resolve in pgTAP `_resolve`) |
| AC-RRQ-007, 011 | pgTAP `review_requests_resolve` |
| AC-RRQ-008, 009 | Vitest `WaitingForLine.test.tsx` |
| AC-RRQ-010 | pgTAP `review_requests_rls` |

## Owner questions (recommended answer first)

1. Name a single reviewer, or always notify the whole pool? Recommend: optional named reviewer, default whole pool.
2. Should the requester be able to nudge (re-notify) after N days? Recommend: no, defer; age is shown in the queue.
3. Ship budget and work order together? Recommend: yes, one table and one slice; procurement display rides along.
