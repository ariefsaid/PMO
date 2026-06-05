# Plan: Timesheet submit / approve module (build-wave #3)

- **Spec:** `docs/specs/timesheets-approval.spec.md` (FR-TS-001..011, AC-900..911).
- **Decisions:** `docs/decisions.md` OD-TS-1/2/3 (binding); assumed owner-flags OD-TS-A/B/C/D (flagged,
  non-blocking; pin before merge).
- **No new ADR.** `transition_timesheet` is a **direct application of ADR-0012** (the procurement
  transition-RPC pattern: `security definer` + internal authz re-assertion + map-as-data + pinned
  `search_path = public` + revoke-anon + schema-qualified table refs), itself ADR-0011 generalized. No
  genuinely new architectural decision is introduced (single-table whole-week state machine, no
  doc-number minter, no new child tables). The one RLS-select addition (FR-TS-008) is a policy extension,
  not an architectural decision. Recorded here per the playbook: **follows ADR-0012 pattern**.
- **Layer ownership:** ADR-0010. Each AC has exactly one owning test at the lowest sufficient layer.

Strict TDD: every behavior task writes a failing test (RED) first, then the minimum implementation (GREEN).
The eng-planner writes ONLY this plan + the spec; the implementer writes the code/tests. Run `npm`/`vitest`/
`playwright` from `pmo-portal/`; run `supabase test db` and `supabase db reset` from the repo root.

---

## 1. Design

### 1.1 Architecture & data flow

```
pages/Timesheets.tsx        ← owner view: working Submit on own Draft sheet (replaces disabled button)
pages/Approvals.tsx (new)   ← approver view: list Submitted-awaiting-me, Approve / Reject actions
  ├─ useTimesheets()                       ← own sheets (read, EXISTING — reused as-is)
  ├─ useTimesheetsAwaitingApproval() (new) ← Submitted sheets I may approve (read)
  └─ useTimesheetMutations() (new)         ← submit / approve / reject  (write)
        │                                    (TanStack useMutation; invalidates the two read keys)
        ▼
src/lib/db/timesheetTransition.ts  (NEW DAL module — typed; mirrors procurementLifecycle.ts RPC-cast pattern)
  reads:  listTimesheetsAwaitingApproval()
  writes: submitTimesheet(id) · approveTimesheet(id,notes?) · rejectTimesheet(id,notes?)  (all RPC)
  pure:   isLegalTimesheetTransition(from,to) · timesheetActions(status,isOwner,isApprover)
        │
        ▼
Supabase Postgres
  timesheets + timesheet_entries + RLS already exist (0001/0002) — REUSED; one timesheets_select clause added.
  NEW migration 0007_timesheet_approval.sql:
    • schema delta: profiles (+manager_id uuid references profiles(id), nullable, self-FK)
    • RLS: DROP+CREATE timesheets_select adding the manager-of clause (FR-TS-008)
    • transition_timesheet(p_timesheet_id, p_to, p_notes)   security definer  (map + matrix + SoD + atomic stamp)
```

**Org seam:** the DAL NEVER sends `org_id`. `transition_timesheet` is `security definer` (bypasses RLS) and
therefore re-asserts `auth_org_id()` + the authorization matrix + SoD **internally** (ADR-0011/0012). The
reads send no `org_id` — `timesheets_select` (with the new manager-of clause) scopes them.

### 1.2 Transition state machine (the map, as data — FR-TS-001, OD-TS-2)

Legal `(from → {to})` superset, as a `jsonb` literal inside `transition_timesheet` AND as a TS literal in
the DAL (`LEGAL_TIMESHEET_TRANSITIONS`, single TS source, mirrors the SQL):

```
Draft     → {Submitted}
Submitted → {Approved, Rejected}
Rejected  → {Draft}
Approved  → {}            (terminal)
```

The function: load row `for update` → assert org (`42501`) → assert `(from,to)` legal (`P0001`) → assert
authorization + SoD (`42501`) → single `update` setting `status = p_to` plus the relevant stamp(s) in the
SAME statement (atomic, NFR-TS-ATOM-001).

### 1.3 Authorization matrix (re-asserted inside the RPC — FR-TS-003/004/005/006, OD-TS-1)

```
Draft → Submitted        : caller = timesheets.user_id (owner only)
Submitted → Approved|Rejected:
      caller = (select manager_id from profiles where id = ts.user_id)         -- line manager
   OR (owner's manager_id is null AND auth_role() in ('Admin','Executive'))    -- fallback
   OR auth_role() = 'Admin'                                                    -- break-glass
   AND caller <> ts.user_id                                                    -- SoD (ALWAYS, even Admin)
Rejected → Draft         : caller = timesheets.user_id (owner only, rework)
```

