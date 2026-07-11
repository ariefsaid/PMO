# Plan: ClickUp adapter — tasks domain (Issue P1, ADR-0055 P1)

> **Spec:** `docs/specs/clickup-adapter.spec.md` (SIGNED OFF — FR-CUA-\*/AC-CUA-\*; OD-CUA-1/2/3 decided).
> **ADRs:** ADR-0055 (external adapters), **ADR-0056** (this issue — FE routing cache + pending-push composition).
> **Builds on the shipped P0 seam:** `pmo-portal/src/lib/adapterSeam/{contract,router,dispatch,referenceAdapter,refs,watermarks,pendingPush,capabilityMap}.ts`; migrations 0087–0090; `supabase/functions/adapter-dispatch/index.ts`; `supabase/tests/external_*.test.sql`. **P1 EXTENDS these — reuse their idioms exactly; do not re-invent.**
>
> **No-placeholder rule (binding):** every task below has an exact path, the actual code/diff, its `AC-CUA-###`, and an exact verify command. TDD order: the failing test task precedes its implementation task. Types are consistent across tasks (`AdapterCommand`/`CommandResult`/`PmoRecord`/`OwnershipMap`/`PendingPushState` from the P0 contract are the shared vocabulary).
>
> **⚑ Migration numbering:** this plan uses **0091** as the next free number (verified 2026-07-10: tail is `0090_external_reference_items.sql`). **Parallel agents are active on this repo — the builder MUST re-verify at write time** with `ls supabase/migrations | tail -3` and bump every migration number in Slice A/D if 0091 is taken. Renumber consistently (the pgTAP band references no migration number, so only the file name changes).
>
> **Confinement invariant (FR-CUA-012, NFR-CUA-CONTRACT-001):** ClickUp vocabulary (List, Space, Folder, `date_updated`, member id, ClickUp status names, endpoints, headers) lives **only** under `pmo-portal/src/lib/adapterSeam/clickup/**` and `supabase/functions/clickup-webhook/`. Every module above the contract (router, dispatch, repository, hooks, UI, pgTAP) speaks PMO domain language only. Any reviewer grep of `List|date_updated|clickup.com` outside those two trees is a confinement failure.

---

## Architecture overview (how P1 plugs into P0)

```
 User task write (board/list/detail)
   → useTaskMutations → repositories.task.{create,update,updateStatus,delete}
      → tasks.ts routes on routeTaskWrite()  [ADR-0056 module cache, fail-closed to 'pmo']
          ├─ 'pmo'      → EXISTING direct DAL (byte-for-byte, FR-CUA-030)  ← the invariant path
          └─ 'external' → dispatchTaskCommand() → POST functions/v1/adapter-dispatch
                             → dispatchExternallyOwnedWrite (dispatch.ts)
                                 → clickup adapter.commit()  [REST v2, mocked in tests]
                                 → writeReadModel (tasks upsert / tombstone on delete)
                                 → recordExternalRef
 Native ClickUp edit
   → ClickUp webhook → functions/clickup-webhook (HMAC verify)
        → applyWebhookEvent (webhookApply.ts): source-mod guard → upsert|tombstone|adopt → advance watermark
 Reconciliation sweep (pg_cron, idle-until-configured)
   → functions/clickup-sweep → runSweep (sweep.ts): read watermark → adapter.listChangesSinceWatermark → apply → advance
 Onboarding (Operator-invoked)
   → functions/clickup-onboard → provisionBinding / pushSeed / pullAdopt (onboarding.ts)
```

Ownership is stored per-org in `external_domain_ownership` (P0, 0087) via the Operator RPC
`operator_set_domain_ownership(org, 'clickup', 'tasks', 'employ'|'release')`. The per-project ClickUp
**List binding + status map + member map** live in a new generic `external_project_bindings` table
(Slice A). Reads are **always** the Supabase read-model (FR-CUA-021) — no read is ever routed to the adapter.

---

## Slice plan (6 independently-mergeable slices; one PR each, all green flag-off)

Each slice is a standalone PR that builds and passes `npm run verify` **with no org employing ClickUp**
(so it is behavior-off / byte-for-byte for every existing client). Merge order A→B→C→D→E→F is the
natural dependency order, but each stands alone (later slices' modules are inert until an org is flipped
by the Operator, which no test-or-prod org is).

| Slice | Scope (1 line) | ACs | Tasks |
|---|---|---|---|
| **A** | Schema: tasks-flip RLS per-command split + tombstone/source-mod columns + `external_refs` adopt-unique + `external_project_bindings` + trigger service-role bypasses; one reversible migration + pgTAP band | 020,021,022,023,024 | A1–A9 |
| **B** | ClickUp adapter module (commands+reads+mapping+statusMap+memberMap, injected `fetch`, rate-limiter) + register in `adapter-dispatch` keyed by `tasks` | 030,031,032,033,034,035,036,037,080 | B1–B12 |
| **C** | Delete-aware dispatch + task-repository wiring (ADR-0056 ownership cache, fail-closed) + tombstone-safe task reads/My Tasks routing + pending-push surfaces + the byte-for-byte regression net (EARLY) + write-through e2e | 001,038,060,061,062,090 | C1–C11 |
| **D** | Change-feed: `clickup-webhook` ingress (HMAC + idempotent apply + source-mod guard + adopt + tombstone) + reconciliation sweep + rollup-over-mirror + webhook e2e | 040,041,042,043,044,045,070,071,072,091 | D1–D12 |
| **E** | Onboarding: List provisioning (reject-mixed, OD-CUA-3) + push-seed + pull-adopt, idempotent+resumable | 050,051,052,053 | E1–E6 |
| **F** | Integrations view P1 rows + tier/domain display-label map (OD-EAS-LABELS debt) + ClickUp US-hosted data-locality note | NFR-CUA-LOCALITY-001 | F1–F4 |

**AC-CUA-002** (zero-regression meta-AC) is the `npm run verify` + pgTAP full-suite gate at the end of
**every** slice — no single new test owns it.

---

## Slice A — Schema: the tasks-flip migration + pgTAP

**Goal:** generalize the 0090 reference-flip onto the real `tasks` table as a **per-command split**
(OD-CUA-1), add the tombstone + source-modification columns (OD-CUA-2, FR-CUA-049), the `external_refs`
adopt-unique constraint (FR-CUA-064), and the `external_project_bindings` config table — all inert for
non-ClickUp orgs (byte-for-byte, FR-CUA-030). One reversible migration; pgTAP proves AC-CUA-020..024.

**File:** `supabase/migrations/0091_clickup_tasks_flip.sql` (re-verify number first).

### A1 — Write the tasks-flip pgTAP (RED) — AC-CUA-020/021/023

**File:** `supabase/tests/tasks_external_owned_rls.test.sql` (new). Mirror the idiom of
`supabase/tests/external_reference_items_rls.test.sql` and `external_refs_rls.test.sql`.

Seed org A (flipped: `insert into external_domain_ownership (org_id, external_tier, domain) values (A,'clickup','tasks')`) + org B (not flipped), a project + a mirrored task row in each (as `reset role` service writer). Then, as an org-A **Admin (manager) user JWT** and an org-A **Engineer user JWT**:

- `AC-CUA-020` user-JWT `INSERT` into `tasks` → `throws_ok(..., '42501', ...)`.
- `AC-CUA-020` user-JWT `UPDATE` of a native field (`name`) → `throws_ok('42501')`.
- `AC-CUA-020` user-JWT `DELETE` → `throws_ok('42501')`.
- `AC-CUA-020` **service-role** (`reset role`) `UPDATE` of a native field (`name`, `start_date`, `end_date` — *not merely* `status`) → `lives_ok` (proves the `enforce_assignee_status_only` service-role bypass).
- `AC-CUA-020` service-role `INSERT` + `DELETE` of a mirror row → `lives_ok`.
- `AC-CUA-021` manager user-JWT `UPDATE` of `milestone_id` only → `lives_ok` (enhancement column stays writable via the permissive UPDATE path).
- `AC-CUA-021` manager user-JWT `UPDATE` changing a native field → `throws_ok('42501')` (column pin applies to every user role while flipped — manager exemption suspended).
- `AC-CUA-021` a `task_dependencies` edge insert by a manager → `lives_ok` (enhancement, unaffected by the flip).
- `AC-CUA-023` org-B (not flipped) manager native-field `UPDATE`/`INSERT`/`DELETE` → all `lives_ok` (org-scoped; byte-for-byte pre-P1).

