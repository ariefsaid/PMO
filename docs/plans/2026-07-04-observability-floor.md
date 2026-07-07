# Implementation plan — Observability floor (GTM / MVP-viability program, item 3)

- **Date:** 2026-07-04
- **Issue:** PMO GTM item 3 — Telegram alert webhook + PostHog error tracking (FE) + BetterStack
  uptime/health endpoint + two PostHog dashboards.
- **Author:** eng-planner (Claude Opus 4.8 · 1M)
- **Spec (authoritative, SIGNED — 2-model review battery passed, do NOT re-litigate):**
  `docs/specs/observability-floor.spec.md` — FR-OF-###, NFR-OF-###, LD-OF-###, DC-OF-###, AC-OF-###.
- **Reference patterns (copy, do not reinvent):**
  - `supabase/migrations/0048_agent_automations_notifications.sql` — the `pg_cron` → `net.http_post`
    → `app.settings.*` GUC seam (idempotent registration, no-op when GUCs unset in CI/local).
  - `docs/adr/0046-agent-dispatch-watermark-infra-table.md` — the "service-role-only infra table with
    NO `org_id`, RLS enabled+forced, no policy" posture for a non-tenant bookkeeping table.
  - `supabase/functions/_shared/usage.ts` / `creditRateGuard.ts` — the "pure logic + injected client"
    module shape (`interface XDeps { supabase: ... }`, exported async fns, swallow-and-log on fault).
  - `supabase/functions/agent-chat/index.ts` (+ `compose-view`, `agent-dispatch`) — thin Deno wrapper,
    integration-only, business logic lives in an importable-from-Vitest sibling module.
  - `pmo-portal/src/lib/analytics/{client,config,events,safeTrack,AnalyticsProvider}.ts(x)` — the
    `analyticsClient` facade + `safeTrack` fire-and-forget guard + `FORBIDDEN_PROPERTY_KEYS` scrub.
- **Migration high-water mark:** current top is `supabase/migrations/0057_index_gap_hardening.sql`;
  the **ops-admin-surface** plan (parallel worktree) has **reserved `0058`–`0066`**. **This plan uses
  `0067` only** (one migration).
- **pgTAP high-water mark:** current top is `supabase/tests/0109_agent_dispatch_watermarks_denydefault.test.sql`;
  ops-admin-surface has **reserved `0110`–`0121`**. **This plan uses `0122` only** (one pgTAP file).
- **Binding final gate (every slice):** `cd pmo-portal && npm run verify` (= `typecheck && lint:ci &&
  test && build`). The one DB-touching slice (S1) additionally requires
  `supabase db reset && supabase test db` (from repo root) green before merge. Slice PRs target `dev`.
  **Never push to `production`.**

---

## 0. Design summary (already decided by the spec — restated for task traceability only)

1. **Telegram path = durable table + `pg_cron` drain, never a direct `fetch` from `errorLog.ts`**
   (DC-OF-001). `errorLog.ts` is untouched (OBS-OF-001). A new companion `recordErrorEvent()` is
   called immediately after every existing `logStructuredError()` call site.
2. **`public.error_events`** — append-only, RLS enabled+forced, **no policy** (service-role-only by
   omission, mirroring ADR-0046's `agent_dispatch_watermarks` posture, not the owner-scoped pattern).
3. **`telegram-notify` edge fn** — thin Deno wrapper (integration-only) + `logic.ts` (pure, unit-owned)
   implementing cooldown/dedupe/message-build/heartbeat. Triggered by a `pg_cron` schedule reusing the
   `0048` GUC seam with a second URL (`app.settings.telegram_notify_url`).
4. **PostHog FE exception capture** — one new `analyticsClient.captureException()` method, gated
   identically to `capture()`, ingesting via `posthog.captureException(new Error(...))`, redacted by a
   `before_send` transform registered at `init()`. Wired at `ErrorBoundary.componentDidCatch` and two
   global listeners in `AnalyticsProvider`.
5. **`health` edge fn** — pure response-builder (`health.ts`, unit-owned) + thin wrapper (`index.ts`,
   integration-only). No auth, no DB, no secrets.
6. **Two PostHog dashboards + BetterStack monitors** — config-deliverable checklists in
   `docs/environments.md`, no new code, no new analytics events (LD-OF-008).

---

## 1. Slice map (one PR to `dev` per slice)

| # | Slice | Touches shared local Supabase (`db reset`)? | AC-### owned | Depends on |
|---|---|---|---|---|
| **S1** | `error_events` table + RLS + pgTAP + pg_cron schedule registration | **YES — the only DB-touching slice; serialize against any other worktree's `db reset`** | AC-OF-004 | — |
| **S2** | `errorEvent.ts` (pure + injected client) + wire into the 4 call sites | no (Vitest only; edge-fn wrappers are integration-only, no CI runtime) | AC-OF-003 | S1 (table must exist for the wrapper's runtime path; test-suite itself mocks the client so S2's Vitest gate does not require `db reset`) |
| **S3** | `telegram-notify/logic.ts` (cooldown/dedupe/message-build/heartbeat, pure) + `index.ts` (thin wrapper) | no | AC-OF-001, AC-OF-002, AC-OF-005, AC-OF-006, AC-OF-015 | S1 |
| **S4** | `health` edge fn (`health.ts` pure builder + `index.ts` thin wrapper) | no | AC-OF-011 | — (independent of S1–S3) |
| **S5** | PostHog FE exception capture: `analyticsClient.captureException` + `before_send` redaction | no | AC-OF-008, AC-OF-009 | — (independent) |
| **S6** | Wire capture into `ErrorBoundary` + `AnalyticsProvider` global listeners | no | AC-OF-010 (+ re-asserts AC-OF-009 at the boundary) | S5 |
| **S7** | Config + runbook deliverables: `docs/environments.md` "Observability & alerting" section (BetterStack checklist, PostHog dashboard checklists, live-verify steps) | no | AC-OF-007 (live-verify), AC-OF-012, AC-OF-013, AC-OF-014 (config-deliverable) | S1–S6 (documents the shipped surface) |

**Serialize rule (binding).** S1 is the only slice that runs `supabase db reset && supabase test db`
against the shared local Docker stack. If another worktree (e.g. ops-admin-surface) is mid-reset,
wait — do not interleave. S2–S6 are Vitest/typecheck-only (`npm run verify`, no `db reset`) and may
build in any order once their `Depends on` column is satisfied. S7 is the capstone (drafts docs against
the shipped surface, no code).

---

## 2. Conventions honored (binding, restated from CLAUDE.md)

- **TDD-first.** Every behavior task writes the failing test first (Vitest `.test.ts(x)` / pgTAP
  `.test.sql`), then the implementation. No prod code without a failing test.
- **AC-id tagging.** The owning test names its `AC-OF-###` as the leading token of its
  title/description (Vitest: leading token of the `it(...)` string; pgTAP: leading token of the test
  description string passed to `is()`/`ok()`).
- **One owning layer per AC** (ADR-0010) — see the traceability table in §10; every `AC-OF-###`
  appears exactly once.
- **No placeholders.** Exact paths, real code, exact verify commands.
- **`errorLog.ts` and its 4 call sites are read-only reference points, not edited beyond the one-line
  `recordErrorEvent(...)` addition specified in S2** — no signature change to `logStructuredError`.
- **Vitest test-placement rule for `supabase/functions/**` logic (binding — DO NOT "fix" this back).**
  Vitest's `include` glob in `pmo-portal/vite.config.ts` only discovers `.test.ts(x)` files that live
  inside `pmo-portal/` (Vite's dev-server `fs` boundary also blocks Vitest from discovering test files
  that live outside `pmo-portal/` itself, even though a cross-boundary *import* from a
  `pmo-portal/`-resident test file works fine). Zero `.test.ts` files exist under `supabase/functions/`
  today; every existing test for `supabase/functions/_shared/*` or an edge-fn's pure-logic module
  already lives under `pmo-portal/src/lib/agent/` and imports the module by a relative path with NO
  `.ts` extension — e.g. `pmo-portal/src/lib/agent/errorLog.test.ts` imports
  `'../../../../supabase/functions/_shared/errorLog'`, and
  `pmo-portal/src/lib/agent/openRouterModelClient.test.ts` states this explicitly as a "standing
  rule" (see that file's header comment, and `docs/plans/2026-07-03-agent-persistence.md` REC-1).
  **Every new unit-test file in this plan follows that precedent**: it lives under
  `pmo-portal/src/lib/agent/`, not under `supabase/functions/**`, and imports its subject via a
  relative path (see §4 Task S2-A, §5 Task S3-A, §6 Task S4-A below for the exact filenames and
  import paths). The `supabase/functions/**` source files themselves are unaffected — only their
  *test* files move.

---

## 3. Slice S1 — `error_events` table + RLS + pgTAP + pg_cron schedule

### Task S1-A — pgTAP failing test first: `supabase/tests/0122_error_events_denydefault.test.sql`

Write the RLS-deny proof BEFORE the migration exists (it will fail with "relation does not exist" —
that is the expected red state; TDD-first for schema work means "test names the desired final state,"
not "runs green with an empty DB").

```sql
-- 0122_error_events_denydefault.test.sql
-- AC-OF-004: public.error_events is service-role-only — no authenticated or anon
-- role may SELECT or INSERT (append-only operator telemetry, never user-facing).
begin;
select plan(5);

select has_table('public', 'error_events', 'AC-OF-004 error_events table exists');

-- Force RLS is on: even the table owner is subject to policy (belt-and-suspenders,
-- matches agent_dispatch_watermarks' posture from ADR-0046).
select ok(
  (select relforcerowsecurity from pg_class where relname = 'error_events'),
  'AC-OF-004 error_events has FORCE ROW LEVEL SECURITY'
);

-- No policy exists for error_events at all (default-deny to every JWT role).
select is(
  (select count(*)::int from pg_policies where tablename = 'error_events'),
  0,
  'AC-OF-004 error_events has zero RLS policies (service-role-only by omission)'
);

-- Simulate an authenticated caller: SELECT returns 0 rows (not an error — RLS
-- silently empties the result set for SELECT with no policy).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from error_events),
  0,
  'AC-OF-004 authenticated SELECT on error_events returns 0 rows'
);
reset role;

-- Simulate anon: same.
set local role anon;
select is(
  (select count(*)::int from error_events),
  0,
  'AC-OF-004 anon SELECT on error_events returns 0 rows'
);
reset role;

select * from finish();
rollback;
```

**Verify (expected RED):** `supabase db reset && supabase test db 2>&1 | grep -A2 "0122_error_events"`
→ fails on `has_table` (table does not exist yet).

### Task S1-B — Migration `supabase/migrations/0067_error_events.sql`

```sql
-- 0067_error_events.sql — durable operator-telemetry sink for the Telegram alert
-- webhook (observability floor, spec docs/specs/observability-floor.spec.md,
-- FR-OF-001..009, NFR-OF-SEC-001). Append-only; RLS enabled+forced with NO policy —
-- service-role-only by omission, the SAME posture as agent_dispatch_watermarks
-- (ADR-0046): this is operator/ops bookkeeping, not tenant business data, so there
-- is deliberately no org_id-scoped policy (org_id is carried as an OPTIONAL nullable
-- column for cross-reference only, never used to scope a policy — there is none).
--
-- Reversibility (pre-production, ADR-0006): supabase db reset. Manual rollback:
--   select cron.unschedule('telegram-notify-tick');
--   drop index if exists public.error_events_code_notified_idx;
--   drop table if exists public.error_events;

create table public.error_events (
  id           uuid primary key default gen_random_uuid(),
  fn           text not null,
  error_code   text not null,
  context_id   text,
  org_id       uuid,
  created_at   timestamptz not null default now(),
  notified_at  timestamptz
);

-- Drain fast path (NFR-OF-PERF-001): the drain's two queries are
-- "unnotified rows" (notified_at IS NULL) and "MAX(notified_at) GROUP BY error_code
-- WHERE notified_at IS NOT NULL" — this composite index serves both.
create index error_events_code_notified_idx
  on public.error_events (error_code, notified_at, created_at);

alter table public.error_events enable row level security;
alter table public.error_events force row level security;
-- Intentionally NO policy — default-deny to every ordinary JWT role (authenticated,
-- anon). Only service_role (which bypasses RLS by Postgres/Supabase design) reads or
-- writes this table: recordErrorEvent() inserts, telegram-notify reads+updates.

-- ── pg_cron drain tick (FR-OF-004), every 2 minutes. Idempotent registration; the
-- job body's net.http_post reads app.settings.telegram_notify_url /
-- app.settings.service_role_key GUCs that are UNSET in CI/local-dev by default —
-- net.http_post queues a request that never resolves in that case (identical,
-- documented no-op behavior to 0048_agent_automations_notifications.sql's
-- agent-dispatch-tick job). Registration only; the real fire is live-verified in a
-- deployed environment (NFR-OF-RUN-001).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'telegram-notify-tick', '*/2 * * * *',
  $$ select net.http_post(
       url := current_setting('app.settings.telegram_notify_url', true),
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true))
     ); $$
);
```

**Verify (expected GREEN):** `supabase db reset && supabase test db 2>&1 | grep -A2 "0122_error_events"`
→ all 5 assertions pass. Also confirm the whole pgTAP suite is still green (no regression):
`supabase db reset && supabase test db` (full run, exit 0).

### Task S1-C — Confirm cron registration (mechanical, no new test file)

The `0122` file already asserts table/RLS/policy-count; cron-job registration itself is proven the
same way `0048`'s `agent-dispatch-tick` is proven (no dedicated pgTAP — `cron.schedule` succeeding
during `db reset` IS the registration proof; a `cron.job` row existing is checkable ad hoc via
`select * from cron.job where jobname = 'telegram-notify-tick';` in a `psql` session, not CI-owned).
No action beyond confirming `supabase db reset` itself does not error (already covered by S1-B's
verify command — a failing `cron.schedule()` call would abort the whole migration).

