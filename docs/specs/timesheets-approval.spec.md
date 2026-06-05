# Spec: Timesheet submit / approve module — whole-week line-manager approval (Issue: build-wave #3)

Third issue of the build wave. Ships the timesheet **submit/approve transition module**: a single
`transition_timesheet()` security-definer RPC that drives the whole-week status flow
`Draft → Submitted → Approved | Rejected` (and `Rejected → Draft`) with the **line-manager** authorization
matrix (`profiles.manager_id`, Admin/Executive fallback when the manager is null, Admin break-glass) and a
hard **separation-of-duties** rule (an employee can never approve their own timesheet). It also adds the
`manager_id` self-reference to `profiles`, a "timesheets awaiting my approval" read, and the
submit/approve/reject UI. This is a **direct application of the established transition-RPC pattern**
(ADR-0011 / ADR-0012) — same `security definer` + internal-authz re-assertion + pinned `search_path` +
revoke-anon discipline; no new architectural decision (the plan records "follows ADR-0012 pattern").

- **Grounds:** `docs/decisions.md` **OD-TS-1/2/3** (binding); ADR-0011 (the `security definer` RPC +
  internal-authz + anon-revoke pattern), ADR-0012 (the procurement transition-RPC = the closest mirror);
  ADR-0009 (read-RPC + anon-revoke precedent); ADR-0010 (test pyramid + AC-id tagging); ADR-0003 (DAL),
  ADR-0005 (TanStack Query). Reuses the DAL pattern of `src/lib/db/procurementLifecycle.ts`, the
  read-DAL of `src/lib/db/timesheets.ts`, the hook patterns of `src/hooks/useProcurementDetail.ts` /
  `src/hooks/useTimesheets.ts`, the `// @ts-expect-error` + `as unknown as <T>` RPC-DAL cast established in
  `dashboard.ts` / `budgets.ts` / `procurementLifecycle.ts`, and `useEffectiveRole` from
  `src/auth/impersonation.tsx` for cosmetic action gating.
- **Schema baseline — verified `supabase/migrations/0001_init_schema.sql` §5.8:**
  `timesheets(id, org_id, user_id → profiles, week_start_date date, status timesheet_status DEFAULT 'Draft',
  submitted_at timestamptz, approved_by uuid → profiles, approved_at timestamptz)` with
  `check (extract(dow from week_start_date) = 1)` (Monday-start) and `unique(user_id, week_start_date)`;
  `timesheet_entries(id, org_id, timesheet_id → timesheets on delete cascade, project_id, entry_date,
  hours numeric(5,2) check 0..24, notes)`. Enum `timesheet_status = ('Draft','Submitted','Approved',
  'Rejected')`. `user_role = ('Executive','Project Manager','Finance','Engineer','Admin')`.
  `profiles(id, org_id, company_id, full_name, email, role, …)` — **has no `manager_id` column today**.