**Verify (RED, expect fail — table/policies not yet changed):**
`cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-backend-integration-a78790 && scripts/with-db-lock.sh supabase test db 2>&1 | grep tasks_external_owned`

### A2 — Write the reversibility + org-scope pgTAP (RED) — AC-CUA-022

**File:** same `tasks_external_owned_rls.test.sql`, appended plan count.
- `AC-CUA-022` after `select operator_set_domain_ownership(A,'clickup','tasks','release')` (as an Operator; or `reset role` delete the ownership row directly), an org-A manager native-field `UPDATE` → `lives_ok` under restored 0002/0016 behavior; assert the row value changed (no data change to unrelated columns).

**Verify:** same command (still RED).

### A3 — Write the adopt-unique pgTAP (RED) — AC-CUA-024

**File:** `supabase/tests/external_refs_adopt_unique.test.sql` (new).
Seed org A + an `external_refs` row mapping `(A,'tasks','pmo-1','clickup','cu-1')` (as service role). Then a **second** service-role insert mapping the **same** `(A,'tasks', external_record_id='cu-1')` to a *different* `pmo_record_id='pmo-2'` → `throws_ok(..., '23505', ...)` (the new `unique (org_id, domain, external_record_id)`).

**Verify (RED):** `scripts/with-db-lock.sh supabase test db 2>&1 | grep external_refs_adopt`

### A4 — Migration: split `tasks_write` into per-command policies (GREEN start) — AC-CUA-020/021

**File:** `supabase/migrations/0091_clickup_tasks_flip.sql` (new). Header comment: purpose + reversibility (manual reverse block) mirroring 0090's header. First section:

```sql
-- Per-command split (OD-CUA-1): tasks_write (0002) is FOR ALL — a wholesale USING guard would kill
-- the user's UPDATE path AND milestone_id writability. Replace it with INSERT/UPDATE/DELETE policies:
--   INSERT + DELETE guarded by `not domain_externally_owned(auth_org_id(),'tasks')` (denied while flipped);
--   UPDATE left permissive (the enforce_assignee_status_only trigger column-pins it while flipped).
drop policy tasks_write on tasks;

create policy tasks_insert on tasks for insert
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'tasks'));

create policy tasks_update on tasks for update
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id()));

create policy tasks_delete on tasks for delete
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from projects p where p.id = tasks.project_id and p.org_id = auth_org_id())
    and not public.domain_externally_owned(auth_org_id(), 'tasks'));
```

Manual-reverse block: `drop policy tasks_insert/tasks_update/tasks_delete; recreate tasks_write FOR ALL` (verbatim from 0002). **Note:** `tasks_update`'s USING/WITH CHECK is byte-for-byte the 0002 clause (no ownership guard) — this preserves the manager UPDATE path in both directions; only the trigger changes gate native fields while flipped.

### A5 — Migration: guard `tasks_update_own_status` while flipped — AC-CUA-020/021

Append to `0091`:
```sql
-- The assignee status-only path (0016) is fully denied while flipped (status is ClickUp-owned).
drop policy tasks_update_own_status on tasks;
create policy tasks_update_own_status on tasks for update
  using (org_id = auth_org_id() and assignee_id = auth.uid()
    and not public.domain_externally_owned(auth_org_id(), 'tasks'))
  with check (org_id = auth_org_id() and assignee_id = auth.uid()
    and not public.domain_externally_owned(auth_org_id(), 'tasks'));
```
Reverse: recreate the 0016 version (no ownership guard).

### A6 — Migration: extend `enforce_assignee_status_only` (service-role bypass + externally-owned pin) — AC-CUA-020/021

Append to `0091` — `create or replace function enforce_assignee_status_only()`:
```sql
create or replace function enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
begin
  -- (a) Service-role bypass ONLY for flipped orgs, matching A7: non-flipped orgs keep the exact
  -- original trigger path even when auth.uid() is null.
  if auth.uid() is null and public.domain_externally_owned(new.org_id, 'tasks') then
    return new;
  end if;
  -- (b) While tasks externally-owned: pin EVERY user role to enhancement columns only
  -- (milestone_id; future weight). Native-field change → 42501. Manager exemption suspended.
  if public.domain_externally_owned(new.org_id, 'tasks') then
    if new.name        is distinct from old.name
       or new.status      is distinct from old.status
       or new.assignee_id is distinct from old.assignee_id
       or new.project_id  is distinct from old.project_id
       or new.org_id      is distinct from old.org_id
       or new.start_date  is distinct from old.start_date
       or new.end_date    is distinct from old.end_date
       or new.id          is distinct from old.id
    then
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;
  -- (c) NOT externally-owned: byte-for-byte the ORIGINAL 0016 behavior (unchanged).
  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;
  if new.name        is distinct from old.name
     or new.assignee_id is distinct from old.assignee_id
     or new.project_id  is distinct from old.project_id
     or new.org_id      is distinct from old.org_id
     or new.start_date  is distinct from old.start_date
     or new.end_date    is distinct from old.end_date
     or new.id          is distinct from old.id
  then
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;
```
Reverse: `create or replace` the verbatim 0016 body. **Byte-for-byte proof:** branches (a) and (b) are inert for non-ClickUp orgs — `auth.uid()` is non-null for real user writes and `domain_externally_owned` is false, so control reaches (c), the untouched original.

### A7 — Migration: extend `stamp_task_completed_at` (mirror ClickUp completion, not `now()`) — FR-CUA-030 (Finding 6)

Append to `0091` — `create or replace function stamp_task_completed_at()`:
```sql
create or replace function stamp_task_completed_at() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Mirrored (service-role) write on a flipped org: trust the incoming completed_at (ClickUp truth);
  -- do NOT re-stamp with now(). Guarded on BOTH service-role AND externally-owned so PMO-owned
  -- service writes (if any) and every user write stay byte-for-byte the original.
  if auth.uid() is null and public.domain_externally_owned(new.org_id, 'tasks') then
    return new;
  end if;
  -- ORIGINAL 0034 behavior (unchanged for every non-mirrored path):
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'Done' then now() else null end;
  elsif new.status = 'Done' and old.status is distinct from 'Done' then
    new.completed_at := now();
  elsif new.status is distinct from 'Done' and old.status = 'Done' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end $$;
```
Reverse: verbatim 0034 body.

### A8 — Migration: tombstone + source-mod columns + external_refs adopt-unique + bindings table — FR-CUA-049/064/080, OD-CUA-3

Append to `0091`:
```sql
-- Soft-tombstone marker (OD-CUA-2) + per-row source-modification guard (FR-CUA-049).
alter table tasks add column tombstoned_at    timestamptz;   -- ClickUp-native delete apply / delete-aware dispatch
alter table tasks add column source_updated_at timestamptz;  -- ClickUp date_updated of the change last applied

-- Atomic adopt dedupe (FR-CUA-064): the unique constraint replaces 0088's non-unique helper index.
drop index if exists public.external_refs_org_domain_ext_idx;
alter table external_refs add constraint external_refs_org_domain_extid_key
  unique (org_id, domain, external_record_id);

-- Generic per-project external binding (List + status/member maps) — domain-generic names so no
-- ClickUp vocabulary enters the schema (FR-CUA-012). config jsonb holds { statusMap, memberMap }.
create table public.external_project_bindings (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
                         references public.organizations(id) on delete cascade,
  project_id           uuid not null references public.projects(id) on delete cascade,
  external_tier        text not null,
  external_container_id text not null,        -- the mapped external container (a ClickUp List id)
  config               jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  unique (org_id, project_id, external_tier)
);
alter table public.external_project_bindings enable row level security;
alter table public.external_project_bindings force  row level security;
create policy external_project_bindings_select on public.external_project_bindings
  for select using (org_id = public.auth_org_id() and public.is_active_member());
-- WRITE: machine-only (dispatch/sync/provisioning service role). No user write grant (mirrors external_refs, 0088).
grant select on public.external_project_bindings to authenticated;
grant select on public.external_project_bindings to anon;
```
Reverse block (manual): drop the bindings table + its policy, drop the unique constraint, drop the two `tasks` columns. **Note:** `deleteTask()` hard-delete stays for PMO-owned orgs; `tombstoned_at` is only ever set by the service role (delete-aware dispatch / webhook), so it is always null for non-ClickUp orgs.

