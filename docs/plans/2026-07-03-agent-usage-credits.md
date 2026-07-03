# Implementation plan — Agent usage ledger & per-user credits (batteries-included A, item 3)

- **Date:** 2026-07-03
- **Issue:** PMO #3 (batteries-included A) — usage metering + credit-backed `RateGuard`.
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec:** `docs/specs/agent-usage-credits.spec.md` (FR-AUC-001..018, OBS-AUC-001..004, NFR-AUC-SEC/PERF/A11Y, AC-AUC-001..019 + traceability table)
- **Binding authority:** ADR-0044 §6 controls the enforcement shape (preflight at the `RateGuard` injection point) where it disagrees with the spec; no disagreement was found (spec confirms this in its own "Contradictions" section).
- **Migration high-water mark:** current top is `supabase/migrations/0046_agent_persistence.sql` (issue 2, verified on disk 2026-07-03) → **this plan adds `0047_agent_usage_credits.sql`**.
- **pgTAP high-water mark:** current top is `supabase/tests/0093_agent_persistence_append_only.test.sql` → **this plan adds `0094`/`0095`/`0096`**.
- **Reference slice (pattern to copy, do not reinvent):** `supabase/migrations/0046_agent_persistence.sql` + `supabase/tests/0092_agent_persistence_tenancy.test.sql` + `supabase/tests/0093_agent_persistence_append_only.test.sql` (owner-only RLS, symmetric FK-ownership `WITH CHECK`, append-only-by-omission).
- **Plan this one mirrors in structure:** `docs/plans/2026-07-03-agent-persistence.md`.

---

## 0. WARNING — sequencing against issue 2, read before building