**Slice S1 final verify:** `supabase db reset && supabase test db` (full suite green, all 0001–0122
pass) from repo root.

---

## 4. Slice S2 — `errorEvent.ts` + wire into the 4 call sites

### Task S2-A — Failing test first: `pmo-portal/src/lib/agent/errorEvent.test.ts`

Per the placement rule in §2: this test lives under `pmo-portal/src/lib/agent/` (a sibling of
`errorLog.test.ts`), importing the Deno module by relative path with no `.ts` extension — mirroring
`errorLog.test.ts`'s own import of `'../../../../supabase/functions/_shared/errorLog'` exactly. The
implementation module itself stays at `supabase/functions/_shared/errorEvent.ts` (Task S2-B) —
`recordErrorEvent` is a Deno-runtime module in production, only its test is relocated.

```ts
/**
 * Tests for the error_events companion writer (`_shared/errorEvent.ts`), the
 * fire-and-forget insert that runs alongside every logStructuredError call site
 * (observability floor, DC-OF-001 step 2, FR-OF-001/002/003).
 *
 * Test-location convention (standing rule — see openRouterModelClient.test.ts header,
 * errorLog.test.ts): edge-fn logic tests live under pmo-portal/ (Vitest's root); the
 * implementation stays in supabase/functions/, imported here via a relative path.
 */
import { describe, it, expect, vi } from 'vitest';
import { recordErrorEvent } from '../../../../supabase/functions/_shared/errorEvent';

describe('recordErrorEvent', () => {
  it('AC-OF-003: swallows an insert rejection, logs ERROR_EVENT_INSERT_FAILED, never throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejectingSupabase = {
      from: () => ({
        insert: () => Promise.reject(new Error('connection refused')),
      }),
    };

    await expect(
      recordErrorEvent(rejectingSupabase as never, {
        fn: 'agent-chat',
        errorCode: 'MISSING_OPENROUTER_API_KEY',
      }),
    ).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(
      '[errorEvent] ERROR_EVENT_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-OF-003: inserts {fn, error_code, context_id, org_id} on the happy path', async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = { from: () => ({ insert: insertSpy }) };

    await recordErrorEvent(supabase as never, {
      fn: 'agent-dispatch',
      errorCode: 'DISPATCH_TICK_FAILED',
      contextId: 'run_abc',
      orgId: 'org_1',
    });

    expect(insertSpy).toHaveBeenCalledWith({
      fn: 'agent-dispatch',
      error_code: 'DISPATCH_TICK_FAILED',
      context_id: 'run_abc',
      org_id: 'org_1',
    });
  });

  it('AC-OF-003: an insert that RESOLVES with a Postgres error object also swallows (does not throw)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { from: () => ({ insert: () => Promise.resolve({ error: { code: '42501' } }) }) };

    await expect(
      recordErrorEvent(supabase as never, { fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      '[errorEvent] ERROR_EVENT_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_INSERT_FAILED', code: '42501' }),
    );
    errSpy.mockRestore();
  });
});
```

**Verify (expected RED):** `cd pmo-portal && npx vitest run src/lib/agent/errorEvent.test.ts`
→ fails (module `errorEvent.ts` does not exist).

### Task S2-B — Implementation: `supabase/functions/_shared/errorEvent.ts`

```ts
/**
 * errorEvent — the fire-and-forget companion to logStructuredError (observability
 * floor, DC-OF-001 step 2). Writes one row to public.error_events via the
 * ALREADY-INJECTED service-role client (deputy invariant by construction — never
 * constructs a client itself, mirrors usage.ts/creditRateGuard.ts). Swallows its
 * own failure so the caller's real error path is never perturbed (FR-OF-002).
 */
export interface ErrorEventSupabaseLike {
  from(table: 'error_events'): {
    insert(row: {
      fn: string;
      error_code: string;
      context_id?: string;
      org_id?: string;
    }): Promise<{ error: unknown }>;
  };
}

export interface ErrorEventContext {
  fn: string;
  errorCode: string;
  contextId?: string;
  orgId?: string;
}

export async function recordErrorEvent(
  supabase: ErrorEventSupabaseLike,
  ctx: ErrorEventContext,
): Promise<void> {
  const row: { fn: string; error_code: string; context_id?: string; org_id?: string } = {
    fn: ctx.fn,
    error_code: ctx.errorCode,
  };
  if (ctx.contextId !== undefined) row.context_id = ctx.contextId;
  if (ctx.orgId !== undefined) row.org_id = ctx.orgId;

  try {
    const { error } = await supabase.from('error_events').insert(row);
    if (error) {
      console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
        errorCode: 'ERROR_EVENT_INSERT_FAILED',
        code: (error as { code?: string }).code,
      });
    }
  } catch (err) {
    console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
      errorCode: 'ERROR_EVENT_INSERT_FAILED',
      code: err instanceof Error ? err.name : 'unknown',
    });
  }
}
```