### A9 — Slice-A gate (GREEN + regression) — AC-CUA-020..024, AC-CUA-002

- `cd .../erpnext-backend-integration-a78790 && scripts/with-db-lock.sh supabase test db` → the new bands + **the entire existing pgTAP suite** green (proves the trigger/policy changes are byte-for-byte for non-flipped orgs — AC-CUA-002).
- `cd pmo-portal && npm run typecheck` (types unaffected; regen `database.types.ts` if the builder runs `supabase gen types` — add `tombstoned_at`/`source_updated_at`/`external_project_bindings`).
- **Regenerate types:** `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts` then `cd pmo-portal && npm run verify`.

**Riskiest task of Slice A: A6** — the `enforce_assignee_status_only` rewrite must keep branch (c)
byte-for-byte or it silently regresses the shipped Engineer-status-only contract for **every** existing
client. The full existing pgTAP suite in A9 is the guard; do not merge on the new band alone.

---

## Slice B — The ClickUp adapter module + dispatch registration

**Goal:** a `tier='clickup'`, `capabilityMap={'tasks'}` adapter implementing the P0 contract against
ClickUp REST v2 behind an **injected `fetch`** (mocked in every test), with all ClickUp vocabulary
confined to `src/lib/adapterSeam/clickup/**`. Register it in `adapter-dispatch` keyed by `tasks`.

All files under `pmo-portal/src/lib/adapterSeam/clickup/`. **Relative imports only** (`../contract.ts`)
so the module is Deno-importable by the edge function (same rule as `referenceAdapter.ts`).

### B1 — ClickUp shape types + field mapping test (RED) — AC-CUA-031

**Test:** `clickup/mapping.test.ts`. Given a ClickUp task JSON (recorded fixture: `{ id, name, status:{status}, assignees:[{id}], start_date, due_date, date_updated }`), assert `clickUpTaskToPmoRecord(raw, {memberMap, statusMap})` returns the canonical PMO record `{ id, name, status, assignee_id, start_date, end_date }` with unix-ms→ISO date conversion and `due_date`→`end_date`; and `pmoTaskToClickUpBody(record, maps, { mode:'create'|'update', previousAssigneeIds })` branches correctly: **create** produces ClickUp v2's `{ name, status, assignees:[id], start_date(ms), due_date(ms) }`, while **update/transition** produces `{ name?, status?, assignees:{ add:[...], rem:[...] }, start_date?, due_date? }` for exactly the mapping set (FR-CUA-010) and nothing else. Mock both shapes in the unit test so the create/update contract cannot drift.

**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/adapterSeam/clickup/mapping.test.ts`

### B2 — mapping.ts + types.ts (GREEN) — FR-CUA-010

**Files:** `clickup/types.ts` (ClickUp REST shapes — confined) + `clickup/mapping.ts` (`clickUpTaskToPmoRecord` / `pmoTaskToClickUpBody`; unix-ms↔ISO boundary conversion). `pmoTaskToClickUpBody` must branch on operation: ClickUp v2 **create** uses `assignees:[ids]`, while **update** uses `assignees:{ add:[...], rem:[...] }`; accept the previous assignee id(s) so the mapper can emit the correct delta shape. No `org_id` ever in a mapped record. Re-verify the same two shapes again in the deferred live-smoke appendix once a real token exists.

### B3 — Status-map test (RED) — AC-CUA-034

**Test:** `clickup/statusMap.test.ts`. Given a per-List status map covering PMO `{To Do, Done}`:
- `AC-CUA-034` `toClickUpStatus(map, 'Done')` → the List's configured status string.
- `AC-CUA-034` `toClickUpStatus(map, 'Blocked')` (unmapped) → throws `AdapterError('commit-rejected', ...)` (config).
- inbound `fromClickUpStatus(map, '<unknown clickup status>')` → the configured default PMO status (logged, not thrown) per FR-CUA-011.

**Verify (RED):** `npx vitest run src/lib/adapterSeam/clickup/statusMap.test.ts`

### B4 — statusMap.ts (GREEN) — FR-CUA-011

**File:** `clickup/statusMap.ts` (`toClickUpStatus`/`fromClickUpStatus`, `AdapterError` from `../contract.ts`).

### B5 — Member-map test (RED) — AC-CUA-037

**Test:** `clickup/memberMap.test.ts`.
- `AC-CUA-037` `toClickUpAssignee(memberMap, pmoAssigneeId)` for an **unmapped** assignee → returns `{ unassigned:true, surfaced:'...' }` (never throws); for a mapped one → the ClickUp member id.
- inbound `fromClickUpAssignee(memberMap, clickUpMemberId)` unmapped → `null`.

**Verify (RED):** `npx vitest run src/lib/adapterSeam/clickup/memberMap.test.ts`

### B6 — memberMap.ts (GREEN) — FR-CUA-013

**File:** `clickup/memberMap.ts`.

### B7 — Rate-limiter test (RED) — AC-CUA-080

**Test:** `clickup/rateLimit.test.ts`. With fake timers + a mock `fetch` that returns `429` (with `Retry-After: 1`) then `200`:
- `AC-CUA-080` a token-bucket sized to the ~100 req/min budget never issues > budget in a window.
- `AC-CUA-080` a `429` triggers backoff honoring `Retry-After`, then resumes; work is neither dropped nor duplicated.
- `AC-CUA-080` (NFR-CUA-PERF-003) an **interactive** command submitted while a bulk batch is draining is served **ahead** of remaining bulk tokens (reserved-headroom / priority queue) — assert ordering.

**Verify (RED):** `npx vitest run src/lib/adapterSeam/clickup/rateLimit.test.ts`

### B8 — rateLimit.ts + client.ts (GREEN) — FR-CUA-090/091/092, NFR-CUA-PERF-003

**Files:** `clickup/rateLimit.ts` (token bucket + `withBackoff` honoring `Retry-After`, bounded retry budget, interactive-priority lane) + `clickup/client.ts` (the injected-`fetch` HTTP wrapper: auth header `Authorization: <token>`, base URL, maps `4xx`→`AdapterError('commit-rejected', <ClickUp message>)`, exhausted-retry/`5xx`/timeout→`AdapterError('external-unreachable', ...)`). **Token/header live only here.**

### B9 — Commands test (RED) — AC-CUA-031/032/033

**Test:** `clickup/commands.test.ts` with a mock `fetch` + a stub `external_refs` resolver:
- `AC-CUA-031` `create` → `POST /api/v2/list/{list_id}/task` with mapping-set body; returns `{ externalRecordId: <clickup id>, canonical }`.
- `AC-CUA-032` `update` → `PUT /api/v2/task/{id}` resolving the id from the mapping; returns canonical from ClickUp's answer.
- `AC-CUA-032` `transition` → `PUT /api/v2/task/{id}` with the mapped status.
- `AC-CUA-032` `delete` → `DELETE /api/v2/task/{id}`.
- `AC-CUA-033` mocked `400` → `AdapterError('commit-rejected', <message>)`; repeated `5xx`/timeout → `AdapterError('external-unreachable', ...)` after the retry budget.

**Verify (RED):** `npx vitest run src/lib/adapterSeam/clickup/commands.test.ts`

### B10 — commands.ts + reads.ts (GREEN) — FR-CUA-002..008

**Files:** `clickup/commands.ts` (`create`/`update`/`transition`/`delete` → REST via client, resolving id via an injected `resolveExternalId(pmoRecordId)`), `clickup/reads.ts` (`listChangesSinceWatermark`: query `date_updated_gt={cursor-1ms}&order_by=updated` paginated → inclusive `>=` boundary; `nextCursor` = **max `date_updated` observed**, `null` at exhaustion; `getByExternalId`: `GET /api/v2/task/{id}` → canonical or `null` on `404`).

### B11 — reads.test.ts + adapter.test.ts (RED→GREEN) — AC-CUA-035/036/030

- **Test** `clickup/reads.test.ts`: `AC-CUA-035` two mocked pages modified-after cursor → canonical records + advancing `nextCursor`, `null` at exhaustion (inclusive boundary re-fetch present). `AC-CUA-036` a task then a `404` → canonical, then `null`.
- **Test** `clickup/adapter.test.ts`: `AC-CUA-030` `createClickUpAdapter(deps)` exposes `tier==='clickup'`, `capabilityMap` is `new Set(['tasks'])`, and `commit`/`listChangesSinceWatermark`/`getByExternalId` typed only in PMO domain language (a contract-shape assertion — no ClickUp field names on the public surface).
- **File** `clickup/adapter.ts`: assembles the `Adapter` (dispatch `commit` by `command.operation` to `commands.ts`; reads to `reads.ts`; capability map static).

**Verify:** `npx vitest run src/lib/adapterSeam/clickup/reads.test.ts src/lib/adapterSeam/clickup/adapter.test.ts`

### B12 — Register the ClickUp adapter in `adapter-dispatch` — FR-CUA-001

**File:** `supabase/functions/adapter-dispatch/index.ts` (edit). Add the `tasks` entry to `ADAPTER_REGISTRY` (replacing the `// P1 routes per domain` seam), constructing the adapter from **function-secret token + the org's `external_project_bindings` row** (List id + status/member maps loaded via the service client), and branch `writeReadModel` per domain: for `tasks`, upsert the `tasks` read-model row from the canonical record (map `completed_at` from ClickUp completion; set `source_updated_at`) instead of `external_reference_items`. Import the adapter via relative path (`../../../pmo-portal/src/lib/adapterSeam/clickup/adapter.ts`). Add `CLICKUP_API_TOKEN` to the env reads. **Delete branch is added in Slice C (C3).**