Stamps (same `update`): `→ Submitted` ⇒ `submitted_at = now()`; `→ Approved|Rejected` ⇒
`approved_by = auth.uid()`, `approved_at = now()`. Rework `→ Draft` clears nothing (OD-TS-A).

### 1.4 RLS-select fix (FR-TS-008 — the one policy change this issue requires)

Today `timesheets_select` = `org_id = auth_org_id() and (user_id = auth.uid() or auth_role() in (4 roles))`.
A line-manager whose role is **Engineer** cannot see a report's submitted sheet ⇒ empty approval queue.
Fix: `drop policy timesheets_select; create policy timesheets_select … using (org_id = auth_org_id() and
(user_id = auth.uid() or auth_role() in ('Admin','Executive','Project Manager','Finance') or exists
(select 1 from profiles p where p.id = timesheets.user_id and p.manager_id = auth.uid())))`. Same-table
subselect on `profiles` is fine (own-row-style read; `auth.uid()` resolves without recursing into
`timesheets` RLS).

### 1.5 UI (NFR-TS-UI-001)

- `pages/Timesheets.tsx`: replace the hard-disabled **Submit Timesheet** button. When the current week's
  sheet is the signed-in user's own and `status = 'Draft'`, render an enabled **Submit** button wired to
  `useTimesheetMutations().submit`; otherwise show the `TimesheetStatusBadge` (already present) and no
  submit. Keep the existing loading/empty/error branches.
- `pages/Approvals.tsx` (new, routed at `/approvals`): `useTimesheetsAwaitingApproval()` →
  `approvals-loading` skeleton / `approvals-empty` / error+`Retry`; a list of submitted sheets (owner name,
  week, total hours) each with **Approve** / **Reject** buttons wired to the mutation hook; the action bar
  cosmetically gated by `timesheetActions(status, isOwner, isApprover)` (the RPC is the real authority).

### 1.6 Type contract used across tasks

```ts
// src/lib/db/timesheetTransition.ts
import type { TimesheetRow, TimesheetWithEntries } from './timesheets';
export type TimesheetStatus = TimesheetRow['status'];                 // timesheet_status enum
export type TimesheetAwaitingApproval = TimesheetWithEntries & {
  owner: { full_name: string } | null;
};
export const LEGAL_TIMESHEET_TRANSITIONS: Record<string, string[]>;   // single TS source, mirrors SQL
export function isLegalTimesheetTransition(from: TimesheetStatus, to: TimesheetStatus): boolean;
export function timesheetActions(status: TimesheetStatus, isOwner: boolean, isApprover: boolean):
  { submit: boolean; approve: boolean; reject: boolean };
export function submitTimesheet(id: string): Promise<void>;
export function approveTimesheet(id: string, notes?: string): Promise<void>;
export function rejectTimesheet(id: string, notes?: string): Promise<void>;
export function listTimesheetsAwaitingApproval(): Promise<TimesheetAwaitingApproval[]>;

// src/hooks/useTimesheetApproval.ts
export function useTimesheetsAwaitingApproval(): UseQueryResult<TimesheetAwaitingApproval[]>;
export function useTimesheetMutations(): {
  submit: UseMutationResult<void, Error, { id: string }>;
  approve: UseMutationResult<void, Error, { id: string; notes?: string }>;
  reject: UseMutationResult<void, Error, { id: string; notes?: string }>;
};
```

All three write wrappers call `supabase.rpc('transition_timesheet', { p_timesheet_id, p_to, p_notes })`
with the `// @ts-expect-error` + `as unknown as { data; error }` cast (mirror `procurementLifecycle.ts`).

---

## 2. Phased task list (TDD; 2–5 min each)

### Phase A — Migration `0007_timesheet_approval.sql` (schema + RLS + RPC)

> The pgTAP tests that prove A live in Phase D (written RED there, before the implementer fills the SQL).
> Phase A tasks build the migration; verify each with `supabase db reset` (applies migration + seed).

- **A1** — Header + `manager_id` column. Create `supabase/migrations/0007_timesheet_approval.sql` with a
  header comment ("follows ADR-0012 pattern; forward-only additive; reversibility = `supabase db reset`,
  ADR-0006") and `alter table profiles add column manager_id uuid references profiles(id);` (nullable,
  self-FK). Add `create index profiles_manager_id_idx on profiles (manager_id);`. *(FR-TS-007)*
  Verify: `supabase db reset` exits 0.