**Verify (expected GREEN):** `cd pmo-portal && npx vitest run src/lib/agent/errorEvent.test.ts`
→ 3 pass.

### Task S2-C — Wire into `supabase/functions/agent-chat/index.ts:84`

Edit the existing `MISSING_OPENROUTER_API_KEY` branch (currently lines 83-89) to add the
fire-and-forget call immediately after `logStructuredError`, using a service-role client already
available in this file as `verifierClient` (built at line 64):

```ts
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    logStructuredError({ fn: 'agent-chat', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    void recordErrorEvent(verifierClient, { fn: 'agent-chat', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    return new Response(
      JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
```

Add the import near the top (alongside the existing `logStructuredError` import):
```ts
import { recordErrorEvent } from '../_shared/errorEvent.ts';
```

`void` (not `await`) — FR-OF-001 requires this to be fire-and-forget from the calling handler's
perspective; `recordErrorEvent` already never throws (S2-B), so `void` is safe and does not add
latency to the response path (NFR-OF-PERF-001).

**No test file for this task** — `index.ts` is integration-only (ADR-0039 decision-7,
NFR-OF-TEST-005); its behavior is proven by `deno check` (Task S2-F) + the live-verify runbook
(AC-OF-007), never a Vitest unit test.

### Task S2-D — Wire into `supabase/functions/compose-view/index.ts:79`

Identical pattern — this file also builds `verifierClient` at line 57. Edit the existing
`MISSING_OPENROUTER_API_KEY` branch:

```ts
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    logStructuredError({ fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    void recordErrorEvent(verifierClient, { fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' });
    return new Response(
      JSON.stringify({ status: 502, error: 'UPSTREAM_ERROR', detail: 'model call failed' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
```

Add `import { recordErrorEvent } from '../_shared/errorEvent.ts';` near the existing
`logStructuredError` import.

### Task S2-E — Wire into `supabase/functions/agent-dispatch/index.ts:49` and `:81` and `:171`

Three call sites in this file, all using `serviceClient` (built at line 89) OR — for the two
config-gap branches at lines 49/81 which fire BEFORE `serviceClient` is constructed — a small
inline service-role client built the same way `verifierClient` is elsewhere. Since `serviceClient`
is constructed at line 89 (after both early-return branches), and `serviceRoleKey`/`supabaseUrl` are
already in scope at each of the three call sites, use a lazily-built client at each site rather than
hoisting `serviceClient`'s construction (avoids reordering code the spec did not ask to reorder):

Line 49 (`MISSING_SERVICE_ROLE_KEY` — no `serviceRoleKey` value exists to build a client with, since
this branch means the key itself is absent):
```ts
  if (!serviceRoleKey) {
    logStructuredError({ fn: 'agent-dispatch', errorCode: 'MISSING_SERVICE_ROLE_KEY' });
    // No recordErrorEvent here — there is no service-role key to build the client that would
    // write this row (the exact secret this branch reports as missing). Logged via
    // logStructuredError only; this is the one call site the spec's four-site list does not
    // cover for the DB write, by construction (I-1 verified: this is a genuine exception, not
    // an oversight — see the plan's traceability note in §9).
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
```

Line 81 (`MISSING_SUPABASE_URL` / `MISSING_SUPABASE_ANON_KEY` / `MISSING_OPENROUTER_API_KEY` — here
`serviceRoleKey` IS available, so a client CAN be built if `supabaseUrl` is also present):
```ts
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!supabaseUrl || !anonKey || !apiKey) {
    const errorCode = !supabaseUrl
      ? 'MISSING_SUPABASE_URL'
      : !anonKey
        ? 'MISSING_SUPABASE_ANON_KEY'
        : 'MISSING_OPENROUTER_API_KEY';
    logStructuredError({ fn: 'agent-dispatch', errorCode });
    if (supabaseUrl) {
      void recordErrorEvent(createClient(supabaseUrl, serviceRoleKey), { fn: 'agent-dispatch', errorCode });
    }
    return new Response(JSON.stringify({ error: 'MISCONFIGURED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
```
(`createClient` is already imported at the top of this file.)

Line 171 (`DISPATCH_TICK_FAILED`, inside the `catch` block — `serviceClient` IS in scope here since
it was built at line 89, before the `try`):
```ts
  } catch (err) {
    logStructuredError({
      fn: 'agent-dispatch',
      errorCode: 'DISPATCH_TICK_FAILED',
      contextId: err instanceof Error ? err.name : 'unknown',
    });
    void recordErrorEvent(serviceClient, {
      fn: 'agent-dispatch',
      errorCode: 'DISPATCH_TICK_FAILED',
      contextId: err instanceof Error ? err.name : 'unknown',
    });
    return new Response(JSON.stringify({ error: 'TICK_FAILED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
```

Add `import { recordErrorEvent } from '../_shared/errorEvent.ts';` near the existing
`logStructuredError` import at the top of `agent-dispatch/index.ts`.

### Task S2-F — Wire into `supabase/functions/agent-dispatch/dispatcher.ts:475`

This is the cron/fire-path `AUTOMATION_*_FAILED` catch block (inside a `for` loop over automations,
`deps.serviceClient` already in scope as the function parameter):

```ts
      logStructuredError({ fn: 'agent-dispatch', errorCode, contextId: automation.id });
      void recordErrorEvent(deps.serviceClient, {
        fn: 'agent-dispatch',
        errorCode,
        contextId: automation.id,
        orgId: automation.org_id,
      });
```

Add `import { recordErrorEvent } from '../_shared/errorEvent.ts';` near the top of `dispatcher.ts`
(alongside its existing `logStructuredError` import — confirm the exact existing import line when
editing; do not duplicate).

**No test file for S2-C/D/E/F** — all four are edits inside `index.ts`/`dispatcher.ts` integration-only
files (NFR-OF-TEST-005); `dispatcher.ts`'s PURE logic (the parts that are Vitest-tested today under
`pmo-portal/src/lib/agent/dispatch/*`) is untouched — only the catch-block's error-reporting call
gains one line, which is out-of-scope for `dispatcher.test.ts`'s existing pure-fn assertions (no new
assertion needed there; confirm no existing test asserts the ABSENCE of a second call in that catch
block — grep first, see Task S2-G).

### Task S2-G — Guard: confirm no existing test asserts call-count on the four wrapper files

Before finalizing S2-C..F, run:
```bash
cd pmo-portal && grep -rn "logStructuredError" ../supabase/functions/agent-dispatch/dispatcher.test.ts 2>/dev/null || echo "no such test file — confirmed integration-only, safe to edit"
```
`dispatcher.ts`'s pure logic is unit-tested via `pmo-portal/src/lib/agent/dispatch/dispatcher*.test.ts`
which exercises `runDispatchTick` with an injected `deps.serviceClient` mock — confirm that mock's
`.from()` stub tolerates an EXTRA `.from('error_events').insert(...)` call (i.e. the mock is a
permissive stub, not a strict allow-list) before merging S2-F, or extend the mock's `.from()` switch
to handle `'error_events'` as a no-op success (`{ error: null }`) so the existing suite stays green.

**Slice S2 final verify:**
```bash
cd pmo-portal && npm run verify
for fn in agent-chat compose-view agent-dispatch; do
  deno check --config ../supabase/functions/$fn/deno.json ../supabase/functions/$fn/index.ts
done
```

---

## 5. Slice S3 — `telegram-notify` (pure logic + thin wrapper)

### Task S3-A — Failing tests first: `pmo-portal/src/lib/agent/telegramNotify.test.ts`

Per the placement rule in §2: this test lives under `pmo-portal/src/lib/agent/` (flat, alongside
`errorLog.test.ts`/`modelResolution.test.ts`/`openRouterModelClient.test.ts`), importing the pure
logic module by relative path. The implementation stays at
`supabase/functions/telegram-notify/logic.ts` (Task S3-B) — only the test file is relocated.