**Verify:** `deno check --config supabase/functions/adapter-dispatch/deno.json --lock supabase/functions/adapter-dispatch/deno.lock --frozen supabase/functions/adapter-dispatch/index.ts` **and** `deno run --allow-all --config supabase/functions/adapter-dispatch/deno.json scripts/deno-boot-smoke.ts supabase/functions/adapter-dispatch/index.ts` (must print `BOOT_OK`).

**Slice-B gate:** `cd pmo-portal && npm run verify` + the two deno commands above green.

---

## Slice C — Delete-aware dispatch + repository wiring + pending-push + the invariant net

**Goal:** wire the real task repository through the routing seam (ADR-0056), prove the byte-for-byte
invariant **first**, extend the dispatch for delete-tombstone, and compose pending-push on task surfaces.

### C1 — Byte-for-byte invariant test (RED — the EARLY regression net) — AC-CUA-001

**File:** `pmo-portal/src/lib/repositories/task.external.test.ts` (new). With the ownership cache **empty** (`clearOwnershipCache()`), spy on `supabase.functions.invoke` and the direct DAL:
- `AC-CUA-001` `create`/`update`/`updateStatus`/`delete`/`addDependency` each call the **existing direct DAL** and **never** call `functions.invoke('adapter-dispatch', ...)`; no pending-push state is produced; returned shape + thrown error `code` identical to pre-P1.
- `AC-CUA-001` with the cache set to `{ tasks: 'clickup' }`, a native-field write **does** route to `dispatchTaskCommand` (proves the branch), while `addDependency`/`milestone` writes still take the direct DAL (FR-CUA-024).

**This task MUST land before C4 (the tasks.ts wiring) — it is the red test that guards the invariant.**
**Verify (RED):** `cd pmo-portal && npx vitest run src/lib/repositories/task.external.test.ts`

### C2 — ownershipCache.ts + dispatchClient.ts (GREEN for the cache half) — FR-CUA-031, ADR-0056

**Files:**
- `pmo-portal/src/lib/adapterSeam/ownershipCache.ts`: module-level `let cache: OwnershipMap | null = null`; `setTaskOwnership(rows)` (build `{ tasks:'clickup' }` from the own-org ownership rows), `clearOwnershipCache()`, `routeTaskWrite(): 'pmo'|'external'` = `cache ? routeWrite('tasks', cache) : 'pmo'` (fail-closed). Unit test `ownershipCache.test.ts`: null→'pmo', loaded-but-absent→'pmo', loaded-with-tasks→'external'.
- `pmo-portal/src/lib/adapterSeam/dispatchClient.ts`: `dispatchTaskCommand(operation, record): Promise<CommandResult>` via `supabase.functions.invoke('adapter-dispatch', { body: { domain:'tasks', operation, record } })`; on error throw `AppError(message, code)` mapping the edge fn's `error`/`message`/status → `commit-rejected`|`external-unreachable`. Test `dispatchClient.test.ts` with `functions.invoke` mocked.

**Verify:** `npx vitest run src/lib/adapterSeam/ownershipCache.test.ts src/lib/adapterSeam/dispatchClient.test.ts`

### C3 — Delete-aware dispatch test + extension (RED→GREEN) — AC-CUA-038, FR-CUA-026

**Test:** `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` (extend). `AC-CUA-038` with a mock adapter whose `commit` succeeds for a `delete` command and an existing `external_refs` mapping: `dispatchExternallyOwnedWrite` (delete-aware) **tombstones** the mirrored read-model row (calls `tombstoneReadModel(pmoRecordId)`, NOT `writeReadModel(canonical)`), **keeps** the `external_refs` mapping (does NOT delete it), and never upserts a canonical row. Create/update/transition keep the P0 upsert+record order.

**Impl:** `dispatch.ts` — add an optional `tombstoneReadModel: (pmoRecordId: string) => Promise<void>` to `DispatchExternallyOwnedWriteDeps`; when `command.operation === 'delete'`, after a successful `commit`, call `tombstoneReadModel(command.record.id)` and **skip** `writeReadModel`; still return the `CommandResult`. `recordExternalRef` is **not** called on delete (mapping kept as-is). Edge fn `adapter-dispatch/index.ts`: wire `tombstoneReadModel` for `tasks` = `update tasks set tombstoned_at = now() where org_id=$org and id=$pmoRecordId` (service client).

**Verify:** `npx vitest run src/lib/adapterSeam/dispatch.test.ts` + re-run the deno boot-smoke for `adapter-dispatch`.

### C4 — Wire tasks.ts writes through the routing seam (GREEN for C1) — FR-CUA-022/023/024/030

**File:** `pmo-portal/src/lib/db/tasks.ts` (edit). At the top of each of `createTask`/`updateTask`/`updateTaskStatus`/`deleteTask`, branch:
```ts
if (routeTaskWrite() === 'external') {
  const res = await dispatchTaskCommand('create', { id: crypto.randomUUID(), project_id: input.project_id, name: input.name, status: input.status, assignee_id: input.assignee_id ?? null, start_date: input.start_date ?? null, end_date: input.end_date ?? null });
  return res.canonical as unknown as TaskRow;
}
// ...existing direct DAL unchanged below
```
`updateTask`/`updateTaskStatus` → `dispatchTaskCommand('update'|'transition', { id, ...patch })`; `deleteTask` → `dispatchTaskCommand('delete', { id })` then `return`. **`addDependency`/`removeDependency` are NOT branched** (enhancements stay direct — FR-CUA-024). `listTasks`/`getTask` stay on the read-model and are tightened by C5/C5b; Gantt/S-curve remain transitively covered through `listTasks`.
**Verify (GREEN):** `npx vitest run src/lib/repositories/task.external.test.ts` now passes both halves.