- **A2** — RLS-select fix (manager-of clause). Append:
  `drop policy timesheets_select on timesheets;`
  `create policy timesheets_select on timesheets for select using (org_id = auth_org_id() and (user_id =
  auth.uid() or auth_role() in ('Admin','Executive','Project Manager','Finance') or exists (select 1 from
  public.profiles p where p.id = timesheets.user_id and p.manager_id = auth.uid())));`
  with an inline comment citing FR-TS-008 (manager read path so an Engineer-role manager's approval queue
  is not empty). *(FR-TS-008)*
  Verify: `supabase db reset` exits 0.

- **A3** — `transition_timesheet` signature + map + org guard. Append
  `create or replace function transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text
  default null) returns void language plpgsql security definer set search_path = public as $$ … $$;`.
  Body part 1: declare `v_from timesheet_status; v_org uuid; v_owner uuid; v_uid uuid := auth.uid();
  v_role user_role := auth_role(); v_mgr uuid;` and the legal map
  `v_legal jsonb := jsonb_build_object('Draft', jsonb_build_array('Submitted'), 'Submitted',
  jsonb_build_array('Approved','Rejected'), 'Rejected', jsonb_build_array('Draft'), 'Approved',
  jsonb_build_array());`. Load+lock: `select status, org_id, user_id into v_from, v_org, v_owner from
  public.timesheets where id = p_timesheet_id for update;` then `if v_from is null then raise exception
  'timesheet not found' using errcode = 'P0002'; end if;`. Org guard:
  `if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501';
  end if;` with the inline `-- SECURITY: this org re-assertion MUST stay (definer bypasses RLS)` comment
  (ADR-0011/0012 lesson). Legality: `if not (v_legal -> v_from::text) ? p_to::text then raise exception
  'illegal transition % -> %', v_from, p_to using errcode = 'P0001'; end if;`. *(FR-TS-001/003,
  NFR-TS-ATOM-001 setup)*
  Verify: `supabase db reset` exits 0.

- **A4** — `transition_timesheet` authorization + SoD. In the same function body, after the legality check,
  add: resolve the owner's manager `select manager_id into v_mgr from public.profiles where id = v_owner;`
  then the matrix —
  `if p_to = 'Submitted' then if v_uid is distinct from v_owner then raise exception 'not authorized' using
  errcode = '42501'; end if;`
  `elsif p_to in ('Approved','Rejected') then`
    `if v_uid = v_owner then raise exception 'separation of duties: cannot approve own timesheet' using
    errcode = '42501'; end if;`  -- SoD, ALWAYS (even Admin)
    `if not (v_uid = v_mgr or (v_mgr is null and v_role in ('Admin','Executive')) or v_role = 'Admin') then
    raise exception 'not authorized' using errcode = '42501'; end if;`
  `elsif p_to = 'Draft' then if v_uid is distinct from v_owner then raise exception 'not authorized' using
  errcode = '42501'; end if; end if;`. Inline comment: `-- SECURITY: these re-assertions MUST stay`.
  *(FR-TS-004/005/006, OD-TS-1/D)*
  Verify: `supabase db reset` exits 0.

- **A5** — `transition_timesheet` atomic stamp + ACL trio. Single `update`:
  `update public.timesheets set status = p_to, submitted_at = case when p_to = 'Submitted' then now() else
  submitted_at end, approved_by = case when p_to in ('Approved','Rejected') then v_uid else approved_by end,
  approved_at = case when p_to in ('Approved','Rejected') then now() else approved_at end where id =
  p_timesheet_id;` (same statement ⇒ atomic, NFR-TS-ATOM-001; rework `→ Draft` leaves stamps as-is per
  OD-TS-A). Then the ACL trio:
  `revoke all on function transition_timesheet(uuid, timesheet_status, text) from public;`
  `grant execute on function transition_timesheet(uuid, timesheet_status, text) to authenticated;`
  `revoke execute on function transition_timesheet(uuid, timesheet_status, text) from anon;`.
  *(FR-TS-002/004/005/009, NFR-TS-ATOM-001)*
  Verify: `supabase db reset` exits 0.

### Phase B — DAL `src/lib/db/timesheetTransition.ts` (unit, TDD)

> Mock-builder pattern + `vi.hoisted` exactly as `procurementLifecycle.test.ts` (mock `supabase.rpc` and
> `supabase.from`/`select`/`eq`/`order`). Run: `npm test -- timesheetTransition` from `pmo-portal/`.