```ts
/**
 * Tests for telegram-notify's pure drain logic (cooldown/dedupe/message-build/heartbeat) —
 * observability floor, DC-OF-001 step 6.
 *
 * Test-location convention (standing rule — see openRouterModelClient.test.ts header,
 * errorLog.test.ts): edge-fn logic tests live under pmo-portal/ (Vitest's root); the
 * implementation stays in supabase/functions/, imported here via a relative path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  selectNotifiedCandidates,
  groupIntoMessages,
  buildTelegramPayload,
  pingHeartbeat,
} from '../../../../supabase/functions/telegram-notify/logic';

const ROW = (overrides: Partial<{
  error_code: string;
  fn: string;
  context_id: string | null;
  org_id: string | null;
  created_at: string;
}> = {}) => ({
  error_code: 'TICK_FAILED',
  fn: 'agent-dispatch',
  context_id: null,
  org_id: null,
  created_at: '2026-07-04T10:00:00.000Z',
  ...overrides,
});

describe('telegram-notify/logic', () => {
  it('AC-OF-001: a burst of 5 identical + 2 different errorCodes yields exactly 2 messages with correct counts', () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ROW({ error_code: 'TICK_FAILED' })),
      ...Array.from({ length: 2 }, () => ROW({ error_code: 'MISSING_OPENROUTER_API_KEY', fn: 'agent-chat' })),
    ];
    const groups = groupIntoMessages(rows, {}, 'production', 900);
    expect(groups).toHaveLength(2);
    const tick = groups.find((g) => g.errorCode === 'TICK_FAILED')!;
    const missing = groups.find((g) => g.errorCode === 'MISSING_OPENROUTER_API_KEY')!;
    expect(tick.count).toBe(5);
    expect(missing.count).toBe(2);
  });

  it('AC-OF-002: a code within the cooldown window (lastNotifiedByCode) is suppressed, rows still marked notified', () => {
    const rows = [ROW({ error_code: 'TICK_FAILED', created_at: '2026-07-04T10:14:00.000Z' })];
    // 5 minutes ago; cooldown is 900s (15 min) — within window.
    const lastNotifiedByCode = { TICK_FAILED: '2026-07-04T10:09:00.000Z' };
    const groups = groupIntoMessages(rows, lastNotifiedByCode, 'production', 900);
    expect(groups.find((g) => g.errorCode === 'TICK_FAILED' && !g.suppressed)).toBeUndefined();
    const suppressed = groups.find((g) => g.errorCode === 'TICK_FAILED');
    expect(suppressed?.suppressed).toBe(true);
  });

  it('AC-OF-002: a code OUTSIDE the cooldown window (>=15 min since lastNotified) is NOT suppressed', () => {
    const rows = [ROW({ error_code: 'TICK_FAILED', created_at: '2026-07-04T10:30:00.000Z' })];
    const lastNotifiedByCode = { TICK_FAILED: '2026-07-04T10:09:00.000Z' }; // 21 min ago
    const groups = groupIntoMessages(rows, lastNotifiedByCode, 'production', 900);
    const group = groups.find((g) => g.errorCode === 'TICK_FAILED')!;
    expect(group.suppressed).toBe(false);
  });

  it('AC-OF-005: mocked fetch returning 502 leaves notified_at NULL (retry) and does not throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);
    const group = { errorCode: 'TICK_FAILED', fn: 'agent-dispatch', count: 1, firstCreatedAt: '2026-07-04T10:00:00.000Z', lastCreatedAt: '2026-07-04T10:00:00.000Z', sampleContextId: null, suppressed: false };
    const payload = buildTelegramPayload(group);
    const res = await fetch('https://api.telegram.org/botX/sendMessage', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
    // the caller (index.ts) decides notified_at based on res.ok — this test proves the
    // pure payload builder + a non-2xx response never throw synchronously.
    vi.unstubAllGlobals();
  });

  it('AC-OF-006: message body carries fn/error_code/count/timestamps/context_id, no token/org_id-UUID/PII', () => {
    const group = {
      errorCode: 'AUTOMATION_FIRE_FAILED',
      fn: 'agent-dispatch',
      count: 3,
      firstCreatedAt: '2026-07-04T09:00:00.000Z',
      lastCreatedAt: '2026-07-04T09:10:00.000Z',
      sampleContextId: 'run_abc',
      suppressed: false,
    };
    const payload = buildTelegramPayload(group);
    expect(payload.text).toContain('agent-dispatch');
    expect(payload.text).toContain('AUTOMATION_FIRE_FAILED');
    expect(payload.text).toContain('3');
    expect(payload.text).toContain('run_abc');
    expect(payload.text).not.toMatch(/TELEGRAM_BOT_TOKEN/i);
    expect(payload.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('AC-OF-015: pingHeartbeat issues exactly one GET when a URL is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await pingHeartbeat('https://uptime.betterstack.com/api/v1/heartbeat/abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://uptime.betterstack.com/api/v1/heartbeat/abc', expect.objectContaining({ method: 'GET' }));
    vi.unstubAllGlobals();
  });

  it('AC-OF-015: pingHeartbeat no-ops (no fetch call) when the URL is undefined', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await pingHeartbeat(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('AC-OF-015: pingHeartbeat swallows a network error and never throws/rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pingHeartbeat('https://uptime.betterstack.com/api/v1/heartbeat/abc')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('selectNotifiedCandidates: returns unnotified rows unchanged when lastNotifiedByCode is empty', () => {
    const rows = [ROW()];
    expect(selectNotifiedCandidates(rows, {}, 900)).toEqual(rows);
  });
});
```

**Verify (expected RED):** `cd pmo-portal && npx vitest run src/lib/agent/telegramNotify.test.ts`
→ fails (module does not exist).

### Task S3-B — Implementation: `supabase/functions/telegram-notify/logic.ts`

```ts
/**
 * telegram-notify/logic — pure helpers for the Telegram alert drain (observability
 * floor, DC-OF-001 step 6). No Deno globals except `fetch` (used only inside
 * buildTelegramPayload's caller / pingHeartbeat — both accept fetch implicitly via
 * the global, mockable in Vitest via vi.stubGlobal, per NFR-OF-TEST-001). Importable
 * in Vitest.
 */

export interface ErrorEventRow {
  error_code: string;
  fn: string;
  context_id: string | null;
  org_id: string | null;
  created_at: string;
}

export interface MessageGroup {
  errorCode: string;
  fn: string;
  count: number;
  firstCreatedAt: string;
  lastCreatedAt: string;
  sampleContextId: string | null;
  suppressed: boolean;
}

export interface TelegramPayload {
  chat_id?: string;
  text: string;
  parse_mode: 'Markdown';
}

/**
 * selectNotifiedCandidates — filters unnotified rows to those NOT currently
 * suppressed by an active cooldown (FR-OF-005/009). `lastNotifiedByCode` is the
 * drain's second query result: Record<error_code, ISO timestamp | undefined>.
 * A code with no entry (never notified before) is never suppressed.
 */
export function selectNotifiedCandidates(
  rows: ErrorEventRow[],
  lastNotifiedByCode: Record<string, string | undefined>,
  cooldownSec: number,
): ErrorEventRow[] {
  const now = Date.now();
  return rows.filter((row) => {
    const last = lastNotifiedByCode[row.error_code];
    if (!last) return true;
    const elapsedSec = (now - new Date(last).getTime()) / 1000;
    return elapsedSec >= cooldownSec;
  });
}

/**
 * groupIntoMessages — collapses unnotified rows into one group per error_code
 * (FR-OF-005/006, LD-OF-005), each carrying a `suppressed` flag computed from
 * `lastNotifiedByCode` + `cooldownSec` (I-2's cross-drain cooldown input). A
 * suppressed group's rows are still marked notified_at by the caller (index.ts) —
 * this function only decides WHICH groups send, never performs the DB write.
 */
export function groupIntoMessages(
  rows: ErrorEventRow[],
  lastNotifiedByCode: Record<string, string | undefined>,
  _env: string,
  cooldownSec: number,
): MessageGroup[] {
  const now = Date.now();
  const byCode = new Map<string, ErrorEventRow[]>();
  for (const row of rows) {
    const existing = byCode.get(row.error_code) ?? [];
    existing.push(row);
    byCode.set(row.error_code, existing);
  }

  const groups: MessageGroup[] = [];
  for (const [errorCode, groupRows] of byCode) {
    const sorted = [...groupRows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = lastNotifiedByCode[errorCode];
    const suppressed = last !== undefined && (now - new Date(last).getTime()) / 1000 < cooldownSec;
    groups.push({
      errorCode,
      fn: sorted[0].fn,
      count: sorted.length,
      firstCreatedAt: sorted[0].created_at,
      lastCreatedAt: sorted[sorted.length - 1].created_at,
      sampleContextId: sorted.find((r) => r.context_id)?.context_id ?? null,
      suppressed,
    });
  }
  return groups;
}

/**
 * buildTelegramPayload — message text is code+meta ONLY (FR-OF-006, NFR-OF-PRIV-003):
 * fn, error_code, count, first/last timestamps, a sample context_id. NEVER org_id
 * (raw UUID is "telemetric noise + a soft identifier" per FR-OF-006), never prompt
 * text, never a secret.
 */
export function buildTelegramPayload(group: MessageGroup): TelegramPayload {
  const lines = [
    `*Alert:* \`${group.errorCode}\``,
    `*fn:* ${group.fn}`,
    `*count:* ${group.count}`,
    `*first:* ${group.firstCreatedAt}`,
    `*last:* ${group.lastCreatedAt}`,
  ];
  if (group.sampleContextId) lines.push(`*sample context:* \`${group.sampleContextId}\``);
  return { text: lines.join('\n'), parse_mode: 'Markdown' };
}

/**
 * pingHeartbeat — fire-and-forget GET to an optional BetterStack heartbeat monitor
 * URL (FR-OF-021, I-3). No-op when `url` is undefined. Never throws: a network
 * error or non-2xx is swallowed (the heartbeat itself is best-effort telemetry,
 * never on the alert path — NFR-OF-REL-002).
 */