### C4b — Route My Tasks quick-status through the repository seam (RED→GREEN) — supports AC-CUA-001/060/061

**Files:** `pmo-portal/src/hooks/useMyTasks.routedStatus.test.tsx` (new) + `pmo-portal/src/hooks/useMyTasks.ts` (edit). Replace the inline `supabase.from('tasks').update({status})` at `useMyTasks.ts:92` with the repository helper `updateTaskStatus(id, status)` from `pmo-portal/src/lib/db/tasks.ts`, so the My Tasks quick-status inherits `routeTaskWrite()` + pending-push behavior instead of bypassing `dispatchTaskCommand`. The test sets the ownership cache to `{ tasks:'clickup' }`, triggers the hook mutation, and proves the routed helper/dispatch path is called; a PMO-owned control case proves the direct helper still works.
**Verify:** `cd pmo-portal && npx vitest run src/hooks/useMyTasks.routedStatus.test.tsx`

### C5 — Filter tombstoned rows from `listTasks` (RED→GREEN) — supports AC-CUA-002

**Files:** `pmo-portal/src/lib/db/tasks.ts` `listTasks` + `pmo-portal/src/lib/db/tasks.tombstone.test.ts` (new/extend). Add `.is('tombstoned_at', null)` to the `listTasks` query and assert a tombstoned row is excluded from the active project task list; the same test notes Gantt/S-curve are transitively covered because both surfaces consume `listTasks` rather than a separate task query.
**Verify:** `cd pmo-portal && npx vitest run src/lib/db/tasks.tombstone.test.ts`

### C5b — Filter tombstoned rows from `getTask` (RED→GREEN) — supports AC-CUA-002

**Files:** `pmo-portal/src/lib/db/tasks.ts` `getTask` + `pmo-portal/src/lib/db/tasks.tombstone.test.ts` (same file, distinct owning case). Add `.is('tombstoned_at', null)` at the `getTask` read path (`pmo-portal/src/lib/db/tasks.ts:88`) and assert `getTask(id)` returns `null` for a tombstoned mirror row while a live row still resolves normally.
**Verify:** `cd pmo-portal && npx vitest run src/lib/db/tasks.tombstone.test.ts`

### C5c — Filter tombstoned rows from `listMyTasks` (RED→GREEN) — supports AC-CUA-002

**Files:** `pmo-portal/src/hooks/useMyTasks.ts` `listMyTasks` + `pmo-portal/src/hooks/useMyTasks.tombstone.test.tsx` (new). Add `.is('tombstoned_at', null)` to the cross-project assignee query at `useMyTasks.ts:36`, and assert the My Tasks list omits tombstoned task rows while keeping the existing assignee/project-name join behavior byte-for-byte for live rows.
**Verify:** `cd pmo-portal && npx vitest run src/hooks/useMyTasks.tombstone.test.tsx`

### C5d — Filter tombstoned rows from the agent `tasks` read path (RED→GREEN) — supports AC-CUA-002

**Files:** `supabase/functions/agent-chat/readEntities.ts`, `supabase/functions/agent-chat/actions.ts`, and `supabase/functions/agent-chat/actions.queryEntity.test.ts` (new). Extend the entity catalogue so the `tasks` entry carries an internal hard filter `tombstoned_at is null`, and teach `runQueryEntity()` to append that filter before user filters are applied. The owning test queries `entity:'tasks'` and proves the builder excludes tombstoned rows, while a non-task entity control case proves no extra filter leaks onto other entities.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-backend-integration-a78790 && deno test supabase/functions/agent-chat/actions.queryEntity.test.ts`

### C6 — useOwnershipCacheSync hook + mount — FR-CUA-031, ADR-0056

**File:** `pmo-portal/src/hooks/useOwnershipCacheSync.ts` (new): subscribe to `useExternalDomainOwnership()`; on success `setTaskOwnership(data)`, on sign-out/`undefined` `clearOwnershipCache()`. Mount once at app root (a `useOwnershipCacheSync()` call in the top-level authenticated layout — the builder locates the single authenticated shell). Test: hook calls `setTaskOwnership` when the query resolves.
**Verify:** `npx vitest run src/hooks/useOwnershipCacheSync.test.tsx`

### C7 — pendingPush.clickup test (RED→GREEN) — AC-CUA-062

**File:** `pmo-portal/src/lib/adapterSeam/pendingPush.clickup.test.ts` (new). `AC-CUA-062` `classifyExternalError` on an `AppError('...', 'external-unreachable')` → `{ headline:'external system unreachable — try again', ... }`; on `commit-rejected` → headline carrying ClickUp's message. (Composes the shipped `pendingPush.ts` classifier — assert the ClickUp-classified error flows through unchanged.) No new impl if the P0 classifier already covers it; this test pins the contract for the ClickUp codes.
**Verify:** `npx vitest run src/lib/adapterSeam/pendingPush.clickup.test.ts`

### C8 — TaskPushBadge + real-surface board pending-push test (RED→GREEN) — AC-CUA-060

**Files:** `pmo-portal/src/components/tasks/TaskPushBadge.tsx` (new — renders `pushing`/`pushed`/`push-failed` from a `PendingPushState`, DESIGN.md tokens) + extend `useTaskMutations` to expose a per-task `PendingPushState` derived via `pendingPushAfterWrite(routeTaskWrite(), outcome)` (ADR-0056).
**Test:** `pmo-portal/pages/project-detail/__tests__/TasksTab.pendingPush.test.tsx` — render the **real** `pages/project-detail/tabs/TasksTab.tsx` surface (board mode, not a standalone `TaskBoard` import). `AC-CUA-060` with tasks externally-owned (cache set), a board card write shows `pushing`→`pushed`; a write with the dispatch rejecting shows `push-failed` and the card reverts to the prior read-model state.
**Verify:** `cd pmo-portal && npx vitest run pages/project-detail/__tests__/TasksTab.pendingPush.test.tsx`

### C9 — PMO-owned surfaces stay badge-free test (RED→GREEN) — AC-CUA-061

**File:** `pmo-portal/pages/project-detail/__tests__/TasksTab.pendingPush.visibility.test.tsx` — `AC-CUA-061` with tasks **PMO-owned** (cache `pmo`), writes on the real list / board / edit-modal detail surfaces show **no** `pushing`/`pushed`/`push-failed` badge (byte-for-byte). Wire `TaskPushBadge` into `pages/project-detail/tabs/TasksTab.tsx` only when `routeTaskWrite()==='external'`.
**Verify:** `cd pmo-portal && npx vitest run pages/project-detail/__tests__/TasksTab.pendingPush.visibility.test.tsx`

### C10 — Write-through e2e (RED→GREEN) — AC-CUA-090

**File:** `pmo-portal/e2e/AC-CUA-090-clickup-task-writethrough.spec.ts` (new). Boot a **mock ClickUp HTTP server** (a local fixture server the spec starts; the edge fn's `CLICKUP_API_TOKEN`+base-URL point at it), seed an org with `tasks`→`clickup` for a project with a mirrored task + its `external_project_bindings` row. `AC-CUA-090` on the board, change the task's status → the card shows `pushing`, the dispatch commits to the mock, the read-model updates from the mock's answer, the card settles to `pushed`, and a reload shows the mirrored status.
**Verify:** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/erpnext-backend-integration-a78790 && scripts/with-db-lock.sh npx playwright test AC-CUA-090` (run from repo root per Playwright-from-pmo-portal note; builder confirms the cwd the config expects).

### C11 — Slice-C gate — AC-CUA-001/038/060/061/062/090, AC-CUA-002