- **B1** *(RED)* — In `src/lib/db/timesheetTransition.test.ts` write the transition-map unit test:
  `it('AC-900: timesheet transition map accepts legal pairs, rejects illegal jumps and terminal exits
  (FR-TS-001)', …)` asserting `isLegalTimesheetTransition('Draft','Submitted')===true`,
  `('Submitted','Approved')===true`, `('Submitted','Rejected')===true`, `('Rejected','Draft')===true`,
  `('Draft','Approved')===false`, `('Approved','Draft')===false`, `('Submitted','Draft')===false`.
  *(AC-900)*
  Verify: `npm test -- timesheetTransition` FAILS (module/function absent).

- **B2** *(GREEN)* — In `timesheetTransition.ts` implement `LEGAL_TIMESHEET_TRANSITIONS` (the §1.2 literal)
  and `isLegalTimesheetTransition(from,to)` reading it. *(AC-900, FR-TS-001)*
  Verify: `npm test -- timesheetTransition` PASSES B1.

- **B3** *(RED→GREEN)* — Action-gate helper: `it('AC-901: timesheetActions offers Submit to the owner of a
  Draft sheet, nothing on the owner''s Submitted sheet (SoD), Approve/Reject to an approver of a Submitted
  sheet (FR-TS-004/005)', …)` asserting `timesheetActions('Draft', true, false)` = `{submit:true,
  approve:false, reject:false}`, `timesheetActions('Submitted', true, false)` = all false (owner can't
  approve own), `timesheetActions('Submitted', false, true)` = `{submit:false, approve:true, reject:true}`.
  Implement `timesheetActions(status, isOwner, isApprover)`: `submit = status==='Draft' && isOwner`;
  `approve = approve = status==='Submitted' && isApprover && !isOwner`; `reject` same as approve.
  *(AC-901, FR-TS-004/005)*
  Verify: `npm test -- timesheetTransition` PASSES.

- **B4** *(RED→GREEN)* — DAL RPC error surfacing + param/no-org-id: mock `supabase.rpc` to resolve
  `{data:null, error:{message:'not authorized', code:'42501'}}`; `it('AC-902: submitTimesheet/
  approveTimesheet/rejectTimesheet surface the RPC 42501/P0001 error and send {p_timesheet_id,p_to,p_notes}
  with no org_id (FR-TS-002/010)', …)` asserting `await expect(approveTimesheet('ts-id')).rejects.toThrow(
  'not authorized')`; and (success mock) `expect(mockRpc).toHaveBeenCalledWith('transition_timesheet',
  {p_timesheet_id:'ts-id', p_to:'Submitted', p_notes:null})` and
  `expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id')`. Implement `submitTimesheet(id)`
  (`p_to:'Submitted'`, `p_notes:null`), `approveTimesheet(id,notes?)` (`p_to:'Approved'`, `p_notes:notes ??
  null`), `rejectTimesheet(id,notes?)` (`p_to:'Rejected'`) — each the `supabase.rpc(...)` + cast + throw
  pattern of `transitionProcurement`. *(AC-902, FR-TS-002/010)*
  Verify: `npm test -- timesheetTransition` PASSES.

- **B5** *(RED→GREEN)* — `listTimesheetsAwaitingApproval` shape + SoD filter. Mock `useAuth`-independent:
  the DAL takes the signed-in id from the caller? — NO: it filters by `user_id <> auth.uid()` via a chained
  `.neq('user_id', selfId)`, so the function takes `selfId: string`. Test
  `it('AC-903: listTimesheetsAwaitingApproval selects Submitted sheets, neq user_id (SoD), joins owner +
  entries, orders by week_start_date, sends no org_id (FR-TS-011)', …)`: assert
  `mockFrom('timesheets')`, `mockSelect('*, owner:profiles!timesheets_user_id_fkey(full_name),
  entries:timesheet_entries(*, project:projects(name,code))')`, `mockEq('status','Submitted')`,
  `mockNeq('user_id', 'self-id')`, `mockOrder('week_start_date', {ascending:false})`, and
  `JSON.stringify(...).not.toContain('org_id')`. Implement `listTimesheetsAwaitingApproval(selfId: string)`
  mirroring `listTimesheets` (throw on error; normalise entry `hours` to `Number`). *(AC-903, FR-TS-011)*
  Verify: `npm test -- timesheetTransition` PASSES.

### Phase C — Hooks `src/hooks/useTimesheetApproval.ts` + UI (unit, TDD)