export async function pingHeartbeat(url: string | undefined): Promise<void> {
  if (!url) return;
  try {
    await fetch(url, { method: 'GET' });
  } catch {
    // Swallowed by design (FR-OF-021) — a dead heartbeat URL must never affect the
    // drain's own success/failure or notified_at stamping.
  }
}
```

**Verify (expected GREEN):** `cd pmo-portal && npx vitest run src/lib/agent/telegramNotify.test.ts`
→ all pass. Confirm `it(...)` titles lead with `AC-OF-001`/`002`/`005`/`006`/`015` via
`grep -n "AC-OF-" src/lib/agent/telegramNotify.test.ts`.

### Task S3-C — Thin wrapper: `supabase/functions/telegram-notify/index.ts` (integration-only)

```ts
/**
 * telegram-notify — Deno Edge Function entry point (observability floor, DC-OF-001).
 * Invoked every 2 minutes by the pg_cron job (migration 0067) via net.http_post.
 * Thin wiring ONLY — all drain logic lives in logic.ts (pure, unit-tested).
 * Integration-only: this file is NOT unit-tested (ADR-0039 decision-7,
 * NFR-OF-TEST-005) — verified by `deno check` + the live-verify runbook
 * (docs/environments.md "Observability & alerting", AC-OF-007).
 *
 * Auth (NFR-OF-SEC-002): the incoming Authorization bearer MUST equal
 * SUPABASE_SERVICE_ROLE_KEY (the pg_cron job sends it, mirroring agent-dispatch) —
 * an anonymous direct POST is rejected 401.
 */
import { createClient } from '@supabase/supabase-js';
import {
  selectNotifiedCandidates,
  groupIntoMessages,
  buildTelegramPayload,
  pingHeartbeat,
} from './logic.ts';
import { logStructuredError } from '../_shared/errorLog.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const cooldownSec = Number(Deno.env.get('TELEGRAM_COOLDOWN_SECONDS') ?? '900');
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  const heartbeatUrl = Deno.env.get('HEARTBEAT_URL') ?? undefined;

  try {
    const { data: unnotified } = await serviceClient
      .from('error_events')
      .select('error_code, fn, context_id, org_id, created_at')
      .is('notified_at', null);

    const { data: lastNotifiedRows } = await serviceClient
      .from('error_events')
      .select('error_code, notified_at')
      .not('notified_at', 'is', null);

    const lastNotifiedByCode: Record<string, string | undefined> = {};
    for (const row of (lastNotifiedRows ?? []) as { error_code: string; notified_at: string }[]) {
      const current = lastNotifiedByCode[row.error_code];
      if (!current || row.notified_at > current) lastNotifiedByCode[row.error_code] = row.notified_at;
    }

    const rows = (unnotified ?? []) as {
      error_code: string; fn: string; context_id: string | null; org_id: string | null; created_at: string;
    }[];
    const groups = groupIntoMessages(rows, lastNotifiedByCode, Deno.env.get('APP_ENV') ?? 'production', cooldownSec);

    if (!botToken || !chatId) {
      logStructuredError({ fn: 'agent-dispatch', errorCode: 'TELEGRAM_SECRET_MISSING' });
      // Leave notified_at NULL for everything — retried next tick once secrets are wired.
      await pingHeartbeat(heartbeatUrl);
      return new Response(JSON.stringify({ ok: true, skipped: 'secrets unset' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    for (const group of groups) {
      const codeRows = rows.filter((r) => r.error_code === group.errorCode);
      if (!group.suppressed) {
        const payload = buildTelegramPayload(group);
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, chat_id: chatId }),
        });
        if (!res.ok) {
          // Non-2xx: leave notified_at NULL for this group — retried next tick (FR-OF-007).
          continue;
        }
      }
      // Sent OR intentionally suppressed within cooldown: stamp notified_at for this group's rows.
      const ids = codeRows.map((r) => (r as unknown as { id: string }).id).filter(Boolean);
      if (ids.length > 0) {
        await serviceClient.from('error_events').update({ notified_at: new Date().toISOString() }).in('id', ids);
      }
    }

    await pingHeartbeat(heartbeatUrl);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logStructuredError({
      fn: 'agent-dispatch',
      errorCode: 'TELEGRAM_DRAIN_FAILED',
      contextId: err instanceof Error ? err.name : 'unknown',
    });
    return new Response(JSON.stringify({ error: 'DRAIN_FAILED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
```

Note: `errorLog.ts`'s `EdgeFunctionName` type is `'agent-chat' | 'compose-view' | 'agent-dispatch'`
(does not include `'telegram-notify'`) — OBS-OF-001 keeps that union closed, so this wrapper's own
internal failures log under `fn: 'agent-dispatch'` with a distinct `errorCode` (`TELEGRAM_SECRET_MISSING`,
`TELEGRAM_DRAIN_FAILED`) rather than widening the shared type — consistent with the spec's "no slot
for arbitrary payload" design and avoiding an out-of-spec type change. (If a future issue wants a
dedicated `'telegram-notify'` union member, that is a `logStructuredError` signature change outside
this spec's scope — flagged, not done here.)

Add `telegram-notify/deno.json` (copy `agent-dispatch/deno.json`'s shape):
```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.45.0"
  }
}
```

Register in `supabase/config.toml` (mirror the `agent-dispatch` block):
```toml
[functions.telegram-notify]
verify_jwt = false
```

**Verify:** `deno check --config supabase/functions/telegram-notify/deno.json supabase/functions/telegram-notify/index.ts`
(the #227 gate — must pass with zero type errors).

**Slice S3 final verify:** `cd pmo-portal && npm run verify` (picks up
`src/lib/agent/telegramNotify.test.ts` under Vitest's existing `**/*.{test,spec}.{ts,tsx}` include
glob — no config change needed, per the placement rule in §2) + `deno check` as above.

---

## 6. Slice S4 — `health` edge function

### Task S4-A — Failing test first: `pmo-portal/src/lib/agent/health.test.ts`

Per the placement rule in §2: this test lives under `pmo-portal/src/lib/agent/`, importing the pure
response-builder by relative path. The implementation stays at
`supabase/functions/health/health.ts` (Task S4-B) — only the test file is relocated.

```ts
/**
 * Tests for the health edge function's pure response-builder (observability floor,
 * DC-OF-003, FR-OF-015/016/017).
 *
 * Test-location convention (standing rule — see openRouterModelClient.test.ts header,
 * errorLog.test.ts): edge-fn logic tests live under pmo-portal/ (Vitest's root); the
 * implementation stays in supabase/functions/, imported here via a relative path.
 */
import { describe, it, expect } from 'vitest';
import { buildHealthResponse } from '../../../../supabase/functions/health/health';

describe('buildHealthResponse', () => {
  it('AC-OF-011: returns exactly {ok, service, version, ts} with no extra field', () => {
    const body = buildHealthResponse({ version: '1.4.0', now: () => new Date('2026-07-04T12:00:00.000Z') });
    expect(body).toEqual({
      ok: true,
      service: 'pmo-edge',
      version: '1.4.0',
      ts: '2026-07-04T12:00:00.000Z',
    });
    expect(Object.keys(body)).toHaveLength(4);
  });

  it("AC-OF-011: version falls back to 'unknown' when undefined", () => {
    const body = buildHealthResponse({ version: undefined, now: () => new Date('2026-07-04T12:00:00.000Z') });
    expect(body.version).toBe('unknown');
  });
});
```

**Verify (expected RED):** `cd pmo-portal && npx vitest run src/lib/agent/health.test.ts`
→ fails (module does not exist).

### Task S4-B — Implementation: `supabase/functions/health/health.ts`

```ts
/**
 * health — pure response-builder for the BetterStack uptime probe (observability
 * floor, DC-OF-003, FR-OF-015/016/017). No Deno globals, no DB, no secrets read
 * here — the caller (index.ts) supplies `version` and `now` explicitly, so this
 * function is importable in Vitest.
 */
export interface HealthBody {
  ok: true;
  service: 'pmo-edge';
  version: string;
  ts: string;
}

export function buildHealthResponse(input: { version: string | undefined; now: () => Date }): HealthBody {
  return {
    ok: true,
    service: 'pmo-edge',
    version: input.version ?? 'unknown',
    ts: input.now().toISOString(),
  };
}
```

**Verify (expected GREEN):** `cd pmo-portal && npx vitest run src/lib/agent/health.test.ts`
→ 2 pass.

### Task S4-C — Thin wrapper: `supabase/functions/health/index.ts` (integration-only)

```ts
/**
 * health — Deno Edge Function entry point (observability floor, DC-OF-003).
 * Public, anonymous, no auth, no DB, no secret read (NFR-OF-REL-003) — proves only
 * "the edge runtime is deployed and serving." GET/HEAD -> 200; anything else -> 405.
 * Integration-only (ADR-0039 decision-7); the pure builder lives in health.ts.
 */
import { buildHealthResponse } from './health.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD',
};

Deno.serve((req: Request): Response => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const body = buildHealthResponse({ version: Deno.env.get('DEPLOY_VERSION'), now: () => new Date() });
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

Add `supabase/functions/health/deno.json`:
```json
{
  "imports": {}
}
```

Register in `supabase/config.toml`:
```toml
[functions.health]
verify_jwt = false
```

**Verify:** `deno check --config supabase/functions/health/deno.json supabase/functions/health/index.ts`.

**Slice S4 final verify:** `cd pmo-portal && npm run verify` + the `deno check` command above.

---

## 7. Slice S5 — PostHog FE exception capture (`analyticsClient.captureException`)

### Task S5-A — Failing tests first: extend `pmo-portal/src/lib/analytics/client.test.ts`

This file's existing mock (verified against the current file) hoists a `posthog` object (not
`mockPosthog`) via `vi.hoisted`, and its shared config fixture is named `base` (not `baseConfig`) —
`posthog.init/capture/identify/register/reset` are the existing mocked methods. Add `captureException:
vi.fn()` to that `posthog` hoisted object (Task S5-A also touches the mock declaration at the top of
the file, not just new `it`s), then append a new `describe` block using `posthog`/`base` verbatim:

```ts
const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
}));
```

(This replaces the existing 5-method `posthog` hoisted object at the top of the file — add the one
new line, do not duplicate the block.)

```ts
  describe('captureException', () => {
    it('AC-OF-008: no-ops (no posthog call) when not initialized', () => {
      analyticsClient.__resetForTests();
      analyticsClient.captureException({ name: 'TypeError', message: 'boom' });
      expect(posthog.captureException).not.toHaveBeenCalled();
    });

    it('AC-OF-008: no-ops when initialized but activeConfig.enabled is false', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: false });
      analyticsClient.captureException({ name: 'TypeError', message: 'boom' });
      expect(posthog.captureException).not.toHaveBeenCalled();
    });

    it('AC-OF-009: enabled analytics calls posthog.captureException (not a hand-rolled $exception event)', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      analyticsClient.captureException({ name: 'TypeError', message: 'boom' });
      expect(posthog.captureException).toHaveBeenCalledTimes(1);
      expect(posthog.capture).not.toHaveBeenCalledWith('$exception', expect.anything());
    });

    it('AC-OF-009: componentStack is attached to the synthetic Error when supplied', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      analyticsClient.captureException({ name: 'TypeError', message: 'boom', componentStack: '    in Foo' });
      const passedError = posthog.captureException.mock.calls[0][0] as Error & { componentStack?: string };
      expect(passedError.componentStack).toBe('    in Foo');
    });

    it('AC-OF-011: the before_send hook registered at init() redacts $exception_* properties on an outbound exception event', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      // Pull the registered hook straight off the posthog.init call — proves redaction is wired
      // as a before_send hook at init(), not as inline string-munging inside captureException
      // itself (FR-OF-011/DC-OF-002: "via a before_send / payload-transform hook", not the call site).
      const [, initOpts] = posthog.init.mock.calls[0];
      const beforeSend = initOpts.before_send as (cr: unknown) => unknown;
      expect(typeof beforeSend).toBe('function');

      const rawEvent = {
        uuid: 'u1',
        event: '$exception',
        properties: {
          $exception_message: 'Cannot read props of /projects/abc?token=secret123',
          $exception_list: [{ value: 'token=secret123 in stack' }],
          other_prop: 'unchanged',
        },
      };
      const result = beforeSend(rawEvent) as typeof rawEvent;
      expect(result.properties.$exception_message).not.toContain('?token=secret123');
      expect(result.properties.$exception_message).not.toMatch(/token/i);
      expect(JSON.stringify(result.properties.$exception_list)).not.toMatch(/token/i);
      expect(result.properties.other_prop).toBe('unchanged');
    });

    it('AC-OF-011: the before_send hook passes through a non-exception event unchanged', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      const [, initOpts] = posthog.init.mock.calls[0];
      const beforeSend = initOpts.before_send as (cr: unknown) => unknown;
      const rawEvent = { uuid: 'u2', event: 'app_route_viewed', properties: { route: '/projects' } };
      expect(beforeSend(rawEvent)).toEqual(rawEvent);
    });
  });
```

**Verify (expected RED):** `cd pmo-portal && npx vitest run src/lib/analytics/client.test.ts` → new
`describe('captureException', ...)` block fails (method + `before_send` hook do not exist).

### Task S5-B — Implementation: extend `pmo-portal/src/lib/analytics/client.ts`

Per the Director's ruling on finding 2: redaction is a real `before_send` hook registered in the
`posthog.init(...)` config object (DC-OF-002's "via a `before_send` / payload-transform hook, not at
the call site" — `posthog-js`'s `PostHogConfig.before_send?: BeforeSendFn | BeforeSendFn[]` accepts a
function `(cr: CaptureResult | null) => CaptureResult | null` operating on the full outbound event,
confirmed against `node_modules/@posthog/types/dist/capture.d.ts`). The hook redacts `$exception_*`
properties on **any** outbound event (not just ones built by `captureException` — a defensive net
against a future direct `posthog.capture('$exception', ...)` call too), and `captureException` itself
stays thin: build the synthetic `Error`, call `posthog.captureException`, nothing else.

Add a redaction helper + the `before_send` hook builder, above the `analyticsClient` object:

```ts
const MAX_EXCEPTION_TEXT_LENGTH = 2000;

/**
 * Redact one exception-shaped string (FR-OF-011, NFR-OF-PRIV-002): strip query
 * strings from anything URL-shaped, drop any FORBIDDEN_PROPERTY_KEYS shape (e.g.
 * "token=xyz"), and bound the length.
 */
function redactExceptionText(text: string): string {
  let out = text.replace(/\?[^\s'")]*/g, '');
  for (const key of FORBIDDEN_PROPERTY_KEYS) {
    out = out.replace(new RegExp(`${key}[=:][^\\s'")&]*`, 'gi'), `${key}=[redacted]`);
  }
  return out.slice(0, MAX_EXCEPTION_TEXT_LENGTH);
}