`cd pmo-portal && npm run verify` + `scripts/with-db-lock.sh supabase test db` + the deno boot-smoke for `adapter-dispatch` + the AC-CUA-090 e2e green.

**Riskiest task of Slice C: C4** — the `tasks.ts` wiring is where the byte-for-byte invariant can silently
break (a mis-placed branch, or forgetting that `addDependency`/`milestone_id` must stay direct). C1 is the
guard and is authored first; do not merge C4 without C1 green on **both** halves.

---

## Slice D — Change-feed engine (webhook ingress + reconciliation sweep)

**Goal:** the up-path — a signed webhook ingress (latency) + a watermark sweep (truth), both applying to
the read-model via the shared apply logic with the per-row source-mod guard, plus enhancement integrity
on deletion and the ownership-agnostic rollup.

### D1 — HMAC signature test + module (RED→GREEN) — AC-CUA-040

**Files:** `clickup/signature.ts` (`verifyClickUpSignature(rawBody, header, secret): boolean` — HMAC-SHA256, constant-time compare) + `clickup/signature.test.ts`. `AC-CUA-040` a valid `X-Signature` verifies; an absent/invalid one does not. **Secret lives only in the edge fn env** (asserted structurally — the pure fn takes it as a param).
**Verify:** `npx vitest run src/lib/adapterSeam/clickup/signature.test.ts`

### D2 — webhookApply test: signature-gated no-side-effect + idempotency (RED) — AC-CUA-040/041

**File:** `clickup/webhookApply.test.ts`. With an injected service-role table stub + resolver:
- `AC-CUA-040` an invalid-signature request → handler returns `401`, `writeReadModel`/upsert **never** called (no side effect). (This asserts the *ingress* wiring in D8 too; the pure `applyWebhookEvent` here assumes verified input and is exercised for the apply-side ACs.)
- `AC-CUA-041` a valid `taskUpdated` event applied twice → the read-model converges to one state (idempotent upsert keyed on `external_refs`), watermark advances monotonically.

**Verify (RED):** `npx vitest run src/lib/adapterSeam/clickup/webhookApply.test.ts`

### D3 — webhookApply test: source-mod guard + adopt (RED) — AC-CUA-045/042

Append to `webhookApply.test.ts`:
- `AC-CUA-045` a mirrored row with stored `source_updated_at = T2`; an incoming change with `T1 < T2` → **no-op** (row unchanged); a change with `>= T2` → applies. (Guard is per-row, independent of the org watermark.)
- `AC-CUA-042` a `taskCreated`/`taskUpdated` for a ClickUp task with **no** `external_refs` mapping → mints a new mirrored `tasks` row + mapping (pull-adopt path, FR-CUA-062), not dropped.

**Verify (RED):** same file.

### D4 — webhookApply.ts (GREEN) — FR-CUA-042/043/044/049/062

**File:** `clickup/webhookApply.ts`: `applyWebhookEvent(event, deps)` — resolve org + mapped record from `external_refs`; **source-mod guard** (apply only if incoming `date_updated >= row.source_updated_at`); branch `taskDeleted`→tombstone (D6), `taskCreated`/`taskUpdated`/`taskStatusUpdated`→upsert canonical + set `source_updated_at`; unmapped→adopt (mint row + mapping, relying on the A8 adopt-unique to dedupe concurrent adopts); advance the org `(tasks,clickup)` watermark to ≥ the event timestamp (`upsertWatermark`, monotonic). Pure — all DB via injected service client.
**Verify (GREEN):** D2+D3 file green.

### D5 — Sweep test + module (RED→GREEN) — AC-CUA-043/044

**Files:** `clickup/sweep.test.ts` + `clickup/sweep.ts`. `runSweep(orgId, deps)`: read watermark → `adapter.listChangesSinceWatermark('tasks', cursor)` → `applyWebhookEvent`-equivalent apply per change → advance to `nextCursor`.
- `AC-CUA-043` applies changes since the watermark, advances to `nextCursor`; overlap with a prior webhook apply is harmless (idempotent).
- `AC-CUA-044` adapter unreachable → watermark **not** advanced, read-model unchanged; a concurrent PMO-owned write is unaffected (assert the sweep throws/no-ops without touching the watermark).
**Verify:** `npx vitest run src/lib/adapterSeam/clickup/sweep.test.ts`

### D6 — Deletion/enhancement-integrity test + tombstone apply (RED→GREEN) — AC-CUA-070/071

**File:** `clickup/deletion.test.ts` (or fold into webhookApply.test.ts per traceability — traceability names `deletion.test.ts` for AC-070 and `webhookApply.test.ts` for AC-071; keep both):
- `AC-CUA-070` a `taskDeleted` webhook → the mirrored row is **tombstoned** (`tombstoned_at` set), NOT removed; its dependency edges + milestone grouping are **preserved** (not cascade-removed, keyed on the retained `pmo_record_id`); the deletion is surfaced (an audit/notice write). (OD-CUA-2.)
- `AC-CUA-071` a `taskUpdated` webhook → native fields update, dependency/milestone enhancements intact.
**Verify:** `npx vitest run src/lib/adapterSeam/clickup/deletion.test.ts src/lib/adapterSeam/clickup/webhookApply.test.ts`

### D7 — Rollup-over-mirror test + tombstoned-edge hiding (RED→GREEN) — AC-CUA-072

**Files:** `pmo-portal/src/lib/rollup/mirroredTasks.test.ts` (new) + `pmo-portal/pages/project-detail/__tests__/ProjectGantt.tombstones.test.tsx` (new). `AC-CUA-072` milestone-progress/rollup computed over a project whose tasks are mirrored (with weights/milestones, tombstoned rows excluded) **equals** the computation over an equivalent PMO-owned project — the rollup reads the read-model, ownership-agnostic (FR-CUA-082/021). Add the UI counterpart: dependency edges may legitimately survive in `task_dependencies`, so Gantt/board-style dependency rendering must hide any edge whose source or target task is tombstoned; assert that no edge is rendered when either endpoint is tombstoned. If the rollup or edge selector already reads only the active read-model, this test pins that invariant (byte-for-byte for non-ClickUp orgs).
**Verify:** `cd pmo-portal && npx vitest run src/lib/rollup/mirroredTasks.test.ts pages/project-detail/__tests__/ProjectGantt.tombstones.test.tsx`

### D8 — clickup-webhook edge function — FR-CUA-040/041/043

**Files:** `supabase/functions/clickup-webhook/index.ts` + `deno.json` (imports map mirroring `adapter-dispatch/deno.json`) + `deno.lock`. Handler: read raw body → `verifyClickUpSignature(raw, header, CLICKUP_WEBHOOK_SECRET)` → `401` on fail (no side effect) → parse → `applyWebhookEvent` via a service client → `200`. **Thin wiring only** (apply logic is unit-tested in `webhookApply.ts`; this file is integration-only, guarded by deno check + boot-smoke).
**Verify:** `deno check --config supabase/functions/clickup-webhook/deno.json --lock supabase/functions/clickup-webhook/deno.lock --frozen supabase/functions/clickup-webhook/index.ts` + `deno run --allow-all --config supabase/functions/clickup-webhook/deno.json scripts/deno-boot-smoke.ts supabase/functions/clickup-webhook/index.ts` → `BOOT_OK`.

### D9 — clickup-sweep edge function + cron registration (idle-until-configured) — FR-CUA-045/048

**Files:** `supabase/functions/clickup-sweep/index.ts` (+ `deno.json`/`deno.lock`) — service-role-bearer-guarded (mirrors `agent-dispatch`), iterates employing orgs → `runSweep`. `supabase/migrations/0092_clickup_sweep_cron.sql` — register a conservative `pg_cron` job (sized within the ~100 req/min budget) that `net.http_post`s `clickup-sweep`; **registered-but-idle** until the dispatch GUCs are set, exactly following migration 0048's precedent (**CONFIRMED** by Director ruling). Reversible (drop the cron job).
**Verify:** deno check + boot-smoke for `clickup-sweep`; `scripts/with-db-lock.sh supabase db reset` applies 0092 cleanly.