- **C1** *(RED→GREEN)* — In `src/hooks/useTimesheetApproval.test.ts`: `it('AC-911 (hook):
  useTimesheetsAwaitingApproval keys cache by [timesheets-awaiting, orgId, userId] and calls the DAL with
  the signed-in id', …)` using `QueryClientProvider` + mocked DAL + mocked `useAuth` (mirror
  `useProcurementDetail.test.ts`). Implement `useTimesheetsAwaitingApproval()` (useQuery, key
  `['timesheets-awaiting', orgId, userId]`, `queryFn: () => listTimesheetsAwaitingApproval(userId!)`,
  `enabled: Boolean(orgId && userId)`). *(supports AC-911)*
  Verify: `npm test -- useTimesheetApproval` PASSES.

- **C2** *(RED→GREEN)* — `it('AC-911 (hook): useTimesheetMutations.submit/approve/reject invalidate the
  own-sheets and awaiting-approval keys on success', …)`. Implement `useTimesheetMutations()` exposing
  `submit` / `approve` / `reject` (each `useMutation`; `onSuccess` invalidates both
  `['timesheets', orgId, userId]` and `['timesheets-awaiting', orgId, userId]`), mirroring
  `useProcurementMutations`. *(supports AC-911)*
  Verify: `npm test -- useTimesheetApproval` PASSES.

- **C3** *(RED→GREEN)* — Approvals page states. In `pages/Approvals.test.tsx`: `it('AC-904: Approvals page
  renders approvals-loading skeleton while pending, approvals-empty when no submitted sheets, error + Retry
  that re-runs the query (NFR-TS-UI-001)', …)` driving the three `useTimesheetsAwaitingApproval` states via
  a mocked hook; assert `getByTestId('approvals-loading')`, `getByTestId('approvals-empty')`, and that
  clicking `Retry` calls `refetch`. Create `pages/Approvals.tsx` with the three states + `data-testid`s,
  rendering a list of submitted sheets (owner `full_name`, `week_start_date`, summed hours). *(AC-904,
  NFR-TS-UI-001)*
  Verify: `npm test -- Approvals` PASSES.

- **C4** *(RED→GREEN)* — Approve/Reject + Submit wiring (cosmetic gate). `it('AC-911 (UI): an Approvals row
  for a report''s Submitted sheet offers Approve and Reject; clicking Approve calls the approve mutation
  with the row id (FR-TS-005)', …)` — mock `useTimesheetMutations`; assert `getByRole('button',
  {name:/approve/i})` present and clicking it calls `approve.mutate({id})`. Add the action buttons to each
  `pages/Approvals.tsx` row gated by `timesheetActions(status, isOwner=false, isApprover=true)` and wired to
  the mutation hook. *(AC-911 UI, FR-TS-005)*
  Verify: `npm test -- Approvals` PASSES.

- **C5** *(RED→GREEN)* — Owner Submit button in `pages/Timesheets.tsx`. In `pages/Timesheets.test.tsx`:
  `it('AC-911 (UI): the weekly grid shows an enabled Submit button for the owner''s own Draft sheet and
  calls the submit mutation; no Submit on a Submitted sheet (FR-TS-004)', …)` — mock `useTimesheets` to
  return a Draft sheet then a Submitted sheet, mock `useTimesheetMutations`; assert the enabled
  `getByRole('button', {name:/submit/i})` for Draft calls `submit.mutate({id})`, and that for a Submitted
  sheet the submit button is absent (badge shown instead). Replace the hard-disabled button (lines ~181-188
  of `pages/Timesheets.tsx`) with the gated, wired button using `timesheetActions(currentTimesheet.status,
  isOwner=true, isApprover=false).submit`; remove the "submission coming soon" copy. *(AC-911 UI, FR-TS-004)*
  Verify: `npm test -- Timesheets` PASSES AND `npm run typecheck` exits 0.

### Phase D — pgTAP (the DB is the real gate; written RED first, then Phase A fills the SQL)

> Each file: `begin; select plan(N); …fixtures as table owner (orgs, auth.users, profiles WITH manager_id,
> timesheets)…; set local role authenticated; set local request.jwt.claims =
> '{"sub":"<uuid>","role":"authenticated"}'; …asserts…; reset role; select * from finish(); rollback;`
> (mirror `0007`/`0013`/`0015`). Run all: `supabase test db` from repo root.

- **D1** — `supabase/tests/0021_timesheet_transition_tenant.test.sql` (plan 2): two orgs, one user each, an
  org-B `Submitted` timesheet; org-A user calls `transition_timesheet(<org-B ts>, 'Approved')` →
  `throws_ok(…, '42501', null, 'AC-905: cross-org timesheet transition raises 42501 (tenant isolation
  inside RPC)')`; and an illegal-map call `transition_timesheet(<org-A Draft ts>, 'Approved')` (Draft→
  Approved) by the owner → `throws_ok(…, 'P0001', null, 'AC-905: illegal Draft→Approved jump rejected
  (P0001)')` (covers the legal-map gate at the DB; map-acceptance owned by AC-900 Unit). *(AC-905,
  FR-TS-001/003)*
  Verify: `supabase test db` reports this file pass.