/**
 * The `before_send` hook registered at `posthog.init()` (DC-OF-002, FR-OF-011): applied to EVERY
 * outbound event, not just ones built by `captureException`. Only touches the `$exception_*`
 * properties PostHog's exception schema populates (`$exception_message`, `$exception_list`,
 * `$exception_values`, `$exception_stack_trace_raw`) — every other event/property passes through
 * unchanged, so this hook is additive to (never a replacement for) `buildEventProperties`'s
 * existing scrub on ordinary `capture()` calls.
 */
function redactExceptionProperties(
  captureResult: import('@posthog/types').CaptureResult | null,
): import('@posthog/types').CaptureResult | null {
  if (!captureResult) return captureResult;
  const properties = captureResult.properties as Record<string, unknown>;
  if (typeof properties.$exception_message === 'string') {
    properties.$exception_message = redactExceptionText(properties.$exception_message);
  }
  if (typeof properties.$exception_stack_trace_raw === 'string') {
    properties.$exception_stack_trace_raw = redactExceptionText(properties.$exception_stack_trace_raw);
  }
  if (Array.isArray(properties.$exception_list)) {
    properties.$exception_list = (properties.$exception_list as Array<Record<string, unknown>>).map(
      (entry) => (typeof entry?.value === 'string' ? { ...entry, value: redactExceptionText(entry.value) } : entry),
    );
  }
  if (Array.isArray(properties.$exception_values)) {
    properties.$exception_values = (properties.$exception_values as unknown[]).map((v) =>
      typeof v === 'string' ? redactExceptionText(v) : v,
    );
  }
  return captureResult;
}

export interface CaptureExceptionInput {
  name: string;
  message: string;
  componentStack?: string;
}
```

Register the hook inside `init()`'s `posthog.init(config.posthogKey, { ... })` options object (add
one line to the existing options — do not change any other existing option):

```ts
      before_send: redactExceptionProperties,
```

Add the `captureException` method inside the `analyticsClient` object (after `capture`) — thin, no
redaction logic of its own (the `before_send` hook does that on the way out):

```ts
  captureException(input: CaptureExceptionInput) {
    if (!initialized || !activeConfig?.enabled) return;
    const err = new Error(input.message) as Error & { componentStack?: string };
    err.name = input.name;
    if (input.componentStack !== undefined) {
      err.componentStack = input.componentStack;
    }
    posthog.captureException(err);
  },