### D10 — config.toml + CI wiring — NFR-CUA-SEC-002

**Files:**
- `supabase/config.toml`: add `[functions.clickup-webhook] verify_jwt = false` (public surface — the HMAC is the sole trust boundary, FR-CUA-041; comment mirrors `telegram-notify`) and `[functions.clickup-sweep] verify_jwt = false` (cron-invoked, self-verifies the service bearer; comment mirrors `agent-dispatch`).
- `.github/workflows/ci.yml`: add `clickup-webhook clickup-sweep` to **both** the `deno check` loop (line ~122) and the `boot-smoke` loop (line ~136).
**Verify:** re-run the two deno loops locally for all functions.

### D11 — Webhook-reflect e2e (RED→GREEN) — AC-CUA-091

**File:** `pmo-portal/e2e/AC-CUA-091-clickup-webhook-reflect.spec.ts` (new). Same employed-ClickUp project + an open board; the mock ClickUp posts a **signed** `taskUpdated` to `clickup-webhook`; `AC-CUA-091` the ingress applies it and the board reflects the mirrored change on refresh. *(Optional per spec — may fold into AC-CUA-090; if folded, note it here and drop the file.)*
**Verify:** `scripts/with-db-lock.sh npx playwright test AC-CUA-091`

### D12 — Slice-D gate — AC-CUA-040..045/070/071/072/091, AC-CUA-002

`cd pmo-portal && npm run verify` + `scripts/with-db-lock.sh supabase test db` + deno check/boot-smoke for `clickup-webhook`+`clickup-sweep` + the e2e green.

**Riskiest task of Slice D: D4** — `webhookApply.ts` carries three interacting invariants (signature-verified
input, per-row source-mod monotonicity `>=` guard, adopt-under-concurrency via the A8 unique constraint). A
gap here strands stale rows or mints duplicate mirrors. D2/D3 must assert the no-op-on-older and
adopt-dedupe paths explicitly before D4 merges.

---

## Slice E — Onboarding (provisioning + push-seed + pull-adopt)

**Goal:** the two clean onboarding directions (OD-CUA-3: reject the mixed case at provisioning),
idempotent + resumable via `external_refs`/watermark.

### E1 — Onboarding test: provisioning + reject-mixed (RED) — FR-CUA-063, OD-CUA-3

**File:** `clickup/onboarding.test.ts`. `provisionBinding(projectId, deps)`: binds one ClickUp List per project, captures status/member maps into `external_project_bindings.config`. `AC` (governs FR-CUA-063): when **both** the PMO project AND the mapped List already hold tasks → throws an operator-facing "List and project both non-empty — choose a clean direction" (reject-at-provisioning); an empty List (→push-seed) or empty project (→pull-adopt) is accepted.
**Verify (RED):** `npx vitest run src/lib/adapterSeam/clickup/onboarding.test.ts`

### E2 — Push-seed test (RED) — AC-CUA-050/051/052

Append to `onboarding.test.ts`:
- `AC-CUA-050` `pushSeed(projectId, deps)` on an empty List → one ClickUp `create` per PMO task, records `external_refs`, leaves the read-model row (now a mirror); a re-run creates nothing new (already-mapped skipped).
- `AC-CUA-051` a partial failure then resume → only the unmapped remainder created (no duplicates); `external_refs` is the resumption ledger.
- `AC-CUA-052` PMO tasks carrying milestone grouping + dependencies → only mapping-set fields pushed; no milestone/dependency data sent (FR-CUA-024).

### E3 — Pull-adopt test (RED) — AC-CUA-053

Append: `AC-CUA-053` `pullAdopt(projectId, deps)` on a List with tasks → upserts one mirrored `tasks` row + mapping per ClickUp task (via `listChangesSinceWatermark` from a null cursor); a re-run reconciles without duplicating; a partial run resumes from the watermark.
**Verify (RED):** the onboarding file.

### E4 — onboarding.ts (GREEN) — FR-CUA-050/051/052/060/061/062/063/064

**File:** `clickup/onboarding.ts`: `provisionBinding` / `pushSeed` / `pullAdopt`, all rate-limited (reuse `rateLimit.ts`, **bulk lane** yielding to interactive — NFR-CUA-PERF-003), idempotent+resumable via `external_refs`/watermark, adopt-dedupe leaning on the A8 unique constraint.
**Verify (GREEN):** `npx vitest run src/lib/adapterSeam/clickup/onboarding.test.ts`

### E5 — clickup-onboard edge function (integration wiring) — FR-CUA-063

**Files:** `supabase/functions/clickup-onboard/index.ts` (+ `deno.json`/`deno.lock`) — Operator/service-role-guarded; invokes `provisionBinding`/`pushSeed`/`pullAdopt` for a project. Thin wiring (logic unit-tested). Add to config.toml (`verify_jwt=false`, self-verifies service bearer) + the CI deno loops.
**Verify:** deno check + boot-smoke for `clickup-onboard`.

### E6 — Slice-E gate — AC-CUA-050..053, AC-CUA-002

`cd pmo-portal && npm run verify` + deno check/boot-smoke for `clickup-onboard`.

---

## Slice F — Integrations view P1 rows + display labels + data-locality note

**Goal:** surface ClickUp on the read-only Integrations view with human labels (OD-EAS-LABELS debt) and
the required US-hosted data-locality note (NFR-CUA-LOCALITY-001).

### F1 — Display-label map test + module (RED→GREEN) — OD-EAS-LABELS

**Files:** `pmo-portal/src/components/integrations/integrationLabels.ts` (new — `tierLabel('clickup')→'ClickUp'`, `domainLabel('tasks')→'Tasks'`, fallback to the raw slug) + `integrationLabels.test.ts`.
**Verify:** `npx vitest run src/components/integrations/integrationLabels.test.ts`

### F2 — IntegrationsView P1 rows + data-locality note (RED→GREEN) — NFR-CUA-LOCALITY-001

**Files:** `pmo-portal/src/components/integrations/IntegrationsView.tsx` (edit — render `tierLabel`/`domainLabel` instead of raw slugs; for the `clickup` tier render the single copy line "ClickUp is US-hosted SaaS — task-domain data resides with ClickUp") + `IntegrationsView.test.tsx` (extend — asserts the ClickUp tier renders the label + the locality note).
**Verify:** `npx vitest run src/components/integrations/IntegrationsView.test.tsx`

### F3 — Legal note home for the data-locality disclosure — NFR-CUA-LOCALITY-001 (doc-review NFR)

**File:** `docs/legal/2026-07-10-clickup-data-locality-note.md` (new short note). Record the same US-hosted data-locality asymmetry there so the client-facing legal/docs home matches the Integrations view copy per Director ruling. Doc-review only, no runtime test.

### F4 — Slice-F gate — NFR-CUA-LOCALITY-001, AC-CUA-002

`cd pmo-portal && npm run verify`.

---

## Traceability — every AC-CUA-### → slice · task · owning test (layers match the spec exactly)