- **D2** — `0022_timesheet_submit_gate.test.sql` (plan 3): a `Draft` ts owned by X; X calls
  `transition_timesheet(…, 'Submitted')` → `lives_ok(…, 'AC-906: owner can Submit own Draft timesheet')` +
  `is((select submitted_at is not null from timesheets where id=…), true, 'AC-906: submitted_at stamped
  atomically')`; a different user (X's manager M) calls Submit on X's (re-fixtured Draft) sheet → `throws_ok
  (…, '42501', null, 'AC-906: non-owner cannot Submit')`. *(AC-906, FR-TS-004, NFR-TS-ATOM-001)*
  Verify: file passes.

- **D3** — `0023_timesheet_manager_approve.test.sql` (plan 3): owner X (Engineer) whose `manager_id` = M
  (also **Engineer**-role, to prove the path does NOT depend on a privileged role); X's sheet is
  `Submitted`. M calls `transition_timesheet(…, 'Approved')` → `lives_ok(…, 'AC-907: line manager approves
  report''s timesheet')` + `is((select approved_by from timesheets where id=…), <M>, 'AC-907: approved_by =
  manager')` + `is((select approved_at is not null …), true, 'AC-907: approved_at stamped')`; a different
  non-manager Engineer N calls Approve on a re-fixtured Submitted sheet → `throws_ok(…, '42501', null,
  'AC-907: non-manager Engineer cannot Approve')`. *(AC-907, FR-TS-005/007, NFR-TS-ATOM-001)*
  Verify: file passes.

- **D4** — `0024_timesheet_fallback.test.sql` (plan 3): owner W with `manager_id is null`, sheet
  `Submitted`; an Executive (not W) calls Approve → `lives_ok(…, 'AC-908: Exec fallback approves when
  manager_id is null')`; owner V with a non-null `manager_id = M`, sheet `Submitted`; an Executive who is
  NOT M calls Approve → `throws_ok(…, '42501', null, 'AC-908: Exec cannot approve when an assigned manager
  exists (fallback exclusive)')`; an Admin (not the owner) calls Approve on a re-fixtured Submitted sheet →
  `lives_ok(…, 'AC-908: Admin break-glass approves')`. *(AC-908, FR-TS-005, OD-TS-D)*
  Verify: file passes.

- **D5** — `0025_timesheet_sod.test.sql` (plan 1): an **Admin** user A owns a `Submitted` timesheet
  (`user_id = A`); A calls `transition_timesheet(…, 'Approved')` on their own sheet → `throws_ok(…,
  '42501', null, 'AC-909: SoD — an employee (even Admin) can never approve their own timesheet')`. *(AC-909,
  FR-TS-005)*
  Verify: file passes.

- **D6** — `0026_timesheet_manager_read_anon.test.sql` (plan 3): owner X (Engineer) with `manager_id` = M
  (Engineer), X's sheet `Submitted`. As M: `is((select count(*)::int from timesheets where user_id = <X>),
  1, 'AC-910: Engineer-role manager can SELECT report''s timesheet (FR-TS-008 manager read path)')`. As a
  different Engineer N (manages no one): `is((select count(*)::int from timesheets where user_id = <X>), 0,
  'AC-910: non-manager Engineer cannot see another user''s timesheet (own-row only)')`. As role `anon`:
  `throws_ok($$ select transition_timesheet('<X ts>','Approved') $$, '42501', null, 'AC-910: anon cannot
  execute transition_timesheet (anon-revoke)')`. *(AC-910, FR-TS-008/009)*
  Verify: file passes.

### Phase E — Seed + E2E + full gate

- **E1** — Seed enrichment. In `supabase/seed.sql`: (a) §profiles — set `manager_id` so the chain exists.
  Easiest reversible form: after the existing `insert into profiles …`, append
  `update profiles set manager_id = '00000000-0000-0000-0000-0000000000a2' where id =
  '00000000-0000-0000-0000-0000000000a4';` (Dave→Alice) and
  `update profiles set manager_id = '00000000-0000-0000-0000-0000000000a1' where id =
  '00000000-0000-0000-0000-0000000000a2';` (Alice→Bob); Bob's `manager_id` stays null (top of chain /
  fallback fixture). (b) §timesheets — promote Dave's seeded sheet to Submitted:
  `update timesheets set status = 'Submitted', submitted_at = '2026-06-08T17:00:00Z' where id =
  '70000000-0000-0000-0000-000000000001';` (Dave, owner with manager Alice — populates Alice's approval
  queue + AC-911 fixture). Leave Alice's sheet `70000000-…-002` as `Draft` (owner-submit fixture). Do NOT
  hard-code `org_id`. *(seed for AC-904/911 data)*
  Verify: `supabase db reset` exits 0 (seed applies; manager-self-FK satisfied).