**This plan executes AFTER issue 2 (`docs/plans/2026-07-03-agent-persistence.md`) merges to `dev`.**
Everything in §1–§3 below is grounded in a live read of `supabase/functions/agent-chat/handler.ts`,
`index.ts`, `persistence.ts`, migration `0046`, and pgTAP `0091`–`0093` **as they exist on disk right
now** (2026-07-03, pre-merge but already built on the `feat/agent-persistence` branch content per the
dispatch brief's instruction to treat it as the present baseline). Two integration points this plan
depends on:

1. **`agent-chat/handler.ts` Gate 3** (`if (deps.rateGuard) { const r = await deps.rateGuard.check(...); if (r.exceeded) {...} }`, currently ~line 400) — confirmed still wired `rateGuard: undefined` in `index.ts` (comment `// rateGuard: undefined (AR-OD-002 default — disabled in v1)`, line 181). **If issue 2's merge changes Gate 3's line numbers, variable names, or the `HandlerDeps`/`RateGuard` interface shape, the implementer adapts to the merged shape — the *behavior* (check before any `modelClient.create()` call) is what this plan requires, not the exact diff hunk.**
2. **The single per-round model-call choke point** — `const resp = await deps.modelClient.create({...})` appears at exactly **two** call sites: `agentChatHandlerInner`'s tool-use loop (~line 468) and `runLoop`'s tool-use loop (~line 866). This plan's usage-recording hook (Task B4) inserts immediately after each. **If issue 2's merge refactors these two loops into a shared helper (there is no such helper today — confirmed by reading both loops in full), the implementer follows the refactor and finds the equivalent single-per-round `create()` resolution point(s) — do not duplicate the insert across more sites than there are `create()` calls (FR-AUC-002 grain).**

**Escalate to the Director, do not silently improvise, if:** the merged `handler.ts` moves Gate 3 to run *after* a model call, removes the `RateGuard` interface, or restructures the loop such that `resp.usage` is no longer available at a single per-round point. Everything else (variable renames, line shifts, additional persistence fields) is adapt-and-continue.

**Compose-view side:** `supabase/functions/compose-view/handler.ts` Gate 4 (`if (rateGuard) { const rateResult = await rateGuard.check(userId); ... }`, ~line 160) is untouched by issue 2 (compose-view has no persistence integration) — lower drift risk, read as-is.

---

## 1. Architecture & data flow

```
agent-chat/index.ts (Deno)                      compose-view/index.ts (Deno)
  rateGuard: undefined  ──EDIT──►  creditRateGuard   rateGuard: undefined  ──EDIT──►  creditRateGuard
  (bound to callerClient,                              (bound to callerClient,
   gated on AGENT_CREDITS_ENFORCED)                     same shared implementation)
       │                                                      │
       ▼                                                      ▼
agent-chat/handler.ts Gate 3 (UNCHANGED position/shape)   compose-view/handler.ts Gate 4 (UNCHANGED)
  if (deps.rateGuard) { const r = await check(userId); if (r.exceeded) → RATE_LIMITED, return }
       │ (passes — balance > 0)
       ▼
  tool-use loop, each round:
    const resp = await deps.modelClient.create({...})   ◄── the ONE choke point per round
       │
       ▼
    recordUsage(deps.usage, runId, resp)  ◄── NEW, independent of deps.persistence (FR-AUC-004/018)
       │ (clamped insert under callerClient JWT)
       ▼
Postgres: agent_usage (spend ledger, owner-only insert/select)
Postgres: credits      (admin-grant ledger, owner-only select, Admin-only insert, append-only)
       │
       ▼
balance = sum(credits.amount) − sum(agent_usage.cost), computed fresh in creditRateGuard.check()
       │
       ▼
Browser: AssistantPanel — on status {error:'RATE_LIMITED', retryAfterSeconds<=0} → composer disabled,
  out-of-credits message (role="status"), distinct from the generic ErrorCard path
```

**Two independent gates, not one.** `AGENT_CREDITS_ENFORCED` (new, this spec) controls whether
`creditRateGuard` is wired into `index.ts` at all — separate from `AGENT_PERSISTENCE` (issue 2) and
the SPA's `agentAssistant` flag. Usage **recording** is unconditional (no flag) — the ledger fills
regardless of whether enforcement is on (FR-AUC-017/018).

**Deputy invariant (NFR-AUC-SEC-001).** `agent_usage` inserts and the `credits`/`agent_usage`
balance-read both go through the same caller-JWT client `handler.ts` already receives as
`deps.supabase` — no new client, no `service_role`. `creditRateGuard.check()` is a **read-only**
preflight (NFR-AUC-SEC-005): it computes and returns a boolean; it never writes.

**`AGENT_CREDITS_ENFORCED` default: OFF** (spec Open Question 3, resolved here). Rationale: matches
today's `rateGuard: undefined` behavior — flipping default-ON would instantly lock out every user
with no seeded `credits` grant (balance `0 − spent` ⇒ negative the moment any usage row exists).
Usage recording ships unconditionally regardless of this flag, so historical data exists the moment
an operator flips enforcement on.

**`RATE_LIMITED` reason convention (spec Open Question 2, resolved here): convention over wire
field.** Per FR-AUC-013, `retryAfterSeconds <= 0` on a `RATE_LIMITED` error means "out of credits" —
no new SSE field. This keeps `AgentEvent`'s payload shape untouched (OBS-AUC-004). Revisit only if a
second non-credit `RateGuard` is ever built (YAGNI, matches the spec's own recommendation).

---

## 2. File tree (exact paths — NEW unless marked EDIT)

```
supabase/
  migrations/
    0047_agent_usage_credits.sql                        NEW   agent_usage + credits tables, indexes, RLS
  tests/
    0094_agent_usage_credits_schema.test.sql             NEW   AC-AUC-001..003
    0095_agent_usage_credits_tenancy.test.sql             NEW   AC-AUC-004..009
    0096_agent_usage_credits_balance.test.sql             NEW   AC-AUC-010..011
  functions/
    _shared/
      usage.ts                                            NEW   clampUsageValue() + insertUsageRow() (caller-JWT)
      usage.test.ts                                        NEW   — wait, Vitest can't run supabase/functions/** directly (no Vitest project there); see REC-1 below — moved to pmo-portal/src/lib/agent/
      creditRateGuard.ts                                    NEW   RateGuard impl: computeBalance() + check()
    agent-chat/
      handler.ts                                          EDIT  wire recordUsage() at the 2 create() choke points
      index.ts                                            EDIT  wire creditRateGuard in place of `rateGuard: undefined`, gated on AGENT_CREDITS_ENFORCED
    compose-view/
      handler.ts                                          EDIT  wire recordUsage() at composeSpec's model-call site
      index.ts                                            EDIT  wire the SAME creditRateGuard, gated on the SAME env var
pmo-portal/
  src/
    lib/
      agent/
        usage.test.ts                                     NEW   [REC-1] AC-AUC-012..014 (clamp) — imports _shared/usage.ts across the boundary
        creditRateGuard.test.ts                            NEW   [REC-1] AC-AUC-015 — imports _shared/creditRateGuard.ts
        handlerCredits.test.ts                              NEW   [REC-1] AC-AUC-016/018 — imports agent-chat/handler.ts
        composeViewHandlerCredits.test.ts                   NEW   [REC-1] AC-AUC-017 — imports compose-view/handler.ts
    components/
      panel/
        AssistantPanel.credits.test.tsx                    NEW   AC-AUC-019
        AssistantPanel.tsx                                  EDIT  render out-of-credits state on RATE_LIMITED/retryAfterSeconds<=0
    hooks/
      useAssistantPanel.ts                                  EDIT  new RunPhase 'out-of-credits'; distinguishes RATE_LIMITED from generic error
docs/
  adr/                                                       (no new ADR — see §0 below)
```

**REC-1 (file-location correction, mirrors issue-2 plan's own REC-1).** The spec's traceability table
names `supabase/functions/agent-chat/usage.test.ts` / `rateGuard.credits.test.ts` /
`handler.credits.test.ts` / `compose-view/handler.credits.test.ts` as the unit-test locations. **Repo
reality (confirmed by `glob supabase/functions/**/*.test.ts` → zero results; there is no Vitest
project rooted in `supabase/`):** every edge-fn unit test lives under `pmo-portal/src/lib/agent/*.test.ts`
and imports across the boundary via a relative path, exactly as issue 2's plan established for
`handlerPersistence.test.ts`/`handlerDeputyInvariant.test.ts`. This plan follows that **standing
convention** (also stated in the dispatch brief): all four new unit-test files land under
`pmo-portal/src/lib/agent/`, not `supabase/functions/**`. AC-ids are unchanged.

**No new ADR.** The enforcement shape is already ADR-0044 §6's controlling decision; the balance-shape
tradeoff (ledger-pair vs. mutable counter) is already recorded in the spec's own "Design choices"
section, which is sufficiently durable prose (mirrors how issue 2 folded its constants into §0 of its
own plan rather than a new ADR file). Nothing here is irreversible/cross-cutting beyond what ADR-0044
already commits to.

---

## 3. Traceability (AC → owning test, ADR-0010 lowest-sufficient layer)

| AC | Layer | Owning test (title / file) |
|---|---|---|
| AC-AUC-001 | pgTAP | `AC-AUC-001 agent_usage table exists with required columns` · `supabase/tests/0094_agent_usage_credits_schema.test.sql` |
| AC-AUC-002 | pgTAP | `AC-AUC-002 credits table exists, positive-amount constraint enforced` · `0094_agent_usage_credits_schema.test.sql` |
| AC-AUC-003 | pgTAP | `AC-AUC-003 required indexes exist` · `0094_agent_usage_credits_schema.test.sql` |
| AC-AUC-004 | pgTAP | `AC-AUC-004 non-owner same-org reads zero` · `supabase/tests/0095_agent_usage_credits_tenancy.test.sql` |
| AC-AUC-005 | pgTAP | `AC-AUC-005 cross-org read zero incl admin` · `0095_agent_usage_credits_tenancy.test.sql` |
| AC-AUC-006 | pgTAP | `AC-AUC-006 own grant visible, other user's grant not` · `0095_agent_usage_credits_tenancy.test.sql` |
| AC-AUC-007 | pgTAP | `AC-AUC-007 non-admin credits insert denied` · `0095_agent_usage_credits_tenancy.test.sql` |
| AC-AUC-008 | pgTAP | `AC-AUC-008 agent_usage insert owner-pinned, spoofed owner denied` · `0095_agent_usage_credits_tenancy.test.sql` |
| AC-AUC-009 | pgTAP | `AC-AUC-009 credits update/delete denied (append-only)` · `0095_agent_usage_credits_tenancy.test.sql` |
| AC-AUC-010 | pgTAP | `AC-AUC-010 balance equals granted minus spent` · `supabase/tests/0096_agent_usage_credits_balance.test.sql` |
| AC-AUC-011 | pgTAP | `AC-AUC-011 no-grant balance is negative spent` · `0096_agent_usage_credits_balance.test.sql` |
| AC-AUC-012 | Unit | `AC-AUC-012 non-finite negative usage clamped to zero` · `pmo-portal/src/lib/agent/usage.test.ts` |
| AC-AUC-013 | Unit | `AC-AUC-013 non-numeric usage clamped to zero no throw` · `usage.test.ts` |
| AC-AUC-014 | Unit | `AC-AUC-014 valid usage passes through unchanged` · `usage.test.ts` |
| AC-AUC-015 | Unit | `AC-AUC-015 positive balance not rate-limited` · `pmo-portal/src/lib/agent/creditRateGuard.test.ts` |
| AC-AUC-016 | Unit | `AC-AUC-016 zero-or-negative balance blocks before model call` · `pmo-portal/src/lib/agent/handlerCredits.test.ts` |
| AC-AUC-017 | Unit | `AC-AUC-017 compose-view shares the same balance and guard` · `pmo-portal/src/lib/agent/composeViewHandlerCredits.test.ts` |
| AC-AUC-018 | Unit | `AC-AUC-018 usage recorded independent of persistence flag` · `handlerCredits.test.ts` |
| AC-AUC-019 | Unit | `AC-AUC-019 composer disables and shows out-of-credits message` · `pmo-portal/src/components/panel/AssistantPanel.credits.test.tsx` |

---

## PHASE A — Migration + pgTAP (schema is the foundation; RLS/tenancy/balance owned here)

> TDD note for SQL: pgTAP is the failing-test-first vehicle. Write the test file, run
> `supabase test db` → it fails (table absent), then write the migration → it passes. Reset DB
> between edits with `supabase db reset` (all commands from repo root).

### Task A1 — Write the schema pgTAP (RED) — AC-AUC-001..003
**File:** `supabase/tests/0094_agent_usage_credits_schema.test.sql` (NEW)
Copy the `begin; select plan(N); … select * from finish(); rollback;` frame from
`supabase/tests/0091_agent_persistence_schema.test.sql`. Assert:
- `has_table('agent_usage')`, `has_table('credits')`.
- `has_column('agent_usage','run_id')` + a comment noting it is nullable (no `col_not_null` assertion for it); `col_is_fk('agent_usage','run_id')`.
- `has_column('agent_usage','model')`, `col_type_is('agent_usage','model','text')`.
- `col_not_null('agent_usage','prompt_tokens')`, `col_default_is('agent_usage','prompt_tokens','0')`.
- `col_not_null('agent_usage','completion_tokens')`, `col_default_is('agent_usage','completion_tokens','0')`.
- `col_not_null('agent_usage','cost')`, `col_type_is('agent_usage','cost','numeric')`.
- `has_column('credits','amount')`, `col_not_null('credits','amount')`.
- `has_column('credits','note')` (nullable — no `col_not_null` assertion).
- `col_not_null('credits','granted_by')`, `col_default_is('credits','granted_by','auth.uid()')`.
- **Positive-amount constraint (part of AC-AUC-002):** `throws_ok($$ insert into credits (owner_id, amount) values ('00000000-0000-0000-0000-000000000000', 0) $$, '23514')` and repeat for `amount = -5` — both rejected by the check constraint (run these as table owner with RLS bypass is irrelevant here since the constraint fires before RLS; use a `set local role authenticated` + a real `owner_id` if the constraint-vs-RLS ordering needs disambiguating, but a `23514` check-constraint violation fires regardless of role).
- `has_index('agent_usage', 'agent_usage_owner_created_idx')`, `has_index('agent_usage', 'agent_usage_run_id_idx')` (AC-AUC-003).

**Verify (fails):** `supabase db reset && supabase test db 2>&1 | grep 0094` → expect failure "relation agent_usage does not exist".

### Task A2 — Write the tenancy pgTAP (RED) — AC-AUC-004..009
**File:** `supabase/tests/0095_agent_usage_credits_tenancy.test.sql` (NEW)
Model on `0092_agent_persistence_tenancy.test.sql` exactly (fixtures inserted as table owner, then
`set local role authenticated` + `set local request.jwt.claims`). Fixture namespace `00950000-…`.
Org A = default `00000000-…-0001`; Org B = `00950000-…-0002`. Users: Ann (org A, Engineer, owns a
usage row + a credits grant), Bob (org A, Engineer, non-owner), Carol (org B, Engineer), Dana (org A,
**Admin**, non-owner, tests the "Admin does not bypass agent_usage owner-only read" absence-of-grant —
note: unlike `agent_persistence`'s explicit no-Admin-read divergence, this spec doesn't call out an
Admin-read grant for `agent_usage` either, so Dana behaves identically to Bob here — a same-org
non-owner, Admin or not, reads zero), Erin (org B, Admin, for the cross-org Admin case). Also need a
run row Ann owns (`agent_runs`, migration `0046`) to FK `agent_usage.run_id` against.

Assert:
- **AC-AUC-004:** as Bob → `count(*) from agent_usage` for Ann's row = 0.
- **AC-AUC-005:** as Carol (org B, Engineer) → `count(*)` for Ann's `agent_usage` row = 0; as Erin (org B, Admin) → `count(*)` = 0 (cross-org wall holds regardless of role).
- **AC-AUC-006:** as Ann → her own `credits` grant is visible (`count(*) = 1`); as Bob (same org, non-owner) → `count(*) = 0` for Ann's grant.
- **AC-AUC-007:** as Bob (non-Admin) → `throws_ok($$ insert into credits (owner_id, amount) values ('<bob's id>', 50) $$, '42501')` AND `throws_ok($$ insert into credits (owner_id, amount) values ('<ann's id>', 50) $$, '42501')` — both denied regardless of grant target.
- **AC-AUC-008:** as Bob → `throws_ok($$ insert into agent_usage (owner_id, model, cost) values ('<ann's id>', 'test-model', 1) $$, '42501')` (spoofed `owner_id` denied by `WITH CHECK`).
- **AC-AUC-009:** as Ann (the granting user is Dana/Admin in the fixture, or Ann herself if a caller can self-grant — irrelevant, the point is NO role can mutate) → `throws_ok($$ update credits set amount = 200 where id = '<grant id>' $$, '42501')` and `throws_ok($$ delete from credits where id = '<grant id>' $$, '42501')` — both denied for **every** role including whichever role performed the original insert (RLS has no UPDATE/DELETE policy at all — default-deny).

**Verify (fails):** `supabase test db 2>&1 | grep 0095` → failure (tables absent).

### Task A3 — Write the balance pgTAP (RED) — AC-AUC-010..011
**File:** `supabase/tests/0096_agent_usage_credits_balance.test.sql` (NEW)
Fixture namespace `00960000-…`. One user (Fay, org A, Engineer) for AC-AUC-010; a second, separate
user (Gus, org A, Engineer) for AC-AUC-011 (isolated so the two ACs don't share balance state).
- **AC-AUC-010:** insert one `credits` row for Fay with `amount = 100`; insert two `agent_usage` rows
  for Fay with `cost = 10` and `cost = 15` (`model` required not-null — use `'test-model'`). As Fay,
  run `select (coalesce((select sum(amount) from credits where owner_id = auth.uid()), 0) - coalesce((select sum(cost) from agent_usage where owner_id = auth.uid()), 0))` and assert `is(...)` equals `75`.
- **AC-AUC-011:** Gus has zero `credits` rows and one `agent_usage` row with `cost = 5`. As Gus, the
  same balance expression evaluates to `-5` (the `coalesce` on the empty `credits` sum returns `0`,
  proving the "no grants → balance is `0 − spent`" default per FR-AUC-010).

This is a **SQL-expression-level proof**, not a stored function/view — the spec's FR-AUC-010
explicitly says "computed fresh at check time (never cached/stored)"; `creditRateGuard.ts` (Task B3)
implements the identical query shape in TypeScript against the same tables, so this pgTAP is the
canonical proof of the *arithmetic*, and Task B3's unit test proves the *TypeScript call site* uses
it correctly (mocked, not a live DB round-trip).

**Verify (fails):** `supabase test db 2>&1 | grep 0096` → failure (tables absent).

### Task A4 — Write the migration (GREEN) — FR-AUC-001..009
**File:** `supabase/migrations/0047_agent_usage_credits.sql` (NEW)
Copy the header/reversibility-comment style from `0046_agent_persistence.sql`. Reuse
`auth_org_id()`/`auth_role()` from `0002_rls.sql` (do **not** redefine). Emit exactly:

```sql
-- 0047_agent_usage_credits.sql — agent_usage (per-request spend ledger) + credits (admin-grant
-- ledger), the mechanism backing docs/specs/agent-usage-credits.spec.md. Balance is COMPUTED
-- (sum(credits.amount) - sum(agent_usage.cost)), never stored — no mutable counter, no race
-- (FR-AUC-010, spec "Design choices"). Both tables are owner-private; credits INSERT is the
-- family's first Admin-only RLS policy (no UPDATE/DELETE policy on credits for any role —
-- append-only by omission, FR-AUC-007). Reuses auth_org_id()/auth_role() from 0002_rls.sql.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback (reverse order):
--   drop policy if exists credits_insert on credits;
--   drop policy if exists credits_select on credits;
--   drop policy if exists agent_usage_insert on agent_usage;
--   drop policy if exists agent_usage_select on agent_usage;
--   drop index if exists public.agent_usage_run_id_idx;
--   drop index if exists public.agent_usage_owner_created_idx;
--   drop table if exists public.credits;
--   drop table if exists public.agent_usage;

create table agent_usage (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id           uuid not null references profiles(id) default auth.uid(),
  run_id             uuid references agent_runs(id) on delete set null,
  model              text not null,
  prompt_tokens      integer not null default 0,
  completion_tokens  integer not null default 0,
  cost               numeric not null default 0,
  created_at         timestamptz not null default now()
);

create table credits (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id    uuid not null references profiles(id),
  amount      numeric not null check (amount > 0),
  note        text,
  granted_by  uuid not null references profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- Hot-path indexes (NFR-AUC-PERF-001): the balance sum and "my usage history" queries.
create index agent_usage_owner_created_idx on agent_usage (owner_id, created_at);
create index agent_usage_run_id_idx        on agent_usage (run_id);

alter table agent_usage enable row level security;
alter table agent_usage force row level security;
alter table credits     enable row level security;
alter table credits     force row level security;

-- ── agent_usage: owner-only SELECT/INSERT. No UPDATE/DELETE policy for anyone (append-only by
-- omission — a usage row is a historical fact, never corrected in place; NFR-AUC-SEC-001). ────────
create policy agent_usage_select on agent_usage for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

-- WITH CHECK also verifies run_id (when non-null) belongs to a run the caller owns — mirrors the
-- agent_events_insert/agent_runs_insert symmetric FK-ownership guard (0046_agent_persistence.sql).
create policy agent_usage_insert on agent_usage for insert
  with check (
    owner_id = auth.uid() and org_id = auth_org_id()
    and (
      run_id is null
      or exists (
        select 1 from agent_runs r
         where r.id = agent_usage.run_id
           and r.owner_id = auth.uid()
           and r.org_id = auth_org_id()
      )
    )
  );

-- ── credits: owner-only SELECT; Admin-only INSERT (the family's first Admin-only INSERT policy —
-- NFR-AUC-SEC-002). No UPDATE/DELETE policy for anyone (FR-AUC-007 — mis-issued grants are
-- corrected by a new row, never mutation). ──────────────────────────────────────────────────────
create policy credits_select on credits for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

create policy credits_insert on credits for insert
  with check (auth_role() = 'Admin' and org_id = auth_org_id());
```

Note: `credits.owner_id` has **no default** (FR-AUC-006 — "no default, always explicit on insert
since an admin is granting to someone else"), unlike every other agent-family table's `owner_id
default auth.uid()`. `granted_by default auth.uid()` still applies (the admin who grants). The
`credits_insert` policy does **not** additionally require `owner_id = auth.uid()` (a grant is
FOR another user by design) — only `auth_role() = 'Admin'` and the org pin.

**Verify (green):** `supabase db reset && supabase test db 2>&1 | grep -E '0094|0095|0096'` → all pass. Then full: `supabase test db` all-green.

### Task A5 — Confirm no unintended RLS widening on `agent_usage`/`credits` SELECT (append to A2 file) — reinforces AC-AUC-005/007
**File:** `supabase/tests/0095_agent_usage_credits_tenancy.test.sql` (EDIT — same file as A2, add plan count)
Add the schema-level twin assertion (mirrors issue 2's Task A5): query `pg_policies` for
`tablename in ('agent_usage','credits') and cmd = 'SELECT'` and assert every `qual` contains
`owner_id = auth.uid()` (no `auth_role`-widened SELECT exists on either table — Admin does not get a
broader read than an owner on `agent_usage`, and `credits_select` is the same owner-only shape even
though `credits_insert` is Admin-gated). Also assert `pg_policies` has **zero** rows for
`tablename = 'credits' and cmd in ('UPDATE','DELETE')` (append-only-by-omission, AC-AUC-009's
mechanism). Titled `AC-AUC-009 no UPDATE/DELETE policy exists on credits (append-only by omission)`.

**Verify:** `supabase test db 2>&1 | grep 0095` → pass.

---

## PHASE B — Edge-fn usage recording + credit-backed RateGuard (unit-tested with mocked Supabase)

> Follows `agentChatHandler.test.ts`'s established mock pattern (`mockOrgAnd`/`baseDeps` helpers) and
> issue 2's `handlerPersistence.test.ts` structure. All four new Vitest files live under
> `pmo-portal/src/lib/agent/` per REC-1.

### Task B1 — `clampUsageValue` failing test (RED) — AC-AUC-012/013/014
**File:** `pmo-portal/src/lib/agent/usage.test.ts` (NEW)
Import `{ clampUsageValue }` from `'../../../../supabase/functions/_shared/usage'`. Three `it(...)`
blocks titled with the AC-ids:
```ts
import { describe, it, expect } from 'vitest';
import { clampUsageValue } from '../../../../supabase/functions/_shared/usage';

it('AC-AUC-012 non-finite negative usage clamped to zero', () => {
  expect(clampUsageValue(NaN)).toBe(0);
  expect(clampUsageValue(-3)).toBe(0);
  expect(clampUsageValue(Infinity)).toBe(0);
  expect(clampUsageValue(-Infinity)).toBe(0);
});

it('AC-AUC-013 non-numeric usage clamped to zero no throw', () => {
  expect(clampUsageValue('5' as unknown as number)).toBe(0);
  expect(clampUsageValue(null as unknown as number)).toBe(0);
  expect(clampUsageValue(undefined as unknown as number)).toBe(0);
  expect(clampUsageValue({} as unknown as number)).toBe(0);
  expect(clampUsageValue([1, 2] as unknown as number)).toBe(0);
  expect(() => clampUsageValue('5' as unknown as number)).not.toThrow();
});

it('AC-AUC-014 valid usage passes through unchanged', () => {
  expect(clampUsageValue(120)).toBe(120);
  expect(clampUsageValue(45)).toBe(45);
  expect(clampUsageValue(0.0031)).toBe(0.0031);
  expect(clampUsageValue(0)).toBe(0);
});
```

**Verify (fails):** from `pmo-portal/`: `npx vitest run src/lib/agent/usage.test.ts` → module-not-found.

### Task B2 — `_shared/usage.ts` scaffold (GREEN for B1) — FR-AUC-003, NFR-AUC-SEC-004-EXT
**File:** `supabase/functions/_shared/usage.ts` (NEW)
```ts
/**
 * agent-chat/compose-view usage recording — clamp + insert (FR-AUC-001..004, NFR-AUC-SEC-004-EXT).
 * Deputy invariant by construction: takes the already-injected caller-JWT HandlerSupabaseLike;
 * never constructs a client, never references service_role.
 */
import type { HandlerSupabaseLike } from '../agent-chat/handler';
import type { ModelResponse } from './modelClient';

/**
 * Clamp a single provider-reported usage value: Number.isFinite(x) && x >= 0 ? x : 0.
 * NFR-AUC-SEC-004-EXT: a non-numeric type (string/object/array/null/undefined) is treated
 * identically to a non-finite number — Number.isFinite on a non-number is always false
 * (Number.isFinite("5") === false), so this already coerces stringly/object/null/undefined
 * input to 0 without ever throwing or attempting a numeric parse.
 */
export function clampUsageValue(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0;
}

export interface UsageDeps {
  supabase: HandlerSupabaseLike;
  runId: string | null;
}

/**
 * Insert one agent_usage row for a single ModelResponse (FR-AUC-002 grain — one row per
 * modelClient.create() resolution). Swallows errors (NFR-AUC-SEC-006 — logs count/code only,
 * never blocks the turn), mirroring persistence.ts's discipline. Unconditional — NOT gated on
 * deps.persistence (FR-AUC-004/018): the caller (handler.ts) invokes this at every create()
 * resolution regardless of whether persistence is enabled.
 */
export async function recordUsage(deps: UsageDeps, resp: ModelResponse): Promise<void> {
  try {
    const { error } = await deps.supabase
      .from('agent_usage')
      .insert({
        run_id: deps.runId,
        model: resp.model,
        prompt_tokens: clampUsageValue(resp.usage?.prompt_tokens),
        completion_tokens: clampUsageValue(resp.usage?.completion_tokens),
        cost: clampUsageValue(resp.usage?.total_cost),
      })
      .select()
      .single();
    if (error) {
      console.error('[agent-usage] recordUsage insert failed', {
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[agent-usage] recordUsage threw', {
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}
```

**Verify (green):** `npx vitest run src/lib/agent/usage.test.ts` → all three AC tests pass.

### Task B3 — `creditRateGuard` failing test (RED) — AC-AUC-015
**File:** `pmo-portal/src/lib/agent/creditRateGuard.test.ts` (NEW)
Import `{ createCreditRateGuard }` from `'../../../../supabase/functions/_shared/creditRateGuard'`.
Mock a `HandlerSupabaseLike`-shaped `.from('credits')`/`.from('agent_usage')` chain returning
`{ data: [{ amount: 100 }], error: null }` and `{ data: [{ cost: 10 }, { cost: 15 }], error: null }`
respectively (mirrors `mockOrgAnd`'s `.select().eq().limit()` shape from `agentChatHandler.test.ts`).
```ts
it('AC-AUC-015 positive balance not rate-limited', async () => {
  const supabase = mockCreditsAndUsage({ grants: [{ amount: 100 }], usage: [{ cost: 10 }, { cost: 15 }] });
  const guard = createCreditRateGuard({ supabase });
  const result = await guard.check('user-1');
  expect(result).toEqual({ exceeded: false, retryAfterSeconds: 0 });
});
```
Also add a second `it` (supporting, not separately AC-tagged — folded into the traceability owner
above): a zero-grants + positive-usage fixture resolves `{ exceeded: true, retryAfterSeconds: 0 }`
(the AC-AUC-016 *decision-logic* half; the *handler-wiring-blocks-the-model-call* half is B5's job).

**Verify (fails):** `npx vitest run src/lib/agent/creditRateGuard.test.ts` → module-not-found.

### Task B4 — `_shared/creditRateGuard.ts` (GREEN for B3) — FR-AUC-010/011/013
**File:** `supabase/functions/_shared/creditRateGuard.ts` (NEW)
```ts
/**
 * creditRateGuard — the credit-backed RateGuard implementation (FR-AUC-011, ADR-0044 §6).
 * Read-only preflight (NFR-AUC-SEC-005): computes and returns a boolean; never writes to
 * credits/agent_usage itself. Deputy invariant: takes the already-injected caller-JWT
 * HandlerSupabaseLike; constructs no client.
 */
import type { HandlerSupabaseLike } from '../agent-chat/handler';
import { clampUsageValue } from './usage';

export interface CreditRateGuardDeps {
  supabase: HandlerSupabaseLike;
}

export interface RateGuardResult {
  exceeded: boolean;
  retryAfterSeconds: number;
}

/**
 * balance = sum(credits.amount) - sum(agent_usage.cost), scoped to userId, computed fresh
 * (FR-AUC-010 — never cached/stored). A user with no credits rows has balance = 0 - spent.
 * NFR-AUC-SEC-004-EXT residual: agent_usage.cost is already clamped at write time (usage.ts);
 * this read-path clamp is defense-in-depth only, per NFR-AUC-SEC-004's "no second clamp is
 * strictly needed at read time, but confirm no bypass" instruction.
 */
async function computeBalance(deps: CreditRateGuardDeps, userId: string): Promise<number> {
  const [{ data: grants }, { data: usage }] = await Promise.all([
    deps.supabase.from('credits').select('amount').eq('owner_id', userId).limit(10_000),
    deps.supabase.from('agent_usage').select('cost').eq('owner_id', userId).limit(10_000),
  ]);
  const granted = (grants ?? []).reduce(
    (sum, row) => sum + clampUsageValue((row as { amount?: number }).amount),
    0,
  );
  const spent = (usage ?? []).reduce(
    (sum, row) => sum + clampUsageValue((row as { cost?: number }).cost),
    0,
  );
  return granted - spent;
}

/**
 * Factory (not a class) matching the RateGuard interface's `check(userId)` shape verbatim
 * (OBS-AUC-001 — the interface is reused, not redefined).
 */
export function createCreditRateGuard(deps: CreditRateGuardDeps): {
  check(userId: string): Promise<RateGuardResult>;
} {
  return {
    async check(userId: string): Promise<RateGuardResult> {
      const balance = await computeBalance(deps, userId);
      // FR-AUC-013: retryAfterSeconds is always 0 for the credit case — a shortfall does not
      // resolve after a fixed wait, unlike a request-per-minute throttle. The client (panel)
      // interprets retryAfterSeconds<=0 on RATE_LIMITED as "out of credits" (convention, not a
      // new wire field — spec Open Question 2).
      return { exceeded: balance <= 0, retryAfterSeconds: 0 };
    },
  };
}
```
Note: `HandlerSupabaseLike.from(table).select(cols).eq(col, val)` returns a shape with `.limit(n)` per
`handler.ts`'s existing interface (confirmed by reading `HandlerSupabaseLike` — `eq()` already returns
an object with `.limit(n): Promise<{data,error}>`) — no interface change needed to support this query
shape.

**Verify (green):** `npx vitest run src/lib/agent/creditRateGuard.test.ts` → AC-AUC-015 + the supporting negative-balance case pass.

### Task B5 — Wire usage recording + RateGuard into `agent-chat/handler.ts` (GREEN) — FR-AUC-002/004/011/014, AC-AUC-016/018
**File:** `supabase/functions/agent-chat/handler.ts` (EDIT)
Two changes, both additive (no existing test regresses — confirm by re-running `agentChatHandler.test.ts` and `handlerPersistence.test.ts` after):

1. **`HandlerDeps` gains an optional `usage?: { supabase: HandlerSupabaseLike }`** field (separate
   from `persistence` — usage recording must fire even when `persistence` is `undefined`, per
   FR-AUC-004/018/AC-AUC-018). In practice `usage.supabase` is the same caller-JWT client as
   `deps.supabase` — index.ts wires it identically, but the dep is named/typed independently so a
   test can enable one without the other.
2. **At each of the two `const resp = await deps.modelClient.create({...})` call sites**
   (`agentChatHandlerInner`'s loop, `runLoop`'s loop — confirmed exactly 2 sites per §0's WARNING),
   immediately after `resp` resolves, call:
   ```ts
   if (deps.usage) {
     await recordUsage({ supabase: deps.usage.supabase, runId: persist ? runId : null }, resp);
   }
   ```
   Import `recordUsage` from `'../_shared/usage'` at the top of `handler.ts`. `runId` is
   `persist ? runId : null` in `agentChatHandlerInner` (where `persist`/`runId` are already in
   scope — FR-AUC-004: `run_id` is set only when a run row exists, i.e. when persistence is on) and
   is `req.runId ?? null` in `runLoop` (its own scope already threads `req.runId` — see the existing
   `const runId = req.runId ?? ''` line; use `req.runId ?? null` for the usage call specifically,
   since `agent_usage.run_id` is a nullable FK, not the empty-string placeholder `runLoop` uses
   internally for other purposes).
3. **Gate 3 already exists and needs no structural change** — `if (deps.rateGuard) { const r =
   await deps.rateGuard.check(deps.userId); if (r.exceeded) { yield statusEvent('errored', { error:
   'RATE_LIMITED', retryAfterSeconds: r.retryAfterSeconds }); return; } }` (confirmed present,
   unconditionally runs before the tool-use loop's first `create()` call). This plan's `RateGuard`
   implementation (Task B4) satisfies the interface as-is — **no handler.ts edit is needed for Gate
   3 itself**, only the `index.ts` wiring (Task B7).

**Verify (green so far — the wiring compiles but AC-AUC-016/018 need B6's test):** `cd pmo-portal && npm run typecheck` → zero errors (both `handler.ts` and its two call sites reference `recordUsage`/`deps.usage` consistently).

### Task B6 — `handlerCredits.test.ts` failing→passing tests (RED→GREEN) — AC-AUC-016/018
**File:** `pmo-portal/src/lib/agent/handlerCredits.test.ts` (NEW)
```ts
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';
import type { AgentEvent } from './runtime/port';
import type { AgentChatRequest } from './runtime/transport';

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const REQ: AgentChatRequest = { messages: [{ role: 'user', content: 'how many active projects?' }] };

it('AC-AUC-016 zero-or-negative balance blocks before model call', async () => {
  const create = vi.fn(); // never called if the preflight works
  const supabase = mockOrgCreditsAndUsage({ grants: [], usage: [{ cost: 5 }] }); // balance = -5
  const events = await collect(
    agentChatHandler(REQ, {
      modelClient: { create },
      model: 'deepseek/deepseek-v4-flash',
      supabase,
      userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase }),
      now: () => new Date('2026-07-03T00:00:00Z'),
    }),
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ type: 'status', payload: { status: 'errored', error: 'RATE_LIMITED', retryAfterSeconds: 0 } });
  expect(create).not.toHaveBeenCalled();
});

it('AC-AUC-018 usage recorded independent of persistence flag', async () => {
  const insertSpy = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null }) }) });
  const supabase = mockOrgAndUsageInsert(insertSpy); // profiles + entity reads work; agent_usage insert captured
  const modelClient = {
    create: vi.fn().mockResolvedValue({
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Done.' },
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, total_cost: 0.002 },
      model: 'deepseek/deepseek-v4-flash',
    }),
  };
  await collect(
    agentChatHandler(REQ, {
      modelClient,
      model: 'deepseek/deepseek-v4-flash',
      supabase,
      userId: 'user-1',
      usage: { supabase }, // usage dep present
      // persistence: undefined  — deliberately OMITTED (ADR-0043 flag off)
      now: () => new Date('2026-07-03T00:00:00Z'),
    }),
  );
  expect(insertSpy).toHaveBeenCalledWith(
    expect.objectContaining({ run_id: null, model: 'deepseek/deepseek-v4-flash', prompt_tokens: 10, completion_tokens: 5, cost: 0.002 }),
  );
});
```
Build `mockOrgCreditsAndUsage`/`mockOrgAndUsageInsert` helpers in this file following
`agentChatHandler.test.ts`'s `mockOrgAnd` pattern (a `.from(table)` switch: `'profiles'` → org-1 org
lookup; `'credits'`/`'agent_usage'` (select path) → the fixture rows; `'agent_usage'` (insert path,
second test) → the `insertSpy`; all other tables → empty rows, matching `mockOrgAnd`'s fallback).

**Verify (fails then passes):** `npx vitest run src/lib/agent/handlerCredits.test.ts` → AC-AUC-016 fails until B5's Gate-3 wiring + B4's guard are both present (they are, from B4/B5) — expect this to be GREEN on first run since B4/B5 precede it; if RED, the failure pinpoints whether Gate 3's position or the guard's decision logic is the gap (§0 WARNING escalation trigger if Gate 3's shape has drifted). Then confirm no regression: `npx vitest run src/lib/agent/agentChatHandler.test.ts src/lib/agent/handlerPersistence.test.ts` → still green.

### Task B7 — Wire usage + RateGuard into `agent-chat/index.ts` — FR-AUC-011/017
**File:** `supabase/functions/agent-chat/index.ts` (EDIT)
Add, alongside the existing `AGENT_PERSISTENCE` flag read:
```ts
// ── ADR-0044 §6 / FR-AUC-017: credit-backed RateGuard, independent of AGENT_PERSISTENCE.
// Default OFF (spec Open Question 3) — matches today's `rateGuard: undefined` behavior so an
// existing deployment with no seeded credits grants is not instantly locked out. An operator
// flips this on once grant seed-data exists for their users.
const creditsEnforced = Deno.env.get('AGENT_CREDITS_ENFORCED') === 'true';
```
Then in the `agentChatHandler(body, {...})` deps object, replace the comment-only
`// rateGuard: undefined (AR-OD-002 default — disabled in v1)` line with:
```ts
rateGuard: creditsEnforced ? createCreditRateGuard({ supabase: callerClient as unknown as Parameters<typeof agentChatHandler>[1]['supabase'] }) : undefined,
// FR-AUC-004/018: usage recording is UNCONDITIONAL (no flag) — independent of both
// AGENT_PERSISTENCE and AGENT_CREDITS_ENFORCED.
usage: { supabase: callerClient as unknown as Parameters<typeof agentChatHandler>[1]['supabase'] },
```
Add the import: `import { createCreditRateGuard } from '../_shared/creditRateGuard.ts';` (Deno-style
`.ts` extension, matching this file's existing import style — contrast with `handler.ts`'s extensionless
relative imports, per the file's own established convention seen in the existing `import {
loadJournaledWrites, loadMaxSeq } from './persistence.ts';` line).

**Verify:** `cd pmo-portal && npm run typecheck` → zero errors (the shared `transport.ts`/`port.ts`
types still compile against the edits). Deno lint of the function is a deploy-time gate (not CI),
consistent with this file's existing "Integration-only" header note.

### Task B8 — `composeViewHandlerCredits.test.ts` failing→passing test (RED→GREEN) — AC-AUC-017
**File:** `pmo-portal/src/lib/agent/composeViewHandlerCredits.test.ts` (NEW)
```ts
import { it, expect, vi } from 'vitest';
import { composeViewHandler } from '../../../../supabase/functions/compose-view/handler';
import { createCreditRateGuard } from '../../../../supabase/functions/_shared/creditRateGuard';