- **RLS baseline — verified `supabase/migrations/0002_rls.sql`:** `auth_org_id()` / `auth_role()` are
  `security definer set search_path = public`, sourced from `profiles`. `timesheets`:
  `timesheets_select` = `org_id = auth_org_id() and (user_id = auth.uid() or auth_role() in
  ('Admin','Executive','Project Manager','Finance'))`; `timesheets_insert` = own row;
  `timesheets_update_own` = `org_id = auth_org_id() and user_id = auth.uid() and status = 'Draft'`
  (so entries are editable only while Draft — `timesheet_entries_write` is gated on the parent sheet being
  the caller's own and `status = 'Draft'`). The RLS comment explicitly defers the approve/reject matrix to
  this module's RPC ("approve/reject via RPC (spec §8.4)"). `org_id` is client-unspoofable: column default
  (0001) + `with check (org_id = auth_org_id())` (0002).

---

## AS-IS (what exists today)

- The `timesheets` aggregate + `timesheet_entries` exist and are seeded; there is a **read** DAL
  (`src/lib/db/timesheets.ts` — `listTimesheets(userId)`), a read hook (`useTimesheets`), and a
  view-only weekly grid (`pages/Timesheets.tsx`). The **Submit Timesheet** button is **hard-disabled**
  (`disabled title="Submitting is coming soon"`), a banner reads *"Entry editing and timesheet submission
  are coming soon"*, and an *"Approvals workflow coming soon"* placeholder sits at the bottom. **No status
  ever changes** — a timesheet is only ever the seeded value.
- **No transition mechanism.** There is no `transition_timesheet` RPC; the only mutation surface is the
  coarse `timesheets_update_own` RLS policy, which lets the **owner** update **only while Draft** — it has
  no notion of submit vs approve vs reject, no manager authorization, and no SoD. It cannot express the
  approve/reject path at all (an approver is by definition not the owner, and the owner is blocked once the
  sheet leaves Draft). The RLS comment defers the matrix to this module's RPC.
- **No manager relationship.** `profiles` has no `manager_id`; there is no way to express "X's line
  manager is Y", so a line-manager approval rule is unrepresentable today.
- **No approver read path for a non-privileged manager.** `timesheets_select` lets a user read their own
  rows OR (if their role is Admin/Executive/PM/Finance) all org rows. A line-manager whose role is
  **Engineer** (an IC who manages one report) currently **cannot SELECT** their report's submitted
  timesheet — so an Engineer-role manager would see an empty approval queue. (Resolved by this issue — see
  §RLS and FR-TS-008.)

## Scope (strict in/out)

**IN:**
1. **Manager relationship (OD-TS-1):** migration adds `manager_id uuid references profiles(id)` to
   `profiles` — **nullable**, self-referencing (an employee's line manager). Null = no assigned manager
   (the Admin/Executive fallback path).
2. **State machine (OD-TS-2):** a centralized transition map defined as **data** driving all status changes
   through a single `transition_timesheet(p_timesheet_id uuid, p_to timesheet_status, p_notes text default
   null)` **`security definer`** RPC (mirrors ADR-0012). Legal map: `Draft → Submitted`;
   `Submitted → Approved | Rejected`; `Rejected → Draft`. `Approved` is terminal (no outgoing edges).
   Whole-week granularity: one transition signs off the whole weekly sheet (NOT per project/entry —
   OD-TS-1/3).
3. **Authorization matrix + SoD (OD-TS-1), re-asserted inside the RPC** via `auth_role()` / `auth_org_id()`,
   raising `42501` on deny:
   - **Submit (`Draft → Submitted`)** — allowed by the **timesheet owner only** (`timesheets.user_id =
     auth.uid()`).
   - **Approve / Reject (`Submitted → Approved | Rejected`)** — allowed by the timesheet owner's
     **line manager** (`auth.uid() = (select manager_id from profiles where id = timesheets.user_id)`),
     **OR** Admin/Executive when the owner's `manager_id` **is null** (fallback), **OR** Admin always
     (break-glass) — **AND never the owner** (SoD: `auth.uid() <> timesheets.user_id`, enforced even for
     Admin).
   - **Rework (`Rejected → Draft`)** — allowed by the timesheet **owner only**.
   - Stamps: `→ Submitted` sets `submitted_at = now()`; `→ Approved | Rejected` sets `approved_by =
     auth.uid()` + `approved_at = now()` (and `→ Draft` on rework clears nothing required — see FR-TS-006).
4. **Approver read path (OD-TS-1, the RLS-select fix):** a line-manager must be able to SELECT their
   reports' submitted timesheets even when their role is **not** in the privileged-read set
   (Admin/Exec/PM/Finance). Add a `manager_id`-based clause to `timesheets_select` so a manager reads the
   timesheets of the profiles whose `manager_id = auth.uid()` (own-org). Without this an Engineer-role
   manager's approval queue would be empty (see AS-IS). This is the one **RLS change** this issue requires.
5. **DAL + hooks:** thin RPC wrappers `submitTimesheet` / `approveTimesheet` / `rejectTimesheet` over
   `transition_timesheet`, plus a **"timesheets awaiting my approval"** read DAL
   (`listTimesheetsAwaitingApproval()`) + its hook. Mutation hook invalidates the relevant query keys.
6. **UI:** the owner's weekly grid gains a working **Submit** action on their own `Draft` sheet (replacing
   the hard-disabled button); an **approver view** lists submitted timesheets awaiting the signed-in user's
   approval with **Approve / Reject** actions, cosmetically gated by the manager/role rules (the RPC is the
   real authority). Distinct loading / empty / error+retry states (Frontend DoD).

**OUT (explicit non-goals — do not bleed scope):**
- **Per-project / per-entry approval** (each project's PM signs off hours booked to their project) —
  explicitly deferred (OD-TS-3). One whole-week approval only; no per-entry approval state, no new columns
  on `timesheet_entries`.
- **Entry editing / timesheet creation UI** — out of this issue. Entry editing remains gated to Draft by the
  existing `timesheet_entries_write` RLS; this issue does not build the edit grid (the seeded Draft sheets
  are the fixtures). The submit action operates on an already-populated Draft sheet.
- **Configurable approval chains / multi-level approval / delegation / role×status matrix UI / custom
  roles** — the configurability engine is seamed, not built (OD-PROC-6 bridge). The transition map +
  single-RPC authz choke point ARE the seam; no config tables this issue.
- **Manager-assignment admin UI** (setting `manager_id` for users) — out of this issue; `manager_id` is
  populated by seed/migration for now; the admin UI to edit it is a later Admin/Users-module concern.
- **Notifications / email on submit/approve/reject** — out of scope.
- **Rewriting the existing `timesheets` / `timesheet_entries` RLS** beyond the one `timesheets_select`
  clause this issue adds (FR-TS-008) — the coarse `timesheets_update_own` policy stays as a non-RPC
  backstop for Draft-owner entry edits; the RPC, not the policy, is the transition authority.

## `[OWNER-DECISION]` flags (assumed defaults — flag, don't silently invent)

Behavior is locked by OD-TS-1/2/3. The following are **implementation defaults** the spec assumes where
OD-TS is silent; flag for confirmation (non-blocking for build start, pin before merge):

- **OD-TS-A (rework does not clear the prior approver stamp) — assumed:** on `Rejected → Draft` (rework),
  the spec assumes `submitted_at` / `approved_by` / `approved_at` are **left as-is** (a cheap audit trail of
  the last decision) and are simply overwritten on the next `→ Submitted` / `→ Approved|Rejected`. The
  alternative (null them on rework) buys nothing in MVP and loses the last-decision trail. *Confirm* the
  no-clear default. (No status-history table in MVP — OD-MARGIN-2 deferred seam.)
- **OD-TS-B (Submitted timesheet is read-only to its entries) — assumed:** the existing
  `timesheet_entries_write` RLS already blocks entry edits unless the parent sheet is the owner's and
  `status = 'Draft'`, so a `Submitted`/`Approved`/`Rejected` sheet's entries are immutable until the owner
  reworks it back to Draft. This issue **does not** add a separate lock — the existing policy is the lock.
  *Confirm* reusing the existing Draft-gate as the entry-edit lock (no new policy needed).
- **OD-TS-C (the approval queue scope) — assumed:** `listTimesheetsAwaitingApproval()` returns timesheets
  with `status = 'Submitted'` that the signed-in user is **allowed to approve** — i.e. RLS-visible to them
  (their reports via the FR-TS-008 clause, or any org sheet if they are Admin/Exec/PM/Finance) **minus
  their own** (SoD — an Admin's own submitted sheet never appears in their own queue). The query filters
  `status = 'Submitted' and user_id <> auth.uid()`; RLS scopes the rest. *Confirm* this queue definition.
- **OD-TS-D (`manager_id` fallback semantics) — assumed:** "fallback when manager is null" means: when the
  owner's `manager_id is null`, **Admin or Executive** may approve/reject (per OD-TS-1). When `manager_id`
  is **non-null**, only that specific manager (or Admin break-glass) may approve — an Executive who is NOT
  the owner's manager may **not** approve a sheet that has an assigned manager. *Confirm* that a non-null
  `manager_id` is exclusive (Exec fallback applies only when there is no assigned manager; Admin is always
  break-glass).

## Functional requirements (EARS)

**State machine — transition map (whole-week)**
- **FR-TS-001** — The system shall define the legal timesheet status transitions as **data** (a
  status→allowed-next-status map) inside `transition_timesheet()`, and shall reject (`P0001`) any transition
  whose `(from, to)` pair is not in the map. The map is: `Draft → {Submitted}`,
  `Submitted → {Approved, Rejected}`, `Rejected → {Draft}`, `Approved → {}` (terminal).
- **FR-TS-002** — The system shall route **all** timesheet status changes through `transition_timesheet()`;
  the coarse `timesheets_update_own` RLS policy remains only as a backstop for Draft-owner entry edits and
  is not the transition authority.

**Authorization matrix + separation-of-duties (re-asserted inside the RPC)**
- **FR-TS-003** — When a user invokes `transition_timesheet()`, the system shall re-assert, **inside** the
  `security definer` function: (a) the timesheet's `org_id = auth_org_id()` (tenant isolation), and (b) that
  the caller is authorized for the requested transition per the OD-TS-1 matrix — raising `42501` otherwise.
- **FR-TS-004** — *Submit.* When the requested transition is `Draft → Submitted`, the system shall permit
  **only the timesheet owner** (`timesheets.user_id = auth.uid()`), and shall stamp `submitted_at = now()`.
- **FR-TS-005** — *Approve / Reject (SoD).* When the requested transition is `Submitted → Approved` or
  `Submitted → Rejected`, the system shall permit it only when the caller is (i) the owner's line manager
  (`auth.uid() = (select manager_id from profiles where id = timesheets.user_id)`), **OR** (ii) Admin or
  Executive when the owner's `manager_id is null` (fallback), **OR** (iii) Admin (break-glass) —
  **AND shall reject it (`42501`) when the caller is the timesheet owner** (`auth.uid() =
  timesheets.user_id`), even for an Admin owner (SoD: an employee can never approve their own timesheet).
  On success it shall stamp `approved_by = auth.uid()` and `approved_at = now()`.
- **FR-TS-006** — *Rework.* When the requested transition is `Rejected → Draft`, the system shall permit
  **only the timesheet owner** (`timesheets.user_id = auth.uid()`); the prior `submitted_at` / `approved_by`
  / `approved_at` are left as-is (OD-TS-A) and overwritten on the next submit/decision.

**Manager relationship + approver read path**
- **FR-TS-007** — The system (migration) shall add `manager_id uuid references profiles(id)` (nullable,
  self-referencing) to `profiles`; null denotes no assigned line manager (the fallback path of FR-TS-005).
- **FR-TS-008** — The system shall extend `timesheets_select` so a line manager may SELECT the timesheets of
  the profiles they manage — adding the clause `exists (select 1 from profiles p where p.id =
  timesheets.user_id and p.manager_id = auth.uid())` to the existing own-or-privileged-role predicate
  (own-org, via `auth_org_id()`). A manager whose role is not in {Admin, Executive, PM, Finance} can then
  read their reports' submitted timesheets (without this their approval queue is empty).

**RPC discipline / tenancy**
- **FR-TS-009** — The system shall never accept a client-supplied `org_id` on any timesheet-module write;
  `transition_timesheet` is `security definer set search_path = public`, re-asserts `auth_org_id()` /
  authorization internally (does not rely on RLS being bypassed by definer rights), and shall
  `revoke all from public`, `grant execute to authenticated`, `revoke execute from anon` (ADR-0011 /
  ADR-0012 discipline). Table references inside the definer function are schema-qualified (`public.…`).

**DAL / read contract**
- **FR-TS-010** — The system shall expose a DAL that surfaces the RPC error (deny `42501` / illegal `P0001`)
  to the UI without swallowing it (thin wrappers `submitTimesheet` / `approveTimesheet` / `rejectTimesheet`
  over `transition_timesheet`), sending no `org_id`.
- **FR-TS-011** — The system shall expose `listTimesheetsAwaitingApproval()` returning the `Submitted`
  timesheets the signed-in user may approve — `status = 'Submitted' and user_id <> auth.uid()` (SoD), scoped
  by RLS (FR-TS-008 + the existing privileged-role read) — joined to the owner profile (`full_name`) and
  entries, ordered by `week_start_date`.

## NFR
- **NFR-TS-ATOM-001** — A status transition (status update + the relevant `submitted_at` / `approved_by` /
  `approved_at` stamp) shall be a **single atomic** server-side operation; no observable partial state (e.g.
  status `Submitted` with a null `submitted_at`, or `Approved` with a null `approved_by`).
- **NFR-TS-UI-001** — The timesheet submit and approval views shall render distinct **loading**, **empty**,
  and **error + retry** states (Frontend DoD).

## RLS (verification this issue owns)

This issue **adds** one `timesheets_select` clause (FR-TS-008) and **proves**, at the pgTAP layer:
- the manager read path: an Engineer-role manager can SELECT a report's `Submitted` timesheet; a
  non-manager Engineer cannot see another user's timesheet (own-row only);
- the `transition_timesheet` RPC's **internal** authz — tenant isolation, the line-manager / fallback /
  break-glass matrix, and the SoD self-approve block — proven independently of RLS (definer bypasses RLS —
  the in-function re-assertion is the gate);
- the legal-transition map (illegal jump rejected `P0001`);
- anon cannot execute the RPC (anon-revoke).
The existing `timesheets` / `timesheet_entries` policies are otherwise reused as-is (the coarse
`timesheets_update_own` stays as the Draft-owner entry-edit backstop); this issue does not rewrite them.

## Acceptance criteria (Given/When/Then)

AC range **AC-900..AC-911** (confirmed unused: Dashboard owns 701–711, Budget owns 720–733, Procurement
owns 800–816; `grep -r AC-9` across the repo finds nothing). Each AC names its id as the leading token
(traceability) and is annotated with its **owning layer (ADR-0010)**.

- **AC-900** *(Unit)* — Transition map: legal pair accepted, illegal rejected.
  Given the transition-map logic, When asked `Draft → Submitted`, `Submitted → Approved`,
  `Submitted → Rejected`, `Rejected → Draft` Then each is legal; When asked `Draft → Approved` (illegal
  jump), `Approved → <any>` (terminal), or `Submitted → Draft` Then each is rejected. *(FR-TS-001)*
- **AC-901** *(Unit)* — Cosmetic action gating helper (owner vs approver).
  Given `timesheetActions(status, isOwner, isApprover)`, When the owner views their `Draft` sheet Then
  `Submit` is offered and `Approve`/`Reject` are not; When the owner views their `Submitted` sheet Then no
  action is offered (SoD — owner can't approve own); When an approver (manager) views a report's `Submitted`
  sheet Then `Approve` and `Reject` are offered. *(FR-TS-004/005, UI)*
- **AC-902** *(Unit)* — DAL surfaces the RPC error (deny / illegal).
  Given `submitTimesheet`/`approveTimesheet`/`rejectTimesheet`, When the RPC resolves an error
  `{message, code:'42501'}` (or `P0001`), Then the DAL rejects with a typed `Error` carrying the message
  (does not swallow it); And the call sends params `{p_timesheet_id, p_to, p_notes}` and **no** `org_id`.
  *(FR-TS-002/010)*
- **AC-903** *(Unit)* — Approval-queue DAL shape + SoD filter.
  Given `listTimesheetsAwaitingApproval`, When invoked Then it selects `timesheets` with
  `status = 'Submitted'`, filters `user_id <> <signed-in id>` (SoD — own sheet excluded), joins the owner
  `full_name` + entries, orders by `week_start_date`, and sends **no** `org_id`. *(FR-TS-011)*
- **AC-904** *(Unit)* — Submit / approval views loading / empty / error+retry states.
  Given the approval view, When the query is pending Then a skeleton (`approvals-loading`) renders; When it
  resolves with no submitted timesheet Then `approvals-empty`; When it errors Then an error + `Retry`
  renders and Retry re-runs the query. *(NFR-TS-UI-001)*
- **AC-905** *(pgTAP)* — Tenant isolation inside the RPC.
  Given an org-A user and an org-B `Submitted` timesheet, When the org-A user calls `transition_timesheet`
  on it Then it raises `42501` (the timesheet's `org_id ≠ auth_org_id()`); cross-org transition impossible.
  *(FR-TS-003)*
- **AC-906** *(pgTAP)* — Submit gate: owner only.
  Given a `Draft` timesheet owned by user X, When X calls `transition_timesheet(…, 'Submitted')` Then it
  succeeds and `submitted_at` is set (`is not null`); When a different user (even a manager) calls it Then
  `42501`. *(FR-TS-004, NFR-TS-ATOM-001)*
- **AC-907** *(pgTAP)* — Approve by line manager; non-manager blocked.
  Given a `Submitted` timesheet whose owner's `manager_id` = user M (an **Engineer**-role manager), When M
  calls `transition_timesheet(…, 'Approved')` Then it succeeds and `approved_by = M` + `approved_at is not
  null`; When a different non-manager, non-privileged user calls it Then `42501`. *(FR-TS-005,
  NFR-TS-ATOM-001)*
- **AC-908** *(pgTAP)* — Admin/Executive fallback when `manager_id` is null.
  Given a `Submitted` timesheet whose owner's `manager_id is null`, When an Executive (not the owner) calls
  Approve Then it succeeds; And when the owner has a non-null `manager_id`, an Executive who is **not** that
  manager calling Approve Then `42501` (fallback applies only when manager is null — OD-TS-D); And an Admin
  calling Approve on either Then it succeeds (break-glass). *(FR-TS-005)*
- **AC-909** *(pgTAP)* — SoD: an employee can never approve their own timesheet.
  Given an **Admin** user whose own `Submitted` timesheet is the target, When that Admin calls
  `transition_timesheet(…, 'Approved')` on their own sheet Then `42501` (SoD blocks self-approval even for
  Admin break-glass — approver `<>` owner). *(FR-TS-005)*
- **AC-910** *(pgTAP)* — Manager read path (RLS-select fix) + anon-revoke.
  Given an Engineer-role manager M and a report whose `manager_id = M`, When M `SELECT`s `timesheets` Then
  the report's `Submitted` row is visible (FR-TS-008); And given an Engineer who manages no one, When they
  SELECT another user's timesheet Then it is not visible (own-row only); And given the `anon` role, When it
  attempts to execute `transition_timesheet` Then execute is denied. *(FR-TS-008/009)*
- **AC-911** *(E2E)* — Submit → approve happy path across two users (single curated journey).
  Given the timesheet owner (a report) signed in with a `Draft` sheet, When they click **Submit** Then the
  sheet shows `Submitted`; And given the owner's **line manager** signed in, When they open the approval
  view and click **Approve** on that sheet Then it shows `Approved` and leaves their queue. *(FR-TS-001/004/
  005/008/011, NFR-TS-UI-001)*

## Traceability (FR → AC → owning layer)

| Requirement | AC(s) | Owning layer (ADR-0010) |
|---|---|---|
| FR-TS-001 (transition map legality) | AC-900, AC-911 | Unit (E2E end-to-end) |
| FR-TS-002 (all changes via RPC) | AC-902 | Unit |
| FR-TS-003 (internal authz: org+matrix) | AC-905 | pgTAP |
| FR-TS-004 (submit: owner only) | AC-906, AC-901, AC-911 | pgTAP (UI gate at Unit; E2E) |
| FR-TS-005 (approve/reject + fallback + SoD) | AC-907, AC-908, AC-909, AC-901 | pgTAP (UI gate at Unit) |
| FR-TS-006 (rework `Rejected → Draft`) | AC-900 (map) | Unit |
| FR-TS-007 (`profiles.manager_id`) | AC-907, AC-910 | pgTAP |
| FR-TS-008 (manager read path) | AC-910, AC-911 | pgTAP (E2E end-to-end) |
| FR-TS-009 (org_id not client-supplied + anon-revoke) | AC-910, AC-905 | pgTAP |
| FR-TS-010 (DAL error surfacing) | AC-902 | Unit |
| FR-TS-011 (awaiting-approval read + SoD filter) | AC-903, AC-911 | Unit (E2E end-to-end) |
| NFR-TS-ATOM-001 (atomic transition) | AC-906, AC-907 | pgTAP |
| NFR-TS-UI-001 (loading/empty/error states) | AC-904, AC-911 | Unit (E2E end-to-end) |

Per-layer AC split: **Unit** AC-900/901/902/903/904 (**5**) · **pgTAP** AC-905/906/907/908/909/910 (**6**) ·
**E2E** AC-911 (**1**, curated submit→approve journey). Authorization, SoD, tenancy, the manager read path,
atomicity, and the legal-map gate all sit at **pgTAP** (the DB is the real gate); transition-map logic, the
cosmetic action gate, DAL error surfacing, the queue-DAL shape, and UI states sit at **Unit**; one
end-to-end happy path at **E2E**. No AC is pushed up a layer to satisfy a convention (ADR-0010).

## Seed enrichment required (verified `supabase/seed.sql` §profiles + §timesheets)

To make the manager-approval path **exercisable** without a live transition run:
- **Set `manager_id` on seeded profiles** so a non-trivial line-manager relationship exists. Suggested:
  set Engineer **Dave** (`…a4`)'s `manager_id = ` PM **Alice** (`…a2`) and PM **Alice**'s `manager_id = `
  Executive **Bob** (`…a1`); leave Executive Bob's `manager_id` null (top of chain — exercises the
  Exec/Admin fallback). This also lets the e2e use **Dave (report) submits → Alice (manager) approves**
  with no role-privilege shortcut (Alice is a PM, but the journey exercises the manager edge, and a pgTAP
  test covers the Engineer-role-manager edge explicitly — AC-907/910).
- **A submitted timesheet awaiting approval:** change one seeded timesheet's `status` from `Draft` to
  `Submitted` (set `submitted_at`), owned by a user who has a manager — e.g. Dave's sheet
  (`70000000-…-001`) → `Submitted` with `submitted_at`. This populates Alice's approval queue and the
  approver-view empty/non-empty rendering, and is the AC-911 fixture. Keep the other (PM Alice's) sheet
  `Draft` so the owner-submit path also has a fixture.
- Do **not** hard-code `org_id` on any insert/update (column default keeps the client-unspoofable seam).
  Respect `unique(user_id, week_start_date)` and the Monday `week_start_date` check.

## Open questions / decisions-applied

**Decisions applied (cited):**
- **OD-TS-1** — approver = line manager (`profiles.manager_id`), whole-week granularity, Admin/Exec
  fallback when manager null, Admin break-glass, SoD (employee never approves own). ⇒ FR-TS-004/005/007/008,
  AC-906/907/908/909/910.
- **OD-TS-2** — flow `Draft → Submitted → Approved | Rejected`, `Rejected → Draft`; entries editable only
  while Draft (reuses existing RLS); stamps `submitted_at` / `approved_by` / `approved_at`. ⇒ FR-TS-001/002/
  004/005/006, AC-900/906/907.
- **OD-TS-3** — per-project PM approval deferred. ⇒ Scope OUT.
- **ADR-0011 / ADR-0012** — `transition_timesheet` is a direct application of the established
  `security definer` transition-RPC pattern (internal authz re-assertion, pinned `search_path`,
  revoke-anon, map-as-data). ⇒ FR-TS-002/003/009. **No new ADR** — the plan records "follows ADR-0012
  pattern".

**Open / needs owner confirmation (flagged above, non-blocking for build start; pin before merge):**
- **OQ-1 → OD-TS-A:** rework (`Rejected → Draft`) leaves the prior `submitted_at`/`approved_by`/`approved_at`
  as-is (overwritten on next decision); no nulling, no status-history table in MVP. Confirm.
- **OQ-2 → OD-TS-B:** the existing `timesheet_entries_write` Draft-gate IS the entry-edit lock for
  Submitted/Approved/Rejected sheets; no new policy added. Confirm.
- **OQ-3 → OD-TS-C:** the approval queue = `status='Submitted' and user_id <> auth.uid()`, RLS-scoped
  (reports via FR-TS-008 + privileged-role read), own sheet excluded. Confirm.
- **OQ-4 → OD-TS-D:** a non-null `manager_id` is exclusive — Exec/Admin fallback applies only when
  `manager_id is null` (Admin is always break-glass). Confirm.