| AC | Slice · Task | Owning layer | Owning test file |
|---|---|---|---|
| AC-CUA-001 | C · C1 | Vitest (unit) | `pmo-portal/src/lib/repositories/task.external.test.ts` |
| AC-CUA-002 | **every slice gate** (A9/B/C11/D12/E6/F4) | Cross-layer regression gate | the unchanged existing suite staying green (`npm run verify` + `supabase test db`) |
| AC-CUA-020 | A · A1 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-021 | A · A1 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-022 | A · A2 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-023 | A · A1 | pgTAP | `supabase/tests/tasks_external_owned_rls.test.sql` |
| AC-CUA-024 | A · A3 | pgTAP | `supabase/tests/external_refs_adopt_unique.test.sql` |
| AC-CUA-030 | B · B11 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/adapter.test.ts` |
| AC-CUA-031 | B · B1/B9 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/commands.test.ts` |
| AC-CUA-032 | B · B9 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/commands.test.ts` |
| AC-CUA-033 | B · B9 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/commands.test.ts` |
| AC-CUA-034 | B · B3 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/statusMap.test.ts` |
| AC-CUA-035 | B · B11 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/reads.test.ts` |
| AC-CUA-036 | B · B11 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/reads.test.ts` |
| AC-CUA-037 | B · B5 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/memberMap.test.ts` |
| AC-CUA-038 | C · C3 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/dispatch.test.ts` |
| AC-CUA-040 | D · D1/D2/D8 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` (+ `signature.test.ts`) |
| AC-CUA-041 | D · D2 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-042 | D · D3 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-043 | D · D5 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/sweep.test.ts` |
| AC-CUA-044 | D · D5 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/sweep.test.ts` |
| AC-CUA-045 | D · D3 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-050 | E · E2 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-051 | E · E2 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-052 | E · E2 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-053 | E · E3 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/onboarding.test.ts` |
| AC-CUA-060 | C · C8 | Vitest (unit, RTL) | `pmo-portal/pages/project-detail/__tests__/TasksTab.pendingPush.test.tsx` |
| AC-CUA-061 | C · C9 | Vitest (unit, RTL) | `pmo-portal/pages/project-detail/__tests__/TasksTab.pendingPush.visibility.test.tsx` |
| AC-CUA-062 | C · C7 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/pendingPush.clickup.test.ts` |
| AC-CUA-070 | D · D6 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/deletion.test.ts` |
| AC-CUA-071 | D · D6 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/webhookApply.test.ts` |
| AC-CUA-072 | D · D7 | Vitest (unit) | `pmo-portal/src/lib/rollup/mirroredTasks.test.ts` |
| AC-CUA-080 | B · B7 | Vitest (unit) | `pmo-portal/src/lib/adapterSeam/clickup/rateLimit.test.ts` |
| AC-CUA-090 | C · C10 | e2e | `pmo-portal/e2e/AC-CUA-090-clickup-task-writethrough.spec.ts` |
| AC-CUA-091 | D · D11 | e2e (optional) | `pmo-portal/e2e/AC-CUA-091-clickup-webhook-reflect.spec.ts` |

Structural NFRs (CONTRACT-001 / SEC-003 / PERF-002) are proven transitively (contract-shape B11 +
confinement grep + cached-map short-circuit C1/C2) and reviewed at the gate. NFR-CUA-LOCALITY-001 is a
doc-review NFR (F2/F3). NFR-CUA-PERF-001/003 are exercised by AC-CUA-080 (B7).

**Supplemental regression/support tests added by this fix round (non-owning; they reinforce AC-CUA-002 and the shipped invariants without changing AC ownership):**
- `pmo-portal/src/hooks/useMyTasks.routedStatus.test.tsx` — C4b proves My Tasks quick-status uses `updateTaskStatus()`/routing instead of an inline Supabase write.
- `pmo-portal/src/lib/db/tasks.tombstone.test.ts` — C5/C5b covers `listTasks` + `getTask` tombstone filtering.
- `pmo-portal/src/hooks/useMyTasks.tombstone.test.tsx` — C5c covers the My Tasks tombstone filter.
- `supabase/functions/agent-chat/actions.queryEntity.test.ts` — C5d covers the agent `tasks` read tombstone filter.
- `pmo-portal/pages/project-detail/__tests__/ProjectGantt.tombstones.test.tsx` — D7 covers hidden dependency edges when either endpoint is tombstoned.

---

## Secrets, config & CI surface (name every knob)

**Deployment-scoped ClickUp secrets (1Password vault `AS` → Supabase function secrets; NEVER in DB/client/logs, env-file-privacy rule):**
- P1 simplifies to **one `CLICKUP_API_TOKEN` + one `CLICKUP_WEBHOOK_SECRET` per deployment**. Because each client has its own Supabase project today (ADR-0047 topology), this is already per-client in practice. The spec's FR-CUA-041 "per-org secret" therefore resolves to a deployment-scoped secret in P1; true per-org secret selection is deferred until multiple employing orgs share one deployment.
- 1Password items are **`clickup-api-token`** + **`clickup-webhook-secret`** in vault `AS` today; when real clients flip, add a per-client suffix if needed by ops convention.
- ClickUp API token: op item `clickup-api-token` field `credential` → Supabase function secret **`CLICKUP_API_TOKEN`** (read by `adapter-dispatch`, `clickup-sweep`, `clickup-onboard`). Set via `supabase secrets set CLICKUP_API_TOKEN=$(scripts/op-get.sh clickup-api-token AS credential)`.
- ClickUp webhook secret: op item `clickup-webhook-secret` field `credential` → function secret **`CLICKUP_WEBHOOK_SECRET`** (read by `clickup-webhook` only; the HMAC trust boundary for FR-CUA-041 under the P1 deployment-scoped topology).
- Mocked-only in P1 (owner intake): tests inject `fetch`/secret; no live token required. Re-run the mapper/create-vs-update assignee live-smoke appendix once a real token exists.

**Webhook URL / config.toml:**
- Ingress URL: `https://<project-ref>.supabase.co/functions/v1/clickup-webhook` (registered per ClickUp workspace at provisioning — operational, out of P1's test surface).
- `supabase/config.toml`: `[functions.clickup-webhook] verify_jwt = false` (public + HMAC), `[functions.clickup-sweep] verify_jwt = false` (cron/service-bearer), `[functions.clickup-onboard] verify_jwt = false` (Operator/service-bearer). `[functions.adapter-dispatch]` stays `verify_jwt = true` (browser-invoked, unchanged).

**CI wiring (`.github/workflows/ci.yml`, D10/E5):** add `clickup-webhook clickup-sweep clickup-onboard` to **both** the `deno check` loop and the `deno-boot-smoke` loop. Each new function ships its own committed `deno.json` + `deno.lock` (`--frozen` in CI). Boot-smoke is mandatory — it is the only guard that catches an import-time TDZ crash the deployed worker would hit (2026-07-04 precedent).

**Type regen:** after Slice A, `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts` (adds `tombstoned_at`, `source_updated_at`, `external_project_bindings`). Prefer regen over hand-casts (repo lesson).

---

## Per-slice final gate (binding — run the WHOLE suite, never just touched files)

Every slice PR runs, from the paths shown:
1. `cd pmo-portal && npm run verify` (= typecheck + lint:ci + test + build — mirrors CI `verify`).
2. Where the slice touches the DB (A, D): `scripts/with-db-lock.sh supabase test db` from the repo root — **the whole pgTAP suite**, proving AC-CUA-002 (zero regression).
3. Where the slice touches an edge function (B, C, D, E): `deno check` + `deno run scripts/deno-boot-smoke.ts` for **every** touched function.
4. Where the slice owns an e2e (C, D): `scripts/with-db-lock.sh npx playwright test AC-CUA-090` / `AC-CUA-091`.

All DB-driving commands are wrapped in `scripts/with-db-lock.sh` (shared local Docker DB, parallel agents).

---

## Open questions for the Director

None. The fix-round rulings resolved the remaining config/scheduler/doc-location questions: vault `AS` item names are `clickup-api-token` + `clickup-webhook-secret`, the sweep stays `pg_cron` registered-but-idle per migration 0048, and the data-locality note lives in `docs/legal/2026-07-10-clickup-data-locality-note.md` plus the Integrations view copy.

---

## Appendix A — deferred live-smoke prerequisites

- **`CLICKUP_API_BASE_URL` seam** (the `adapter-dispatch` / ClickUp client base URL) is NOT added in P1's mocked-only test surface; it lands with the deferred live-smoke appendix (a real token + a real ClickUp workspace) that needs it. P1's `clickup/client.ts` hard-codes the ClickUp REST v2 base; the seam is introduced when the live-smoke appendix is authored.