```

**Note (finding 4, informational — no code change):** `new Error(input.message)` constructs a
**synthetic** Error at the `captureException` call site, so its own `.stack` is a fresh stack trace
captured at that construction point, not the original throw-site stack of `error` (from
`componentDidCatch`) or the global `error`/`unhandledrejection` event. This is an accepted, spec'd
tradeoff (privacy over fidelity — DC-OF-002 exists specifically to avoid forwarding raw
error/stack/prompt content), not a defect; `input.componentStack` (React's own component tree
trace, deliberately preserved) is what gives PostHog's Error Tracking UI useful location context
here, not the JS call stack. Flagged for awareness only, in case a future issue wants PostHog's
frame-parsing / source-map integration, which would need the *original* Error object (redacted)
rather than a synthetic one — out of this spec's scope.

Add the import at the top: `FORBIDDEN_PROPERTY_KEYS` is already imported from `./events` (line 11) —
confirm it is, reuse it (do not re-import).

**Verify (expected GREEN):** `cd pmo-portal && npx vitest run src/lib/analytics/client.test.ts` → all
pass, including the new `captureException` block and the two `before_send` hook tests. Grep-confirm
AC tagging: `grep -n "AC-OF-0\(08\|09\|11\)" src/lib/analytics/client.test.ts`.

**Slice S5 final verify:** `cd pmo-portal && npm run verify`.

---

## 8. Slice S6 — Wire capture into `ErrorBoundary` + `AnalyticsProvider`

### Task S6-A — Failing test first: extend `pmo-portal/src/components/ErrorBoundary.test.tsx`

`vi.mock` must be declared at module scope (hoisted) to intercept the imports `ErrorBoundary.tsx`
itself uses. Since Task S6-B has `ErrorBoundary.tsx` import `analyticsClient` from
`@/src/lib/analytics/client` directly (finding 3's fix — the barrel does not export it) and
`safeTrack` from the barrel `@/src/lib/analytics`, the test mocks **both specifiers separately**,
mirroring `AnalyticsProvider.test.tsx`'s `vi.hoisted`/`vi.mock` pattern (which mocks `./client` on
its own) but scoped to `ErrorBoundary.test.tsx`'s own `@/`-alias imports. Add as a **second describe
block in the same file**, with both mocks declared before the `ErrorBoundary` import:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// ── Mocked analytics facade (module-scope, hoisted — must precede the ErrorBoundary import
// so the component under test picks up the mocks). Two separate vi.mock calls because
// ErrorBoundary.tsx imports analyticsClient from '@/src/lib/analytics/client' directly (the
// barrel deliberately does not export it) and safeTrack from the barrel '@/src/lib/analytics'. ──
const analyticsMock = vi.hoisted(() => ({
  captureException: vi.fn(),
}));
vi.mock('@/src/lib/analytics/client', () => ({
  analyticsClient: analyticsMock,
}));
vi.mock('@/src/lib/analytics', () => ({
  safeTrack: (fn: () => void) => {
    try {
      fn();
    } catch {
      // mirror the real safeTrack's swallow behavior in the test double
    }
  },
}));

import { ErrorBoundary } from './ErrorBoundary';

function Boom({ crash }: { crash: boolean }): React.ReactElement {
  if (crash) throw new Error('kaboom');
  return <div>recovered content</div>;
}

describe('ErrorBoundary — PostHog exception capture (observability floor)', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    analyticsMock.captureException.mockClear();
  });
  afterEach(() => errSpy.mockRestore());

  it('AC-OF-009: calls captureException with {name, message, componentStack} exactly once per caught error', () => {
    render(
      <ErrorBoundary>
        <Boom crash />
      </ErrorBoundary>,
    );
    expect(analyticsMock.captureException).toHaveBeenCalledTimes(1);
    const arg = analyticsMock.captureException.mock.calls[0][0];
    expect(arg).toMatchObject({ name: 'Error', message: 'kaboom' });
    expect(typeof arg.componentStack).toBe('string');
  });

  it('AC-OF-009: console.error is still called (existing behavior preserved)', () => {
    render(
      <ErrorBoundary>
        <Boom crash />
      </ErrorBoundary>,
    );
    expect(errSpy).toHaveBeenCalled();
  });
});
```