- **E2** — Route the Approvals page. In `pmo-portal/App.tsx` (or the router module — confirm by reading the
  existing route table) add a `/approvals` route rendering `pages/Approvals.tsx`, and a nav link in the
  existing sidebar/nav component alongside the Timesheets link. (No new behavior AC — exercised by AC-911.)
  Verify: `npm run typecheck` exits 0 AND `npm run dev` route resolves (manual) OR the AC-911 e2e nav passes.

- **E3** *(RED)* — `pmo-portal/e2e/AC-911-timesheet-submit-approve.spec.ts`. `test('AC-911 submit→approve
  across two users: report submits Draft→Submitted, line manager approves Submitted→Approved', …)` using
  `login` from `./helpers`:
  - **Owner (Dave) submits.** `login(page, 'engineer@acme.test')`; navigate to `/timesheets`; page off the
    loading skeleton; navigate the week picker to the seeded Draft week (`2026-06-01` Monday — use the
    week-nav buttons or jump-to-today is wrong, so navigate by clicking Previous until the
    `TimesheetStatusBadge`/week label shows the seeded week); click the enabled **Submit** button; assert
    the `TimesheetStatusBadge` reads `Submitted`. (If the owner-submit fixture used is Dave's
    already-Submitted seed sheet, instead start from Alice's Draft sheet owned by `pm@acme.test`; pick ONE
    consistent owner — recommend: leave Dave's Draft, seed a SECOND submit by NOT pre-submitting in E1, so
    the e2e itself performs Draft→Submitted. SIMPLER: in E1 keep Dave's sheet `Draft`; the e2e submits it.)
    **Reconcile with E1: keep Dave's sheet `Draft` in seed; the e2e performs the submit.** Update E1
    accordingly (drop the Dave→Submitted update; keep only the `manager_id` updates) — see E1 note below.
  - **Manager (Alice) approves.** `login(page, 'pm@acme.test')`; navigate to `/approvals`; off
    `approvals-loading`; the row for Dave's `Submitted` week is visible; click its **Approve** button;
    assert the row leaves the queue (`approvals-empty` or the row gone) — i.e. `expect(page.getByText(/Dave
    Engineer/)).not.toBeVisible()` after approve. *(AC-911, FR-TS-001/004/005/008/011, NFR-TS-UI-001)*
  Verify: `npx playwright test AC-911` FAILS first (UI/RPC not wired), then PASSES after C1-C5 + E1/E2.

  > **E1 reconciliation (binding):** to make AC-911 perform a real `Draft → Submitted`, **E1 seeds only the
  > `manager_id` updates and leaves BOTH seeded timesheets `Draft`.** The AC-904 `approvals-empty` test (C3)
  > uses a mocked hook (no seed dependency), so an empty seed queue is fine. The AC-911 e2e submits Dave's
  > Draft as the owner, then approves it as Alice — exercising submit AND approve end-to-end with live RPC.

- **E4** — Full gate. Run, from `pmo-portal/`: `npm run typecheck` (0 errors), `npm run lint`
  (`--max-warnings=0`), `npm test` (all green, ≥80% lines on changed files), `npx playwright test`; and from
  repo root `supabase test db` (all pgTAP green). *(quality gates, charter DoD)*
  Verify: all five commands exit 0.

---

## 3. Traceability (AC → owning layer → task)

| AC | Owning layer | Task(s) | FR/NFR |
|---|---|---|---|
| AC-900 | Unit | B1, B2 | FR-TS-001 |
| AC-901 | Unit | B3 | FR-TS-004/005 (UI gate) |
| AC-902 | Unit | B4 | FR-TS-002/010 |
| AC-903 | Unit | B5 | FR-TS-011 |
| AC-904 | Unit | C3 | NFR-TS-UI-001 |
| AC-905 | pgTAP | D1 | FR-TS-001/003 |
| AC-906 | pgTAP | D2 | FR-TS-004, NFR-TS-ATOM-001 |
| AC-907 | pgTAP | D3 | FR-TS-005/007, NFR-TS-ATOM-001 |
| AC-908 | pgTAP | D4 | FR-TS-005 (OD-TS-D) |
| AC-909 | pgTAP | D5 | FR-TS-005 (SoD) |
| AC-910 | pgTAP | D6 | FR-TS-008/009 |
| AC-911 | E2E | E3 (+ A3-A5 / B4-B5 / C1-C5 / E1-E2 exercised) | FR-TS-001/004/005/008/011, NFR-TS-UI-001 |

Per-layer split: **Unit** AC-900/901/902/903/904 (5) · **pgTAP** AC-905..910 (6) · **E2E** AC-911 (1).
No AC is pushed up a layer (ADR-0010).

---

## 4. Files touched (under source — by the implementer, not this planner)

New: `supabase/migrations/0007_timesheet_approval.sql`; `supabase/tests/0021…0026_*.test.sql` (6);
`pmo-portal/src/lib/db/timesheetTransition.ts` (+`.test.ts`);
`pmo-portal/src/hooks/useTimesheetApproval.ts` (+`.test.ts`); `pmo-portal/pages/Approvals.tsx`
(+`Approvals.test.tsx`); `pmo-portal/e2e/AC-911-timesheet-submit-approve.spec.ts`.
Edited: `pmo-portal/pages/Timesheets.tsx` (+`Timesheets.test.tsx`); the router/nav module for the
`/approvals` route; `supabase/seed.sql`.
Reused as-is: `timesheets`/`timesheet_entries` RLS in `0002_rls.sql` except the one `timesheets_select`
clause (FR-TS-008); `src/lib/db/timesheets.ts` (`listTimesheets`, `TimesheetWithEntries`),
`src/hooks/useTimesheets.ts`, `src/auth/impersonation.tsx` (`useEffectiveRole`), `components/Card`,
`components/TimesheetStatusBadge`.

---

## 5. Risks / assumptions for the Director

- **R1 — RLS-select change is REQUIRED (the spec's flagged RLS question, resolved):** an Engineer-role line
  manager is NOT in the privileged-read set, so without FR-TS-008 their approval queue would be empty and
  the manager-approve UI path would be inoperable for them. A4's RPC authz would still *correctly* permit
  the transition, but the manager could never *see* the sheet to act on it. ⇒ A2 adds the manager-of clause
  to `timesheets_select` (drop+create). Proven at AC-910. This is the only RLS change; it widens read, not
  write. (For PM/Exec/Finance managers the existing privileged-read already covers them, so the seeded
  Alice-PM e2e would pass even without A2 — but the Engineer-manager pgTAP AC-907/910 would fail without
  it, which is the point.)
- **R2 — `manager_id` self-FK + seed ordering:** `profiles.manager_id` references `profiles(id)`; seed must
  set it via `update` AFTER all profile rows exist (E1 uses post-insert `update`s) so no row references a
  not-yet-inserted manager. `db reset` reversibility holds (forward-only additive column; no down needed,
  ADR-0006).
- **R3 — SoD applies even to Admin (deliberate, OD-TS-1):** A4 places the `v_uid = v_owner` SoD raise
  BEFORE the role/manager check inside the Approved/Rejected branch, so an Admin approving their OWN sheet
  is blocked (AC-909) while an Admin approving someone else's is break-glass-allowed (AC-908). Order matters
  — the implementer must keep the SoD check first in that branch.
- **R4 — `listTimesheetsAwaitingApproval(selfId)` takes the id explicitly** (not from a server call) so the
  unit test can assert the `.neq('user_id', selfId)` filter deterministically; the hook supplies
  `currentUser.id`. RLS is the real scope; the `neq` is the SoD convenience filter (own sheet never in own
  queue, OD-TS-C). The DB SoD block (A4) is the authoritative guarantee regardless of the client filter.
- **R5 — No new ADR (confirmed):** this is ADR-0012 applied verbatim to a simpler single-table state
  machine (no doc-number minter, no child tables, no parent-org guard needed — `timesheets` is the only
  written table and carries `org_id` directly). The plan header records "follows ADR-0012 pattern". If the
  Director judges the RLS-select widening or the SoD-over-Admin rule architecturally novel, a 3-line
  `docs/adr/0013-timesheet-transition-rpc.md` could capture it — eng-planner's recommendation: **not
  warranted** (no new pattern; both are direct OD-TS-1 applications).
- **R6 — Router/nav wiring (E2):** the exact route-table and nav-component file were not pinned in this plan
  (the implementer reads `pmo-portal/App.tsx` / the existing routes to mirror the Timesheets route
  registration). Flagged as the one task whose exact file path the implementer confirms from the existing
  router; the change is mechanical (one route + one nav link).