it('AC-AUC-017 compose-view shares the same balance and guard', async () => {
  const modelClientCreate = vi.fn();
  const supabase = mockProfilesCreditsAndUsage({ orgId: 'org-1', grants: [], usage: [{ cost: 1 }] }); // balance = -1
  const result = await composeViewHandler(
    { prompt: 'show me active projects', orgId: 'org-1' },
    {
      modelClient: { create: modelClientCreate },
      model: 'deepseek/deepseek-v4-flash',
      supabase,
      userId: 'user-1',
      rateGuard: createCreditRateGuard({ supabase: supabase as never }),
    },
  );
  expect(result).toMatchObject({ status: 429, body: { error: 'RATE_LIMITED', retryAfterSeconds: 0 } });
  expect(modelClientCreate).not.toHaveBeenCalled();
});
```
Build `mockProfilesCreditsAndUsage` in this file (`compose-view/handler.ts`'s `SupabaseLike` needs
only `.from('profiles').select().eq().single()` for its own gate PLUS the `.from('credits')`/
`.from('agent_usage')` shape `creditRateGuard` needs — `compose-view`'s narrower `SupabaseLike`
interface (Task B9 below) must be widened to support this, see Task B9). Note `composeViewHandler`
returns a value (`HandlerResult`), not an async generator — the RATE_LIMITED shape here is
`{status:429, body:{error:'RATE_LIMITED', retryAfterSeconds}}` (OBS-AUC-001's interface, but
`compose-view`'s own wire shape per its existing Gate 4 code, confirmed by reading `handler.ts`
lines 159-172 above).

**Verify (fails then passes):** `npx vitest run src/lib/agent/composeViewHandlerCredits.test.ts`.

### Task B9 — Widen `compose-view/handler.ts`'s `SupabaseLike` + wire usage recording (GREEN for B8) — FR-AUC-002/015
**File:** `supabase/functions/compose-view/handler.ts` (EDIT)
1. `SupabaseLike`'s `.from(table).select(columns).eq(column, value)` today returns only
   `{ single(): Promise<...> }` (the profiles-lookup shape). Widen it to also support `.eq(...)`
   returning an object with `.limit(n)` (matching `HandlerSupabaseLike`'s shape in `agent-chat/handler.ts`)
   so `creditRateGuard`'s `.from('credits').select('amount').eq('owner_id', userId).limit(10_000)`
   call compiles against this interface too:
   ```ts
   export interface SupabaseLike {
     from(table: string): {
       select(columns: string): {
         eq(column: string, value: string): {
           single(): Promise<{ data: { org_id: string } | null; error: unknown }>;
           limit(n: number): Promise<{ data: unknown[] | null; error: unknown }>;
         };
       };
     };
   }
   ```
2. `HandlerDeps` gains `usage?: { supabase: SupabaseLike }` (mirrors agent-chat's addition).
3. Inside `composeSpec()`'s call to the model client (the one `modelClient.create()` site reached via
   `composeSpec(req.prompt, req.orgId, { modelClient, userId, model })` — since `composeSpec.ts` owns
   the actual `create()` call, not `handler.ts` directly, and this plan does not touch `composeSpec.ts`'s
   internals): **the simplest choke point consistent with FR-AUC-002's "once per compose-view
   invocation" grain is immediately after `composeSpec()` resolves successfully**, inside
   `composeViewHandler`'s try block, before the `return { status: 200, ... }`:
   ```ts
   const { spec, repairAttempts, tokensUsed } = await composeSpec(...);
   if (deps.usage) {
     await recordUsage(
       { supabase: deps.usage.supabase, runId: null },
       { model, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: tokensUsed, total_cost: undefined }, finish_reason: 'stop', message: { role: 'assistant', content: null } },
     );
   }
   return { status: 200, body: { spec, repairAttempts, tokensUsed } };
   ```
   `tokensUsed` is the field `composeSpec` already returns (confirmed: `ComposeViewResponse` carries
   `tokensUsed`) — mapped to `total_cost` is wrong (tokens ≠ cost); **correct mapping:** put
   `tokensUsed` under `completion_tokens` (a reasonable proxy — compose-view has no separate
   prompt/completion split today) OR, cleaner: extend `recordUsage`'s call here to accept a raw
   `{ model, prompt_tokens, completion_tokens, cost }` shape directly rather than forcing a
   `ModelResponse` wrapper (compose-view has no `ModelResponse.usage` object at this call site — it
   only has `tokensUsed`). **Revise Task B2's `recordUsage` signature to accept either a
   `ModelResponse` OR a flat `{ model, prompt_tokens, completion_tokens, cost }` object** — add a
   second lower-level export `insertUsageRow(deps, fields)` that `recordUsage(deps, resp)` calls
   internally, and have `compose-view/handler.ts` call `insertUsageRow` directly with
   `{ model, prompt_tokens: 0, completion_tokens: tokensUsed, cost: 0 }` (cost `0` here is honest —
   `composeSpec`/`ComposeViewResponse` does not surface a `total_cost` today; FR-AUC-001 already
   allows `cost` default `0` "when the provider does not report cost" — compose-view's response
   shape simply never threads cost through, a pre-existing gap this plan does not expand scope to
   fix). Amend Task B2 accordingly (see the revised `usage.ts` export list below).
4. `RateGuard`'s Gate 4 (already present, unconditional check-before-composeSpec) needs **no
   structural edit** — same as agent-chat's Gate 3.

**Revised `_shared/usage.ts` export (supersedes B2's `recordUsage`-only version):**
```ts
export interface UsageFields { model: string; prompt_tokens: number; completion_tokens: number; cost: number }
export async function insertUsageRow(deps: UsageDeps, fields: UsageFields): Promise<void> { /* the insert body from B2, using clampUsageValue on each field */ }
export async function recordUsage(deps: UsageDeps, resp: ModelResponse): Promise<void> {
  return insertUsageRow(deps, {
    model: resp.model,
    prompt_tokens: clampUsageValue(resp.usage?.prompt_tokens),
    completion_tokens: clampUsageValue(resp.usage?.completion_tokens),
    cost: clampUsageValue(resp.usage?.total_cost),
  });
}
```
(Task B2 is retroactively written to this two-function shape from the start — this note exists
because the compose-view integration surfaced the need; no rework, just implement B2 with both
exports from the first pass.)

**Verify (green):** `npx vitest run src/lib/agent/composeViewHandlerCredits.test.ts src/lib/agent/usage.test.ts` → all pass. `cd pmo-portal && npm run typecheck` → zero errors.

### Task B10 — Wire `compose-view/index.ts` — FR-AUC-015/017
**File:** `supabase/functions/compose-view/index.ts` (EDIT)
Same pattern as Task B7: read `AGENT_CREDITS_ENFORCED`, construct `createCreditRateGuard({ supabase:
callerClient })`, pass as `rateGuard` (replacing the `// rateGuard: undefined (AS-OD-002 default —
disabled in v1)` comment line) and `usage: { supabase: callerClient }` unconditionally, in the
`composeViewHandler(body, {...})` call. Import `createCreditRateGuard` from `'../_shared/creditRateGuard.ts'`.

**Verify:** `cd pmo-portal && npm run typecheck` → zero errors.

---

## PHASE C — Panel UX (composer disable on out-of-credits)

### Task C1 — New `RunPhase` value + hook wiring failing test (RED) — AC-AUC-019 (hook half)
**File:** `pmo-portal/src/hooks/useAssistantPanel.test.ts` (existing file — confirm it exists;
if not, add assertions to the nearest existing hook test file following its established pattern)
Add: drive the hook's SSE drain with a `status` event `{ error: 'RATE_LIMITED', retryAfterSeconds: 0
}`; assert `phase` becomes a new distinct value (see Task C2) — **not** `'error'` — so the panel can
render the out-of-credits UI instead of the generic `ErrorCard`. Also assert a `RATE_LIMITED` event
with `retryAfterSeconds > 0` (a hypothetical future throttle case) still falls into the existing
generic `'error'` phase (FR-AUC-013's convention: only `retryAfterSeconds <= 0` means out-of-credits).

**Verify (fails):** `npx vitest run src/hooks/useAssistantPanel.test.ts -t 'RATE_LIMITED'` → fails (no distinction exists yet, both go to `'error'`).

### Task C2 — `useAssistantPanel.ts` — new phase + branch (GREEN for C1) — FR-AUC-016
**File:** `pmo-portal/src/hooks/useAssistantPanel.ts` (EDIT)
1. `export type RunPhase = 'idle' | 'running' | 'needs-approval' | 'error' | 'out-of-credits';`
2. In the `status`/`errored` branch (the `if (payload?.status === 'errored') { ... }` block, current
   lines ~169-180), before the existing `TURN_CAP` check, add:
   ```ts
   if (payload?.status === 'errored') {
     setPhase('idle');
     const errPayload = ev.payload as { status: string; error?: string; retryAfterSeconds?: number } | undefined;
     if (errPayload?.error === 'RATE_LIMITED' && (errPayload.retryAfterSeconds ?? 0) <= 0) {
       // FR-AUC-013 convention: retryAfterSeconds<=0 on RATE_LIMITED means out-of-credits.
       setPhase('out-of-credits');
       continue; // no transcript entry — the composer itself carries the message (FR-AUC-016)
     }
     if (payload.error === 'TURN_CAP') {
       setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
     } else {
       setTranscript((prev) => [...prev, { key: makeKey(), event: ev }]);
       setPhase('error');
     }
     continue;
   }
   ```
   Note the reassignment: `setPhase('idle')` at the top of the original block is overwritten by
   `setPhase('out-of-credits')` inside the new branch — same pattern the existing code already uses
   (`setPhase('idle')` then conditionally `setPhase('error')`).

**Verify (green):** `npx vitest run src/hooks/useAssistantPanel.test.ts` → the new assertions pass; re-run the full hook test file to confirm no regression on the existing `'error'`/`TURN_CAP` cases.

### Task C3 — `AssistantPanel.credits.test.tsx` failing test (RED) — AC-AUC-019
**File:** `pmo-portal/src/components/panel/AssistantPanel.credits.test.tsx` (NEW)
Render `<AssistantPanel />` inside the same test harness `AssistantPanel.test.tsx` uses (mocked
`AgentRuntimeContext` — copy its provider-wrapping setup). Drive the mocked runtime to emit a
`status` event `{ error: 'RATE_LIMITED', retryAfterSeconds: 0 }` on send. Assert:
- The composer's `<textarea>` has `disabled` (or `aria-disabled="true"`) — reuse `Composer`'s
  existing `disabled={running}` prop by threading a new `outOfCredits` boolean into it (Task C4).
- A `role="status"`/`aria-live` region renders the text "You've used up your assistant credits for
  now — contact your admin to request more." (verbatim per the spec's Error Handling table).
Titled `AC-AUC-019 composer disables and shows out-of-credits message`.

**Verify (fails):** `npx vitest run src/components/panel/AssistantPanel.credits.test.tsx` → fails (no such UI branch yet).

### Task C4 — `AssistantPanel.tsx` + `Composer.tsx` — out-of-credits render (GREEN for C3) — FR-AUC-016, NFR-AUC-A11Y-001/002
**Files:** `pmo-portal/src/components/panel/AssistantPanel.tsx` (EDIT), `pmo-portal/src/components/panel/Composer.tsx` (EDIT)
1. **`Composer.tsx`:** add a new prop `disabled?: boolean` (distinct from `running` — `running` shows
   the Stop button in place of Send; `disabled` on top of that additionally hard-disables the
   textarea+Send regardless of `running`/value). Apply `disabled={running || disabled}` to the
   `<textarea>` and gate the Send button's `disabled` the same way. This is additive — existing
   `running`-only callers (no `disabled` passed) are unaffected (`undefined || false` = `false`).
2. **`AssistantPanel.tsx`:** add an `OutOfCreditsCard` (new small component, same file, styled like
   the existing `ErrorCard`):
   ```tsx
   const OutOfCreditsCard: React.FC = () => (
     <div
       role="status"
       aria-live="polite"
       className="mx-4 my-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
     >
       <p className="font-medium text-foreground">
         You&apos;ve used up your assistant credits for now — contact your admin to request more.
       </p>
     </div>
   );
   ```
   Render it where `{phase === 'error' && <ErrorCard onRetry={handleRetry} />}` currently sits, as a
   sibling conditional: `{phase === 'out-of-credits' && <OutOfCreditsCard />}`. Pass
   `disabled={phase === 'out-of-credits'}` to the existing `<Composer .../>` element.

**Verify (green):** `npx vitest run src/components/panel/AssistantPanel.credits.test.tsx` → pass. Re-run `npx vitest run src/components/panel/AssistantPanel.test.tsx src/components/panel/AssistantPanel.mobile.test.tsx` → no regression (the new prop/branch are additive).

---

## PHASE D — Full gate

### Task D1 — FULL verify + integration gate (binding pre-PR)
Run, from `pmo-portal/`, in order:
1. `npm run verify` (= `typecheck && lint:ci && test && build`) — the WHOLE suite, never just
   touched files (a shared-component edit like `Composer.tsx` can break other renders elsewhere).
2. From repo root: `supabase db reset && supabase test db` — all pgTAP incl. `0094/0095/0096` green
   alongside the full existing suite (`0090`-`0093` and everything before).
3. No new curated Playwright spec required (ADR-0010 "lowest sufficient layer" — spec's own
   Acceptance Criteria preamble judges this feature adequately covered at the unit layer). Run the
   existing agent panel e2e journeys to confirm no regression: `npx playwright test
   e2e/AC-AR-013*.spec.ts e2e/AC-CV-015*.spec.ts` (per MEMORY: full-serial + dedicated fixtures).
4. **Rendered Discover pass** on a clean build (`npm run build && npm run preview`): render the
   panel's out-of-credits composer-disabled state (drive it via a seeded zero-balance user, or a
   temporary dev-only override) — MEMORY: render-before-promote; stub unit tests are not the
   rendered pass.

**Only after all four are green** does the issue go to the review battery (3-lens + rendered Discover
+ BDD) → PR to `dev`. Never open the PR before the full battery is green locally (MEMORY:
pr-after-review-battery). Security-auditor runs at **full depth** on migration `0047` + both
`RateGuard` wiring sites (`agent-chat/index.ts`, `compose-view/index.ts`) per the spec's own Depth
note — this is the family's first Admin-only INSERT RLS policy and a new DoS/cost-exhaustion threat
model.

---

## 4. Type/signature consistency (guard across tasks)

- `clampUsageValue(x: unknown): number` — identical signature in `_shared/usage.ts` (B2), consumed by
  both `recordUsage`/`insertUsageRow` (B2/B9) and `creditRateGuard.ts`'s `computeBalance` (B4).
- `RateGuard.check(userId: string): Promise<{ exceeded: boolean; retryAfterSeconds: number }>` —
  OBS-AUC-001, reused verbatim from both `agent-chat/handler.ts` and `compose-view/handler.ts`'s
  existing interfaces; `createCreditRateGuard(...)` (B4) returns an object satisfying this shape for
  both call sites (B7/B10), never a different shape per edge fn.
- `HandlerDeps.usage?: { supabase: HandlerSupabaseLike }` (agent-chat, B5) and `HandlerDeps.usage?: {
  supabase: SupabaseLike }` (compose-view, B9) — same field name/shape pattern, deliberately
  independent of `persistence` (never gated together, AC-AUC-018).
- `RunPhase` = `'idle' | 'running' | 'needs-approval' | 'error' | 'out-of-credits'` — identical union
  in `useAssistantPanel.ts` (C2) and consumed by `AssistantPanel.tsx`'s `phase === 'out-of-credits'`
  branch (C4); `Composer`'s new `disabled?: boolean` prop threaded from that same phase check.
- `agent_usage.run_id` is `uuid | null` end-to-end: migration (`references agent_runs(id) on delete
  set null`, nullable), `UsageDeps.runId: string | null` (B2), the two call sites' `persist ? runId :
  null` / `req.runId ?? null` (B5), and compose-view's constant `null` (B9 — compose-view has no
  `agent_runs` row at all, OBS/FR-AUC-004's "no run row exists yet" case).

## 5. Scaling / risk notes (Performance + Architecture lenses)

- **Balance computation is two indexed sums per preflight check** (NFR-AUC-PERF-001): `agent_usage
  (owner_id, created_at)` and an implicit `credits(owner_id)` scan (RLS predicate) — bounded, not a
  full-table scan, but note the `.limit(10_000)` in `computeBalance` (B4) is a defensive cap, not a
  correctness requirement; if any single user's row count could plausibly exceed 10k before this
  ships (unlikely for v1 single-tenant), flag for the reviewer to reconsider a server-side `SUM()`
  RPC instead of a client-side reduce — deferred as YAGNI per the spec's own v1 posture.
- **Concurrent-request race (NFR-AUC-PERF-002)** — accepted v1 tradeoff, already recorded in the
  spec; this plan does not add a `SELECT ... FOR UPDATE` or advisory lock. Bounded by
  `MAX_TOOL_ROUNDS`.
- **Two new call sites per edge fn, not four** — usage recording hooks the single per-round
  `modelClient.create()` resolution (2 sites in agent-chat, 1 in compose-view), not each of the 4
  branches that read `resp.usage` for the SSE `completed` event — avoiding duplicate inserts per
  round (FR-AUC-002's "once per model API call" grain would otherwise be violated by hooking each
  branch separately).
- **`credits_insert`'s Admin-only RLS is the family's first role-based INSERT branch** — flagged in
  the spec's Depth note; this plan does not add an admin UI (Out of Scope), so the only path to
  insert a `credits` row in v1 is direct SQL/seed data by an operator with DB access, run as the
  table owner or under an Admin JWT — no new client-facing attack surface is introduced beyond the
  RLS policy itself.
- **Duplicate-logic avoidance:** `creditRateGuard.ts` reuses `clampUsageValue` from `usage.ts` rather
  than re-implementing the clamp (NFR-AUC-SEC-004's "single site" instruction is honored — the clamp
  logic lives in exactly one function, imported by both the write path and the balance-read path,
  even though the balance-read clamp is defense-in-depth per NFR-AUC-SEC-004's note that read-time
  values are already clamped at write time).

## 6. Open questions for the Director

1. **`AGENT_CREDITS_ENFORCED` default — confirmed OFF** (§1 above) per the spec's own recommendation
   and mirroring `AGENT_PERSISTENCE`'s precedent of a safe-default env toggle. Flag for the Director
   to confirm this is acceptable (vs. defaulting ON with a required seed-grant runbook step) before
   build — the spec explicitly left this open.
2. **compose-view's `cost` field is always `0` in v1** (Task B9) — `ComposeViewResponse`/`composeSpec`
   does not surface a `total_cost` today (only `tokensUsed`), so compose-view's `agent_usage` rows
   will always have `cost: 0` even though `prompt_tokens`/`completion_tokens` could in principle be
   derived from `tokensUsed`. This plan maps `tokensUsed → completion_tokens` (a coarse proxy) and
   leaves `cost` at the FR-AUC-001-sanctioned default `0` ("or 0 when the provider does not report
   cost"). Flag for the Director/owner: is this proxy acceptable for v1, or should compose-view's
   `ComposeViewResponse` be extended to carry real prompt/completion/cost fields from
   `ModelResponse.usage` (a small `composeSpec.ts` change, out of this plan's current file-touch list
   — would need a follow-up task if the Director wants it now rather than deferred).
3. **`credits.owner_id` has no column default** (Task A4, per spec FR-AUC-006) — this is a
   deliberate divergence from every other agent-family table's `owner_id default auth.uid()`. Confirm
   this reading of the spec is correct (an Admin always supplies `owner_id` explicitly when granting
   to someone else) before the migration ships, since it is the one column-default asymmetry in this
   plan's schema.