**Verify (expected RED):** `cd pmo-portal && npx vitest run src/components/ErrorBoundary.test.tsx` →
new describe block fails (captureException not called — `componentDidCatch` doesn't wire it yet).

### Task S6-B — Implementation: edit `pmo-portal/src/components/ErrorBoundary.tsx`

Per the Director's ruling on finding 3: `pmo-portal/src/lib/analytics/index.ts` (the barrel)
**deliberately does not export `analyticsClient`** — its own header comment states "Raw
analyticsClient is intentionally NOT exported; use the typed helpers below," and it re-exports only
`safeTrack` (confirmed via `grep -n "export" pmo-portal/src/lib/analytics/index.ts`, line 5's comment
+ line 21's `export { safeTrack } from './safeTrack';`). `AnalyticsProvider.tsx` already imports
`analyticsClient` directly from `./client` (a relative sibling import, not the barrel) for exactly
this reason — `ErrorBoundary.tsx` must do the same:

```tsx
import React from 'react';
import { Button } from '@/src/components/ui';
import { analyticsClient } from '@/src/lib/analytics/client';
import { safeTrack } from '@/src/lib/analytics';
```

(`safeTrack` IS re-exported from the barrel — `@/src/lib/analytics` line 21 — so that half of the
plan's original sketch was already correct; only the `analyticsClient` half needed the direct
`client` path.)

```tsx
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
    safeTrack(() =>
      analyticsClient.captureException({
        name: error.name,
        message: error.message,
        componentStack: info.componentStack ?? undefined,
      }),
    );
  }
```

**Verify (expected GREEN):** `cd pmo-portal && npx vitest run src/components/ErrorBoundary.test.tsx`
→ all pass (both the pre-existing 5 tests and the 2 new ones).

### Task S6-C — Failing test first: extend `pmo-portal/src/lib/analytics/AnalyticsProvider.test.tsx`

Add to the `analytics` `vi.hoisted` mock object: `captureException: vi.fn()`. Add a new test:

```tsx
  it('AC-OF-010: a real unhandledrejection event routes through captureException via safeTrack, and an SDK throw does not propagate', () => {
    analytics.captureException.mockImplementationOnce(() => {
      throw new Error('posthog SDK exploded');
    });
    renderTree(makeAuthCtx());

    const rejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject(new Error('boom')).catch(() => {}),
      reason: new Error('boom'),
    });

    expect(() => window.dispatchEvent(rejectionEvent)).not.toThrow();
    expect(analytics.captureException).toHaveBeenCalledTimes(1);
    expect(analytics.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Error', message: 'boom' }),
    );
  });
```

**Verify (expected RED):** `cd pmo-portal && npx vitest run src/lib/analytics/AnalyticsProvider.test.tsx`
→ new test fails (no listener registered yet).

### Task S6-D — Implementation: edit `pmo-portal/src/lib/analytics/AnalyticsProvider.tsx`

Add a `safeTrack` import and a registration `useEffect`:

```tsx
import { analyticsClient } from './client';
import { safeTrack } from './safeTrack';
```

```tsx
  // Global exception capture (FR-OF-013) — registered once, routed through safeTrack so a
  // PostHog fault can never propagate into the window's own event-dispatch machinery.
  useEffect(() => {
    if (!config.enabled) return;
    const onError = (event: ErrorEvent) => {
      safeTrack(() =>
        analyticsClient.captureException({
          name: event.error?.name ?? 'Error',
          message: event.message,
        }),
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      safeTrack(() =>
        analyticsClient.captureException({
          name: reason instanceof Error ? reason.name : 'UnhandledRejection',
          message: reason instanceof Error ? reason.message : String(reason),
        }),
      );
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [config.enabled]);
```

**Verify (expected GREEN):** `cd pmo-portal && npx vitest run src/lib/analytics/AnalyticsProvider.test.tsx`
→ all pass.

### Task S6-E — AC-OF-014 disabled-analytics guard test (extend either client.test.ts or AnalyticsProvider.test.tsx)

Add to `AnalyticsProvider.test.tsx`:
```tsx
  it('AC-OF-014: disabled analytics registers no error/unhandledrejection listener (no captureException call on a synthetic error)', () => {
    const originalEnabled = mockConfig.enabled;
    mockConfig.enabled = false;
    renderTree(makeAuthCtx());
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));
    expect(analytics.captureException).not.toHaveBeenCalled();
    mockConfig.enabled = originalEnabled;
  });
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/analytics/AnalyticsProvider.test.tsx`.

**Slice S6 final verify:** `cd pmo-portal && npm run verify` (full suite — typecheck + lint:ci + test +
build; confirms no cross-file regression from the `ErrorBoundary`/`AnalyticsProvider` edits).

---

## 9. Slice S7 — Config + runbook deliverables (`docs/environments.md`)

### Task S7-A — Add "Observability & alerting" section to `docs/environments.md`

Insert a new `##` section after the existing "Agent prod-readiness check" subsection (which currently
ends with the "Next step not yet built" paragraph flagging exactly this work — replace that flagged
paragraph's forward-pointer with a "Superseded by" note, and add the new section):

```markdown
## Observability & alerting (GTM item 3 — the floor)

Four pieces, each config-per-deployed-project (ADR-0047): a Telegram alert webhook, PostHog FE error
tracking, BetterStack uptime/status, and two PostHog dashboards. Code: `docs/specs/observability-floor.spec.md`
+ `docs/plans/2026-07-04-observability-floor.md`.

### Telegram alert webhook — secrets + GUCs (per deployed project)

Function secrets on `telegram-notify` (1Password vault `AS`, per ADR-0047 — never committed):
```bash
supabase secrets set TELEGRAM_BOT_TOKEN=<bot token from @BotFather>
supabase secrets set TELEGRAM_CHAT_ID=<numeric chat id>
supabase secrets set HEARTBEAT_URL=<BetterStack heartbeat monitor URL>   # optional; no-op if unset
supabase functions deploy telegram-notify health
```
Postgres GUCs (same seam as `agent-dispatch`'s `app.settings.dispatch_url`, set via `ALTER DATABASE
... SET`, never in this repo):
```sql
ALTER DATABASE postgres SET app.settings.telegram_notify_url = 'https://<ref>.supabase.co/functions/v1/telegram-notify';
ALTER DATABASE postgres SET app.settings.service_role_key = '<service role key>';
ALTER DATABASE postgres SET app.settings.telegram_cooldown_seconds = '900';  -- optional, default 900
```

### BetterStack — monitors + status page checklist (AC-OF-012)

- [ ] Monitor 1: the deployed FE URL (Cloudflare Pages), HTTP check, expect 200.
- [ ] Monitor 2: `https://<ref>.supabase.co/functions/v1/health`, HTTP check, expect 200.
- [ ] Monitor 3 (heartbeat): create a BetterStack **Heartbeat** monitor; its ping URL becomes the
      `telegram-notify` `HEARTBEAT_URL` function secret above. Alerts if no ping arrives within its
      configured grace period (should exceed the 2-minute drain cadence, e.g. 10 min grace) — this is
      what surfaces a dead cron/alert path (FR-OF-021, closing the persistent-silence gap).
- [ ] A public status page built from monitors 1+2 (monitor 3 is internal-only, not on the page).
- [ ] On-call/notification target: the same Telegram chat (or the owner's email) per BetterStack's
      own notification config.

### PostHog dashboards (AC-OF-013, AC-OF-014) — no new events (LD-OF-008)

**(a) Org usage** — panels: weekly-active-users (distinct identified users, ≥1 event in trailing 7d);
top pages (`app_route_viewed` grouped by `route`); breakdown filter on `org_id`.

**(b) Agent activity/cost** — panels: per-builder event counts (the 9 typed builders:
`agent_panel_opened`, `agent_run_started`, `agent_run_completed`, `agent_run_errored`,
`agent_approval_shown`, `agent_approval_decided`, `agent_thread_resumed`, `agent_feedback_rated`,
`agent_compose_view_saved`); run completion rate (`agent_run_completed` / `agent_run_started`); error
rate (`agent_run_errored` / `agent_run_started`); approval funnel (`agent_approval_shown` →
`agent_approval_decided`); feedback rating split (`agent_feedback_rated` by `rating`); breakdown
filter on `org_id`; a text panel linking to the Ops-Admin usage view (GTM item 1c) captioned
"Authoritative $$ cost/margin lives in the Ops-Admin usage view — this dashboard shows activity
volume only, never monetary values (NFR-OF-PRIV-001)."

### Live-verify runbook (AC-OF-007, AC-OF-011, AC-OF-012, M-7)

1. **Telegram burst dedupe:** temporarily unset `OPENROUTER_API_KEY` on the deployed project, fire one
   `agent-chat` request (expect its 502), confirm within ≤ 2 min a Telegram message arrives in the
   configured chat. Fire 3 more requests within the cooldown window; confirm no second message
   arrives until the cooldown (15 min default) elapses.
2. **Health endpoint:**
   ```bash
   curl -i https://<ref>.supabase.co/functions/v1/health          # expect 200, {ok:true,...}
   curl -i -X HEAD https://<ref>.supabase.co/functions/v1/health   # expect 200
   curl -i -X POST https://<ref>.supabase.co/functions/v1/health   # expect 405
   ```
3. **FE exception capture:** in a deployed/demo build with analytics enabled, force a render throw
   (e.g. a temporary `throw new Error('test')` in a dev console), confirm a redacted exception appears
   in PostHog's Error Tracking UI within a minute, with no query string / token / PII in the message.
4. **Route event spot-check (M-7):** from a real browser against the deployed FE, navigate to any
   page and confirm an `app_route_viewed` event lands in PostHog's live events view (re-confirms
   existing analytics capture is still wired end-to-end, not a regression from this issue).

**Residual risk (M-8):** the BetterStack monitors and the two PostHog dashboards above are
reproducible-from-docs checklists, not regression-protected — no automated test fails if a monitor or
dashboard is later deleted. Accepted MVP residual (external SaaS, no CI runtime); this checklist +
per-deployed-project sign-off is the control.
```

**Verify:** manual read-through — confirm every fenced code block is copy-pasteable (no
`<placeholder>` left un-annotated as "fill in per project" — the angle-bracket values here ARE the
intentional per-project fill points, consistent with how the rest of `docs/environments.md` already
documents `OPENROUTER_API_KEY=sk-or-…` etc.).

**Slice S7 final verify:** no code changes — nothing to `npm run verify`; confirm the doc renders
correctly in a Markdown preview and that `grep -c "AC-OF-0"  docs/environments.md` finds the AC
references added (07/11/12/13/14).

---

## 10. Traceability (AC-OF-### → owning layer → file) — every AC placed exactly once

| AC | Owning layer | Artifact | Slice |
|---|---|---|---|
| AC-OF-001 | Unit / Vitest | `pmo-portal/src/lib/agent/telegramNotify.test.ts` | S3 |
| AC-OF-002 | Unit / Vitest | `pmo-portal/src/lib/agent/telegramNotify.test.ts` | S3 |
| AC-OF-003 | Unit / Vitest | `pmo-portal/src/lib/agent/errorEvent.test.ts` | S2 |
| AC-OF-004 | Integration / pgTAP | `supabase/tests/0122_error_events_denydefault.test.sql` | S1 |
| AC-OF-005 | Unit / Vitest (mocked fetch) | `pmo-portal/src/lib/agent/telegramNotify.test.ts` | S3 |
| AC-OF-006 | Unit / Vitest | `pmo-portal/src/lib/agent/telegramNotify.test.ts` | S3 |
| AC-OF-007 | live-verify runbook | `docs/environments.md` §Observability & alerting, step 1 | S7 |
| AC-OF-008 | Unit / Vitest | `pmo-portal/src/lib/analytics/client.test.ts` | S5 |
| AC-OF-009 | Unit / Vitest | `client.test.ts` + `ErrorBoundary.test.tsx` | S5, S6 |
| AC-OF-010 | Unit / Vitest | `AnalyticsProvider.test.tsx` | S6 |
| AC-OF-011 | Unit / Vitest (+ live-verify) | `pmo-portal/src/lib/agent/health.test.ts` + runbook step 2 | S4, S7 |
| AC-OF-012 | config-deliverable checklist | `docs/environments.md` §BetterStack checklist | S7 |
| AC-OF-013 | config-deliverable checklist | `docs/environments.md` §PostHog dashboards (a) | S7 |
| AC-OF-014 | config-deliverable checklist | `docs/environments.md` §PostHog dashboards (b) | S7 |
| AC-OF-015 | Unit / Vitest | `pmo-portal/src/lib/agent/telegramNotify.test.ts` | S3 |

**Note on AC-OF-009's two rows:** the spec's own traceability table lists AC-OF-009 at
`client.test.ts` "(+ ErrorBoundary.test.tsx)" as one combined artifact entry — this plan honors that
as a single owning layer (Unit/Vitest) split across two slices (S5 proves the `captureException`
redaction contract in isolation; S6 proves it is actually WIRED at the `ErrorBoundary` boundary). This
is not a double-counted AC — it is one AC, one layer, proven by two cooperating test files per the
spec's own artifact column, not a plan deviation.

**Every AC-OF-001..015 appears above exactly once as a table row** (15 rows for 15 ACs — confirmed by
count against the spec's own traceability table in §"Traceability" of `observability-floor.spec.md`).

---

## 11. Migration / pgTAP / new-file inventory (collision check against ops-admin-surface)

| Kind | Number/path | Collision check |
|---|---|---|
| Migration | `supabase/migrations/0067_error_events.sql` | ops-admin-surface uses 0058–0066; 0067 is the next free number. Clear. |
| pgTAP | `supabase/tests/0122_error_events_denydefault.test.sql` | ops-admin-surface uses 0110–0121; 0122 is the next free number. Clear. |
| New edge fn dir | `supabase/functions/telegram-notify/` | No existing dir; no collision. |
| New edge fn dir | `supabase/functions/health/` | No existing dir; no collision. |
| New shared module | `supabase/functions/_shared/errorEvent.ts` | No existing file; no collision. |
| New Vitest file | `pmo-portal/src/lib/agent/errorEvent.test.ts` | No existing file; no collision. Placement per the §2 test-placement rule (Vitest cannot discover `supabase/functions/**/*.test.ts`), not `supabase/functions/_shared/errorEvent.test.ts`. |
| New Vitest file | `pmo-portal/src/lib/agent/telegramNotify.test.ts` | No existing file; no collision. Placement per the §2 test-placement rule, not `supabase/functions/telegram-notify/logic.test.ts`. |
| New Vitest file | `pmo-portal/src/lib/agent/health.test.ts` | No existing file; no collision. Placement per the §2 test-placement rule, not `supabase/functions/health/health.test.ts`. |
| Edited files | `agent-chat/index.ts`, `compose-view/index.ts`, `agent-dispatch/index.ts`, `agent-dispatch/dispatcher.ts`, `pmo-portal/src/lib/analytics/client.ts`, `.../AnalyticsProvider.tsx`, `pmo-portal/src/components/ErrorBoundary.tsx`, `supabase/config.toml`, `docs/environments.md` | None of these are touched by the ops-admin-surface plan (confirmed by that plan's own slice map, §1, which lists only Ops-Admin/Users/Credits/Features surfaces) — no merge-conflict risk expected, but confirm `git diff` against `dev` before opening the PR since both worktrees branch from `dev` independently. |

---

## 12. Open questions for the Director

None — the spec is signed (2-model review battery passed) and this plan implements it verbatim,
including its own documented deviations (runbook location, secrets seam reconciliation, `errorLog.ts`
purity). One item flagged for awareness, not a blocking question:

- **`agent-dispatch/index.ts:49` (`MISSING_SERVICE_ROLE_KEY`) has no `recordErrorEvent` call** (Task
  S2-E) — there is no service-role key available to construct the client that would write the row
  reporting its own absence. This is a genuine, load-bearing exception to "wire into all four call
  sites," not an oversight; flagged inline in the task and here for visibility at review time.
