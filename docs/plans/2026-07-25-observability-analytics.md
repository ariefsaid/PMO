# Implementation plan — Observability & Analytics program

- **Spec:** [`docs/specs/observability-analytics.spec.md`](../specs/observability-analytics.spec.md)
- **ADRs:** **0066** (edge error-reporting choke point), **0067** (friction instrumentation + consent
  posture) — both written with this plan. Also binding: 0010 (test pyramid), 0006 (reversible
  migrations), 0019 (security-definer RPC boundary), 0039 decision-7 (edge-fn logic tested from
  `pmo-portal/`), 0044 (dispatcher deputy invariant), 0046 (ops tables are service-role-only).
- **Date:** 2026-07-25 · **Author:** eng-planner (Opus 5) · **Base:** `dev` @ `e85329bb`
- **Build order:** TDD red→green throughout. **NFR-HRD-001 is binding for every defect fix in this
  plan** — the failing test comes first and each task states *how to see it fail against the unfixed
  code*. Several of these defects are invisible to the current suite precisely because the code
  swallows the signal, so a test written after the fix can pass against both versions and prove
  nothing.

---

## 0. Standing rules for every task in this plan

| Rule | Detail |
|---|---|
| **Shared local DB** | Every DB-driving command is wrapped: `scripts/with-db-lock.sh supabase db reset`, `scripts/with-db-lock.sh supabase test db`. Run `supabase` from the **repo root**. FE/Vitest tasks run from `pmo-portal/` and need no lock. |
| **Pre-push gate** | The final task of every slice is `cd pmo-portal && npm run verify` — the WHOLE suite (`check:migrations && check:e2e-isolation && check:edge-test-binding && typecheck && typecheck:edge && lint:ci && test && build`). Targeted runs are for the inner TDD loop only; they miss cross-component breakage. |
| **Branch flow** | Each slice is its own branch off `dev` in its own `git worktree`, PR → `dev`. `main` is the autonomous ceiling. **Never** touch `production`. |
| **Migration numbering** | Highest existing migration is **`0166_attestation_releases_the_held_mirror.sql`**; highest pgTAP test is **`0159_attestation_admits_the_reopen.test.sql`**. This plan allocates migrations **0167, 0168, 0169, 0171** and pgTAP tests **0160, 0161, 0162, 0164**. ⚑ **0170 and 0163 are deliberately unused** — the per-task filenames below are authoritative and skip them. Nothing is missing; the gaps are free headroom. ⚑ A parallel branch may also allocate — before writing, re-run `ls supabase/migrations | tail -3` and `ls supabase/tests | sort | tail -3` and shift the whole block up if taken. `npm run check:migrations` catches collisions at verify time. |
| **No PII in analytics** | Any new event property routes through `buildEventProperties` (throws in dev on a forbidden key). No direct `posthog-js` import outside `src/lib/analytics/client.ts` — the ESLint `no-restricted-imports` rule stays. |

### Excluded from this plan (do not build here)

**Spec §4.5 — NUL bytes / FR-HRD-030/031 / AC-HRD-030/031 — is being built in parallel on branch
`fix/nul-grep-blindness`.** Do not plan or implement it here.

⚑ **Collision surface with that branch:** it will almost certainly add a guard script under
`scripts/` and wire it into `pmo-portal/package.json`'s `verify` script — the *same line* this plan
edits twice (Slice C task C7, Slice F task F8). Whichever lands second resolves the `verify` chain by
keeping **both** checks. Do not resolve by taking one side. It may also touch
`supabase/functions/agent-dispatch/dispatcher.ts:209`; Slice B task B7 edits `dispatcher.ts:288-306`
— different hunks, but rebase rather than merge if both are in flight.

### Assumptions recorded as assumptions, not facts

| # | Assumption | Why it is not settled | What changes if the owner says otherwise |
|---|---|---|---|
| **AS-1** | **`error_events` retention window = 90 days.** | Spec FR-OBS-021 asserts it; spec §8 Q3 asks the owner to confirm. | The window is a single default argument (`purge_error_events(p_retention_days int default 90)`) and one cron literal. Changing it is a one-line migration, not a redesign. |
| **AS-2** | **The Telegram drain cadence stays hourly** (`0083_telegram_notify_vault.sql:53`, `'0 * * * *'`). | Spec §8 Q2 asks whether ~1h is acceptable for money write-through failures. `0083`'s own comment says "tighten the cron here if faster alerting is wanted later". | Only the cron expression changes. The liveness design (Slice B) is cadence-agnostic: `LIVENESS_INTERVAL_HOURS` is a separate constant, defaulting to 24h, unrelated to tick cadence. |

Both are called out in the PR descriptions so the owner is asked at review time, not after.

---

## 1. PR slicing

Six PRs to `dev`, in this order. Strand B first — it is independent of every design decision in
Strands A and C, and it is where the money/alerting risk lives.

| PR | Slice | Spec sections | Files touched (headline) | Depends on |
|---|---|---|---|---|
| **PR-1** | **A — Alerting hardening** | §4.2, §4.3, §4.4 | `supabase/migrations/0167`, `supabase/tests/0160`, `telegram-notify/{logic,index}.ts`, `agent-dispatch/dispatcher.ts` | — |
| **PR-2** | **B — Money & concurrency** | §4.6 (FR-HRD-040/041/043) | `supabase/migrations/0168`–`0169`, `supabase/tests/0161`–`0162`, `.github/workflows/spike-rls.yml`, `spike/agent-native-rls/.gitignore` | — |
| **PR-3** | **C — Edge error coverage** | §3.1 | `_shared/{errorLog,serveWithErrorReporting,errorEventSink,reportEdgeError}.ts`, all 22 `supabase/functions/*/index.ts`, `scripts/check-edge-fn-error-reporting.mjs` | — |
| **PR-4** | **D — Pipeline self-report + retention** | §3.2, §3.3 | `_shared/{errorEvent,reportEdgeError}.ts`, `supabase/migrations/0171`, `supabase/tests/0164` | PR-3 |
| **PR-5** | **E — Client config + consent** | §5.1, §6 | `src/lib/analytics/{client,index}.ts`, `src/components/legal/AnalyticsOptOutToggle.tsx`, `pages/Privacy.tsx`, `playwright.config.ts`, `e2e/AC-CON-003-*.spec.ts` | — |
| **PR-6** | **F — Friction, funnel, quota, tile gate** | §5.2, §5.3, §5.4 | `src/lib/classifyMutationError.ts`, `src/lib/analytics/{events,index,eventCallSites}.ts`, `src/components/ui/useEntityForm.ts`, `scripts/posthog/*`, `scripts/check-dashboard-tiles.mjs` | PR-5 (init config) |

**BLOCKED — not in any PR: FR-HRD-042 (interactive-create idempotency).** See §8.

---

## 2. Design decisions (one at a time)

### D1 — The alert cooldown must not be derived from the stamp it is trying to protect

The re-alert loop (spec §4.2) has two halves and the second is the load-bearing one:

- `telegram-notify/index.ts:96-100` awaits the `notified_at` UPDATE and **discards the result**.
  supabase-js resolves (does not throw) with `error` populated, so RLS changes, statement timeouts
  and PostgREST 5xx are invisible.
- `lastNotifiedByCode` is derived at `index.ts:57-66` from rows **where `notified_at IS NOT NULL`**.
  So when the stamp never lands, the code is never considered recently-notified and the cooldown
  **cannot** suppress the re-send. Unbounded, at cron cadence, forever.

**Decision:** derive the cooldown from a **new write-ahead table** `public.alert_send_log`, written
*before* the Telegram send, keyed by `error_code`. `notified_at` stamping stays (it drives the
unnotified selection) but its failure is now detected, logged with `NOTIFY_STAMP_FAILED`, and can no
longer cause unbounded re-send because the cooldown source was written before the send.

Trade recorded: a send that fails *after* the write-ahead is suppressed for one cooldown window
(`TELEGRAM_COOLDOWN_SECONDS`, default 900s). One alert delayed ≤15 min beats alert-spamming the owner
forever. FR-HRD-001 fixes the cause; this is FR-HRD-002's bound.

### D2 — The drain body moves into `logic.ts` so it can be unit-tested at all

`telegram-notify/index.ts:4-7` explicitly declares itself **not unit-tested** ("Thin wiring ONLY —
all drain logic lives in logic.ts"). Spec §7 assigns AC-HRD-001 to **Unit (Vitest)**. Those are only
compatible if the drain loop moves into `logic.ts` behind injected effects. It does. `index.ts` keeps
auth, env reads and client construction; `logic.ts` gains `runDrain(deps)`.

This is the right seam anyway: it is the seam that had zero coverage and silently never stamped
(the `ids`/Fix-1 comment at `logic.ts:26-29` is the last time this same class bit us).

### D3 — Alert-path liveness is a daily all-clear on the same channel

`HEARTBEAT_URL` is unset in production, so `pingHeartbeat` is a no-op today (spec §4.3, §8 Q1).
Configuring an external monitor is an owner action, not code.

**Decision (code-side, actionable now):** when a tick completes successfully and has sent nothing,
and more than `LIVENESS_INTERVAL_HOURS` (default 24) have passed since the last outbound Telegram
message, send a one-line all-clear. Silence in Telegram then means *broken*, and a daily all-clear
means *alive* — the two states stop presenting identically, on the channel the owner already watches,
with no new infra. The "last outbound" timestamp lives in `public.ops_job_heartbeats`.

The external heartbeat stays open as owner question Q1; this does not close it, it stops the gap
being total in the meantime.

### D4 — The edge-function coverage gap is closed by a wrapper + a CI gate, not 22 hand-edits

See **ADR-0066**. `serveWithErrorReporting(fn, handler)` replaces every bare `Deno.serve(...)`;
`scripts/check-edge-fn-error-reporting.mjs` (in `verify`) makes an unwired function a build failure.
The `EdgeFunctionName` union is derived from an exported const array whose contents a Vitest test
compares against the actual `supabase/functions/*/index.ts` directory listing.

### D5 — Friction is instrumented at `classifyMutationError`, not `useEntityForm`

See **ADR-0067** for the full argument and the evidence. **I agree with the spec and did not plan the
other approach.** Verified against this exact commit:

- `src/components/ui/useEntityForm.ts:196` gates `trackSaveFailed` on `module && entityType`;
  no caller passes `entityType`.
- `useEntityForm.ts:190-203`'s catch *does* rethrow — but it never runs, because every form's
  `onValid` swallows its own error (`pages/Companies.tsx:421-429`, quoted verbatim in ADR-0067).
- `classifyMutationError` has **194 references across 74 files** (measured on this commit) versus 17
  entity forms, and already extracts the error `code` structurally.

So passing the missing prop would produce zero events *and* an empty chart that reads as a product
fact. Instrument at the funnel.

### D6 — AC-CON-003's e2e needs a second dev server, or it is a guaranteed vacuous pass

`getAnalyticsConfig` (`src/lib/analytics/config.ts:98`) computes
`enabled = (demoMode || analyticsEnabled) && isValidPosthogKey(VITE_POSTHOG_KEY)`. In the e2e
environment there is no valid `phc_` key, so analytics is **already** disabled and "no request to the
PostHog host" is trivially true **before any of this work exists**. That is the exact defect class
this spec is about, reproduced inside its own acceptance test.

**Decision:** add a second Playwright `webServer` on port **3100** with
`VITE_ANALYTICS_ENABLED=true`, a syntactically valid fake key, and
`VITE_POSTHOG_HOST=https://ph-e2e.invalid`, plus a dedicated `consent` project that runs only
`e2e/AC-CON-003-*.spec.ts` against it. The spec asserts a **control** first (opted-in → PostHog
requests *are* attempted) and only then the opt-out. Without the control the test proves nothing.
No other e2e spec is affected — they keep the port-3000 server.

---

## 3. Slice A (PR-1) — Alerting hardening · spec §4.2, §4.3, §4.4

Branch: `fix/alert-drain-hardening`.

### Task A1 — Migration 0167: write-ahead alert log + ops job heartbeats

Create `supabase/migrations/0167_alert_send_log_and_job_heartbeats.sql`:

```sql
-- 0167_alert_send_log_and_job_heartbeats.sql
-- Alerting hardening (docs/specs/observability-analytics.spec.md §4.2/§4.3, FR-HRD-001/002/010).
--
-- WHY alert_send_log: telegram-notify derived its cooldown from error_events.notified_at
-- (index.ts:57-66, "where notified_at IS NOT NULL"). When the notified_at UPDATE failed — silently,
-- because supabase-js RESOLVES with `error` populated and index.ts:96-100 discarded the result — the
-- code was never considered recently-notified, so the cooldown could not suppress the re-send and the
-- drain re-alerted the same group every tick, forever. Writing the send record AHEAD of the send, to
-- a table that is not the one being stamped, makes the cooldown hold regardless of stamp success.
--
-- WHY ops_job_heartbeats: "no errors occurred" and "the alert path is broken" both present as silence
-- (FR-HRD-010). This is the 0071 cron lesson generalised — 0071's telegram-notify-tick ran thousands
-- of times with ZERO successes in production because its GUCs were never set, and nobody noticed until
-- 0083 replaced it. A schedule existing is not a schedule working.
--
-- Both tables are ops bookkeeping, NOT tenant business data — same posture as error_events (0071) and
-- agent_dispatch_watermarks (ADR-0046): RLS enabled + forced with ZERO policies, service_role only.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   drop table if exists public.alert_send_log;
--   drop table if exists public.ops_job_heartbeats;

create table public.alert_send_log (
  error_code   text primary key,
  last_sent_at timestamptz not null,
  send_count   integer not null default 1 check (send_count >= 0)
);
comment on table public.alert_send_log is
  'Write-ahead record of Telegram alert sends, keyed by error_code. Written BEFORE the send so the '
  'cooldown holds even when the error_events.notified_at stamp fails (FR-HRD-001/002). Service_role only.';

create table public.ops_job_heartbeats (
  job_name        text primary key,
  last_success_at timestamptz not null,
  last_detail     jsonb
);
comment on table public.ops_job_heartbeats is
  'Last successful run per ops job (telegram-notify drain, error-events purge). Distinguishes '
  '"nothing happened" from "the job is broken" (FR-HRD-010, FR-OBS-020). Service_role only.';

alter table public.alert_send_log      enable row level security;
alter table public.alert_send_log      force  row level security;
alter table public.ops_job_heartbeats  enable row level security;
alter table public.ops_job_heartbeats  force  row level security;

-- DELIBERATELY NO policy of any kind → default-deny to authenticated and anon.
revoke all on public.alert_send_log     from authenticated;
revoke all on public.alert_send_log     from anon;
revoke all on public.ops_job_heartbeats from authenticated;
revoke all on public.ops_job_heartbeats from anon;
```

**RED/GREEN:** structural migration, proved by A2.
**Verify:** `scripts/with-db-lock.sh supabase db reset`
**Covers:** FR-HRD-001, FR-HRD-002, FR-HRD-010 (schema half).

---

### Task A2 — pgTAP 0160: both new tables are locked down

Create `supabase/tests/0160_alert_ops_tables_lockdown.test.sql`:

```sql
-- 0160_alert_ops_tables_lockdown.test.sql
-- AC-HRD-002 [pgTAP, PROPOSED]: alert_send_log and ops_job_heartbeats are service-role-only —
-- RLS enabled + forced, ZERO policies, and an authenticated JWT is denied SELECT/INSERT/UPDATE.
-- Mirrors the error_events posture (0071) and the m365 lockdown pattern (0154).
begin;
select plan(10);

insert into organizations (id, name) values
  ('01600000-0000-0000-0000-000000000001','AC-HRD-002 Org');
insert into auth.users (id, email) values
  ('01600000-0000-0000-0000-0000000000a1','ops-lockdown@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01600000-0000-0000-0000-0000000000a1','01600000-0000-0000-0000-000000000001',
   'Ops Lockdown','ops-lockdown@example.com','Admin');

insert into public.alert_send_log (error_code, last_sent_at) values ('SEED_CODE', now());
insert into public.ops_job_heartbeats (job_name, last_success_at) values ('seed-job', now());

select is((select relrowsecurity     from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-HRD-002 alert_send_log RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.alert_send_log'::regclass),
          true, 'AC-HRD-002 alert_send_log RLS forced');
select is((select count(*)::int from pg_policies
             where schemaname='public' and tablename='alert_send_log'),
          0, 'AC-HRD-002 alert_send_log has ZERO policies');
select is((select relrowsecurity     from pg_class where oid = 'public.ops_job_heartbeats'::regclass),
          true, 'AC-HRD-002 ops_job_heartbeats RLS enabled');
select is((select relforcerowsecurity from pg_class where oid = 'public.ops_job_heartbeats'::regclass),
          true, 'AC-HRD-002 ops_job_heartbeats RLS forced');
select is((select count(*)::int from pg_policies
             where schemaname='public' and tablename='ops_job_heartbeats'),
          0, 'AC-HRD-002 ops_job_heartbeats has ZERO policies');

set local role authenticated;
set local request.jwt.claims = '{"sub":"01600000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok($$ select * from public.alert_send_log $$, '42501', null,
  'AC-HRD-002 authenticated SELECT on alert_send_log denied');
select throws_ok($$ insert into public.alert_send_log (error_code, last_sent_at)
                    values ('X', now()) $$, '42501', null,
  'AC-HRD-002 authenticated INSERT on alert_send_log denied');
select throws_ok($$ select * from public.ops_job_heartbeats $$, '42501', null,
  'AC-HRD-002 authenticated SELECT on ops_job_heartbeats denied');
select throws_ok($$ update public.ops_job_heartbeats set last_success_at = now() $$, '42501', null,
  'AC-HRD-002 authenticated UPDATE on ops_job_heartbeats denied');

reset role;
select * from finish();
rollback;
```

**RED:** run this test **before** applying 0167 (stash the migration, `db reset`, `supabase test db`)
— it errors on `relation "public.alert_send_log" does not exist`. Restore, reset, re-run → green.
**Verify:** `scripts/with-db-lock.sh supabase test db`
**Covers:** AC-HRD-002 *(PROPOSED — see §7 note)*.

---

### Task A3 — RED: unit test for the swallowed stamp failure

Create `pmo-portal/src/lib/agent/telegramDrain.test.ts`:

```ts
/**
 * Tests for the Telegram alert drain loop (`telegram-notify/logic.ts` runDrain).
 *
 * Test-location convention (ADR-0039 decision-7): edge-fn logic tests live under pmo-portal/
 * (Vitest's root); the implementation stays in supabase/functions/, imported by relative path.
 */
import { describe, it, expect, vi } from 'vitest';
import { runDrain } from '../../../../supabase/functions/telegram-notify/logic';

const row = (id: string, code: string, at: string) => ({
  id, error_code: code, fn: 'erpnext-sweep', context_id: null, org_id: null, created_at: at,
});

function deps(overrides: Partial<Parameters<typeof runDrain>[0]> = {}) {
  return {
    now: () => new Date('2026-07-25T12:00:00.000Z'),
    cooldownSec: 900,
    livenessIntervalHours: 24,
    selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
    selectLastSentByCode: async () => ({}),
    recordSendAhead: vi.fn(async () => ({ error: null })),
    sendTelegram: vi.fn(async () => ({ ok: true })),
    stampNotified: vi.fn(async () => ({ error: null })),
    readHeartbeat: async () => null,
    writeHeartbeat: vi.fn(async () => ({ error: null })),
    ...overrides,
  };
}

describe('runDrain', () => {
  it('AC-HRD-001: a failing notified_at stamp is DETECTED and logged with NOTIFY_STAMP_FAILED', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ stampNotified: vi.fn(async () => ({ error: { code: '42501' } })) });

    const result = await runDrain(d);

    expect(result.stampFailures).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[telegram-notify] NOTIFY_STAMP_FAILED',
      expect.objectContaining({ errorCode: 'NOTIFY_STAMP_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-HRD-001: after a failed stamp the SAME group is not re-sent on the next tick', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Tick 1: send succeeds, write-ahead lands, stamp FAILS -> the row stays unnotified.
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const sent: Record<string, string> = {};
    const recordSendAhead = vi.fn(async (code: string, atIso: string) => {
      sent[code] = atIso;
      return { error: null };
    });
    const shared = {
      selectUnnotified: async () => [row('r1', 'ERP_PUSH_FAILED', '2026-07-25T11:59:00.000Z')],
      selectLastSentByCode: async () => ({ ...sent }),
      recordSendAhead,
      sendTelegram,
      stampNotified: vi.fn(async () => ({ error: { code: '42501' } })),
    };

    await runDrain(deps(shared));
    await runDrain(deps(shared)); // next tick, same unnotified row

    expect(sendTelegram).toHaveBeenCalledTimes(1); // NOT 2 — the cooldown held
  });

  it('AC-HRD-001: the write-ahead record is written BEFORE the Telegram send', async () => {
    const order: string[] = [];
    const d = deps({
      recordSendAhead: vi.fn(async () => { order.push('record'); return { error: null }; }),
      sendTelegram: vi.fn(async () => { order.push('send'); return { ok: true }; }),
    });
    await runDrain(d);
    expect(order).toEqual(['record', 'send']);
  });
});
```

**RED — how to see it fail:** `runDrain` does not exist yet, so all three fail with a module/export
error. That is a legitimate red, but it is **not sufficient** for NFR-HRD-001. Before writing
`runDrain`, prove the *behaviour* is broken today:

```bash
# From the repo root, confirm the stamp result is discarded and the cooldown is derived
# from the very column the stamp writes:
sed -n '57,66p;96,100p' supabase/functions/telegram-notify/index.ts
```
Expected output shows `lastNotifiedByCode` built from `.not('notified_at','is',null)` and
`await serviceClient.from('error_events').update({...}).in('id', group.ids);` with no destructuring
of `error`. Paste that output into the PR description as the red evidence for AC-HRD-001. (A test
cannot be written against `index.ts` — it is excluded from unit testing by its own header, which is
*why* this defect survived.)

**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/telegramDrain.test.ts` → 3 failing.
**Covers:** AC-HRD-001 (Unit).

---

### Task A4 — GREEN: `runDrain` in `logic.ts`

Append to `supabase/functions/telegram-notify/logic.ts`:

```ts
import { logStructuredError } from '../_shared/errorLog.ts';

export interface DrainDeps {
  now: () => Date;
  cooldownSec: number;
  livenessIntervalHours: number;
  selectUnnotified: () => Promise<ErrorEventRow[]>;
  /** error_code -> ISO timestamp of the last WRITE-AHEAD send record (alert_send_log). */
  selectLastSentByCode: () => Promise<Record<string, string | undefined>>;
  /** Write-ahead: MUST resolve before sendTelegram is called (FR-HRD-002). */
  recordSendAhead: (errorCode: string, atIso: string) => Promise<{ error: unknown }>;
  sendTelegram: (payload: TelegramPayload) => Promise<{ ok: boolean }>;
  stampNotified: (ids: string[], atIso: string) => Promise<{ error: unknown }>;
  readHeartbeat: (job: string) => Promise<{ last_success_at: string } | null>;
  writeHeartbeat: (job: string, atIso: string, detail: unknown) => Promise<{ error: unknown }>;
}

export interface DrainResult {
  sent: number;
  suppressed: number;
  stampFailures: number;
  sendFailures: number;
  livenessPinged: boolean;
}

/**
 * runDrain — the whole drain loop, effects injected (FR-HRD-001/002/010).
 *
 * Two invariants this function exists to hold, both of which were broken in index.ts:
 *   1. The cooldown is derived from alert_send_log (written BEFORE the send), never from
 *      error_events.notified_at — so a failed stamp can no longer defeat the cooldown and
 *      re-alert the same group every tick forever.
 *   2. Every write result is INSPECTED. supabase-js resolves with `error` populated instead of
 *      throwing, so a discarded result is a silent failure by construction.
 */
export async function runDrain(deps: DrainDeps): Promise<DrainResult> {
  const nowIso = deps.now().toISOString();
  const result: DrainResult = {
    sent: 0, suppressed: 0, stampFailures: 0, sendFailures: 0, livenessPinged: false,
  };

  const rows = await deps.selectUnnotified();
  const lastSentByCode = await deps.selectLastSentByCode();
  const groups = groupIntoMessages(rows, lastSentByCode, deps.cooldownSec);

  for (const group of groups) {
    if (!group.suppressed) {
      // WRITE-AHEAD (FR-HRD-002): record the send BEFORE performing it, in a table that is not
      // the one being stamped. A failure here aborts the send — better a delayed alert than an
      // unbounded re-alert loop.
      const ahead = await deps.recordSendAhead(group.errorCode, nowIso);
      if (ahead.error) {
        logStructuredError({
          fn: 'telegram-notify',
          errorCode: 'ALERT_SEND_LOG_WRITE_FAILED',
          contextId: group.errorCode,
        });
        result.sendFailures += 1;
        continue;
      }
      const res = await deps.sendTelegram(buildTelegramPayload(group));
      if (!res.ok) {
        result.sendFailures += 1;
        continue; // leave notified_at NULL — retried next tick (FR-OF-007)
      }
      result.sent += 1;
    } else {
      result.suppressed += 1;
    }

    if (group.ids.length > 0) {
      // FR-HRD-001: the stamp result is INSPECTED, not discarded.
      const stamp = await deps.stampNotified(group.ids, nowIso);
      if (stamp.error) {
        result.stampFailures += 1;
        logStructuredError({
          fn: 'telegram-notify',
          errorCode: 'NOTIFY_STAMP_FAILED',
          contextId: group.errorCode,
        });
      }
    }
  }

  // FR-HRD-010 liveness: a quiet tick must still prove the path is alive. If nothing went out and
  // it has been longer than livenessIntervalHours since the last outbound message, send an
  // all-clear. Silence in Telegram then means BROKEN, not "no errors".
  const beat = await deps.readHeartbeat('telegram-notify');
  const lastOutbound = beat?.last_success_at;
  if (result.sent === 0 && shouldSendLiveness(nowIso, lastOutbound, deps.livenessIntervalHours)) {
    const ping = await deps.sendTelegram({
      text: `*Alert path OK* — drain ran at ${nowIso}, no unnotified errors.`,
      parse_mode: 'Markdown',
    });
    if (ping.ok) result.livenessPinged = true;
  }
  if (result.sent > 0 || result.livenessPinged) {
    const hb = await deps.writeHeartbeat('telegram-notify', nowIso, {
      sent: result.sent, liveness: result.livenessPinged,
    });
    if (hb.error) {
      logStructuredError({ fn: 'telegram-notify', errorCode: 'HEARTBEAT_WRITE_FAILED' });
    }
  }

  return result;
}

/**
 * shouldSendLiveness — pure. True when no outbound message has gone out for longer than
 * `intervalHours` (or ever). Deliberately independent of the cron cadence (AS-2): tightening the
 * tick from hourly must not change how often the all-clear fires.
 */
export function shouldSendLiveness(
  nowIso: string,
  lastOutboundIso: string | undefined,
  intervalHours: number,
): boolean {
  if (!lastOutboundIso) return true;
  const elapsedH = (new Date(nowIso).getTime() - new Date(lastOutboundIso).getTime()) / 3_600_000;
  return elapsedH >= intervalHours;
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/telegramDrain.test.ts` → 3 passing.
**Covers:** AC-HRD-001 (Unit), FR-HRD-001, FR-HRD-002.

---

### Task A5 — Unit test for the liveness all-clear

Append to `pmo-portal/src/lib/agent/telegramDrain.test.ts`:

```ts
import { shouldSendLiveness } from '../../../../supabase/functions/telegram-notify/logic';

describe('shouldSendLiveness (FR-HRD-010)', () => {
  it('AC-HRD-010: never pinged before -> ping (the alert path has never proven itself alive)', () => {
    expect(shouldSendLiveness('2026-07-25T12:00:00.000Z', undefined, 24)).toBe(true);
  });

  it('AC-HRD-010: last outbound 25h ago -> ping', () => {
    expect(shouldSendLiveness('2026-07-25T12:00:00.000Z', '2026-07-24T11:00:00.000Z', 24)).toBe(true);
  });

  it('AC-HRD-010: last outbound 2h ago -> no ping (silence is still informative)', () => {
    expect(shouldSendLiveness('2026-07-25T12:00:00.000Z', '2026-07-25T10:00:00.000Z', 24)).toBe(false);
  });
});

describe('runDrain liveness (FR-HRD-010)', () => {
  it('AC-HRD-010: a quiet tick with a stale heartbeat sends an all-clear and stamps the heartbeat', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const writeHeartbeat = vi.fn(async () => ({ error: null }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => ({ last_success_at: '2026-07-23T12:00:00.000Z' }),
      sendTelegram,
      writeHeartbeat,
    }));
    expect(r.livenessPinged).toBe(true);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(writeHeartbeat).toHaveBeenCalledWith('telegram-notify', expect.any(String), expect.anything());
  });

  it('AC-HRD-010: a quiet tick with a FRESH heartbeat stays silent', async () => {
    const sendTelegram = vi.fn(async () => ({ ok: true }));
    const r = await runDrain(deps({
      selectUnnotified: async () => [],
      readHeartbeat: async () => ({ last_success_at: '2026-07-25T11:00:00.000Z' }),
      sendTelegram,
    }));
    expect(r.livenessPinged).toBe(false);
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});
```

**RED:** `shouldSendLiveness` and the liveness branch do not exist before A4 — write these tests
first (before A4's liveness block) and watch them fail, then add the block.
**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/telegramDrain.test.ts`
**Covers:** AC-HRD-010 *(PROPOSED)*, FR-HRD-010.

---

### Task A6 — Rewire `telegram-notify/index.ts` to call `runDrain`

Replace `supabase/functions/telegram-notify/index.ts:51-107` (the whole `try` block up to and
including the `return new Response(JSON.stringify({ ok: true }), …)`) with:

```ts
  try {
    const drain = await runDrain({
      now: () => new Date(),
      cooldownSec,
      livenessIntervalHours: Number(Deno.env.get('LIVENESS_INTERVAL_HOURS') ?? '24'),
      selectUnnotified: async () => {
        const { data } = await serviceClient
          .from('error_events')
          .select('id, error_code, fn, context_id, org_id, created_at')
          .is('notified_at', null);
        return (data ?? []) as ErrorEventRow[];
      },
      selectLastSentByCode: async () => {
        const { data } = await serviceClient
          .from('alert_send_log')
          .select('error_code, last_sent_at');
        const out: Record<string, string | undefined> = {};
        for (const r of (data ?? []) as { error_code: string; last_sent_at: string }[]) {
          out[r.error_code] = r.last_sent_at;
        }
        return out;
      },
      recordSendAhead: (errorCode, atIso) =>
        serviceClient.from('alert_send_log').upsert(
          { error_code: errorCode, last_sent_at: atIso },
          { onConflict: 'error_code' },
        ),
      sendTelegram: async (payload) => {
        if (!botToken || !chatId) {
          logStructuredError({ fn: 'telegram-notify', errorCode: 'TELEGRAM_SECRET_MISSING' });
          return { ok: false };
        }
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, chat_id: chatId }),
        });
        return { ok: res.ok };
      },
      stampNotified: (ids, atIso) =>
        serviceClient.from('error_events').update({ notified_at: atIso }).in('id', ids),
      readHeartbeat: async (job) => {
        const { data } = await serviceClient
          .from('ops_job_heartbeats')
          .select('last_success_at')
          .eq('job_name', job)
          .maybeSingle();
        return (data as { last_success_at: string } | null) ?? null;
      },
      writeHeartbeat: (job, atIso, detail) =>
        serviceClient.from('ops_job_heartbeats').upsert(
          { job_name: job, last_success_at: atIso, last_detail: detail },
          { onConflict: 'job_name' },
        ),
    });

    await pingHeartbeat(heartbeatUrl);
    return new Response(JSON.stringify({ ok: true, ...drain }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
```

Update the import at `index.ts:16-20` to `import { runDrain, pingHeartbeat } from './logic.ts';`
plus `import type { ErrorEventRow } from './logic.ts';`. Delete the now-unused
`groupIntoMessages` / `buildTelegramPayload` imports.

> `.maybeSingle()`, not `.single()` — `.single()` returns 406 on zero rows, which is exactly the
> live-prod bug fixed in PR #234 on `agent_runs`.

**Verify:** `cd pmo-portal && npm run typecheck:edge`
**Covers:** FR-HRD-001, FR-HRD-002, FR-HRD-010 (wiring).

---

### Task A7 — RED: unit test for the swallowed `notifyOwner` failure

Create `pmo-portal/src/lib/agent/notifyOwner.test.ts`:

```ts
/**
 * §4.4 / FR-HRD-020 — agent-dispatch's owner notification is doubly silent today:
 *   dispatcher.ts:288-306 uses a bare `catch {}` with no binding, AND casts `insert` to
 *   `Promise<{ error: unknown }>` without ever destructuring `error` — so the ORDINARY
 *   supabase-js failure mode (resolve with error populated) is dropped BEFORE the catch applies.
 * Both call sites (:435 condition-unevaluable, :447 over-credit) are fail-quiet-but-visible paths,
 * so a swallowed failure means the owner is never told — defeating the entire purpose of the path.
 */
import { describe, it, expect, vi } from 'vitest';
import { notifyOwner } from '../../../../supabase/functions/agent-dispatch/dispatcher';

describe('notifyOwner', () => {
  it('AC-HRD-020: an insert that RESOLVES with a Postgres error is logged as NOTIFY_INSERT_FAILED', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = { from: () => ({ insert: async () => ({ error: { code: '42501' } }) }) };

    const ok = await notifyOwner(client, 'warning', 'title', 'body', { automation_id: 'a1' });

    expect(ok).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      '[agent-dispatch] NOTIFY_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'NOTIFY_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-HRD-020: a THROWN insert is logged too, and still never rethrown', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = { from: () => ({ insert: async () => { throw new Error('connection refused'); } }) };

    await expect(notifyOwner(client, 'warning', 't', null, null)).resolves.toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      '[agent-dispatch] NOTIFY_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'NOTIFY_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-HRD-020: the happy path reports success', async () => {
    const client = { from: () => ({ insert: async () => ({ error: null }) }) };
    await expect(notifyOwner(client, 'info', 't', null, null)).resolves.toBe(true);
  });
});
```

**RED — how to see it fail:** `notifyOwner` is currently **not exported** and returns
`Promise<void>`, so test 1 fails on the import, and even after exporting it, test 1 fails because
`ok` is `undefined` and `console.error` was never called — the resolve-with-error path never reaches
the `catch`. Run the suite with only `export` added to `dispatcher.ts:293` to see the *behavioural*
red, not just an import red. Record that run in the PR description.

**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/notifyOwner.test.ts` → failing.
**Covers:** AC-HRD-020 *(PROPOSED)*, FR-HRD-020.

---

### Task A8 — GREEN: `notifyOwner` reports its failure

Replace `supabase/functions/agent-dispatch/dispatcher.ts:288-306` with:

```ts
/**
 * Insert an owner notification via the MINTED owner client (RLS pins owner_id/org_id via DEFAULT —
 * never sent). Used for the fail-quiet-but-visible warning paths (condition-unevaluable §4;
 * over-credit §6).
 *
 * FR-HRD-020: a notify failure must not abort the tick, but it must NOT be silent either. Both
 * supabase-js failure modes are handled — the resolve-with-`error` shape (the ordinary one, which
 * the previous bare `catch {}` could never see) and a thrown rejection. Returns whether the
 * notification landed; never throws.
 */
export async function notifyOwner(
  mintedClient: unknown,
  severity: 'info' | 'warning' | 'critical',
  title: string,
  body: string | null,
  metadata: Record<string, unknown> | null,
): Promise<boolean> {
  try {
    const sb = mintedClient as { from: (t: string) => { insert: (r: Record<string, unknown>) => Promise<{ error: unknown }> } };
    const { error } = await sb.from('notifications').insert({ severity, title, body, metadata });
    if (error) {
      logStructuredError({
        fn: 'agent-dispatch',
        errorCode: 'NOTIFY_INSERT_FAILED',
        contextId: (error as { code?: string }).code,
      });
      return false;
    }
    return true;
  } catch (err) {
    logStructuredError({
      fn: 'agent-dispatch',
      errorCode: 'NOTIFY_INSERT_FAILED',
      contextId: err instanceof Error ? err.name : 'unknown',
    });
    return false;
  }
}
```

Both call sites (`dispatcher.ts:435` and `:447`) stay `await notifyOwner(...)` — the return value is
deliberately unused there; the log is the signal. Do **not** change the `continue` control flow.

**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/notifyOwner.test.ts && npm run typecheck:edge`
**Covers:** AC-HRD-020 *(PROPOSED)*, FR-HRD-020.

---

### Task A9 — Slice A gate

```bash
cd pmo-portal && npm run verify
```
Then from the repo root: `scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db`.

Open PR-1 → `dev`. In the PR body: paste the A3 and A7 red evidence, and raise **AS-2** (hourly
cadence) as a question for the owner.

---

## 4. Slice B (PR-2) — Money & concurrency · spec §4.6

Branch: `fix/money-concurrency-hardening`.

### Task B1 — RED: pgTAP 0161 for the negative contract value

Create `supabase/tests/0161_contract_value_nonneg.test.sql`:

```sql
-- 0161_contract_value_nonneg.test.sql
-- FR-HRD-040 [pgTAP]: set_project_contract_value must reject negatives with a good error message,
-- AND the underlying column must carry the CHECK that is the actual authority. The RPC guard alone
-- is not enough: any other writer (an RPC added later, a service_role backfill) bypasses it.
-- Evidence of the gap: 0076_audit_events.sql:212 updates contract_value with no sign check, and
-- projects.contract_value has no CHECK constraint.
begin;
select plan(4);

insert into organizations (id, name) values
  ('01610000-0000-0000-0000-000000000001','FR-HRD-040 Org');
insert into auth.users (id, email) values
  ('01610000-0000-0000-0000-0000000000a1','money-guard@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01610000-0000-0000-0000-0000000000a1','01610000-0000-0000-0000-000000000001',
   'Money Guard','money-guard@example.com','Executive');
insert into projects (id, org_id, name, status) values
  ('01610000-0000-0000-0000-0000000000b1','01610000-0000-0000-0000-000000000001',
   'FR-HRD-040 Project','Won, Pending KoM');

-- 1. The column-level CHECK exists and is the authority (owner role bypasses RLS + the RPC).
select has_check('public','projects','FR-HRD-040 projects has a CHECK constraint on contract_value');
select throws_ok(
  $$ update public.projects set contract_value = -1
      where id = '01610000-0000-0000-0000-0000000000b1' $$,
  '23514', null,
  'FR-HRD-040 a direct UPDATE to a negative contract_value violates the CHECK');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"01610000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- 2. The RPC rejects the negative with the CHECK-violation errcode (maps to the existing toast).
select throws_ok(
  $$ select set_project_contract_value('01610000-0000-0000-0000-0000000000b1'::uuid, -500) $$,
  '23514', null,
  'FR-HRD-040 set_project_contract_value rejects a negative value');

-- 3. No behaviour regression: a valid value still writes.
select lives_ok(
  $$ select set_project_contract_value('01610000-0000-0000-0000-0000000000b1'::uuid, 500) $$,
  'FR-HRD-040 a non-negative value is still accepted (no regression)');

reset role;
select * from finish();
rollback;
```

**RED — how to see it fail:** run this **before** migration 0168 exists.
`scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db` → assertions
1, 2 and 3 fail (`has_check` false; both `throws_ok` report "died" vs the expected 23514 because the
negative UPDATE *succeeds*). That is the defect, demonstrated.
**Verify:** `scripts/with-db-lock.sh supabase test db`
**Covers:** FR-HRD-040 (pgTAP).

---

### Task B2 — GREEN: migration 0168 — CHECK + RPC sign guard

Create `supabase/migrations/0168_contract_value_nonneg.sql`:

```sql
-- 0168_contract_value_nonneg.sql — FR-HRD-040.
-- Two halves, one task: the RPC guard gives the good error message, the CHECK constraint is the
-- authority. The RPC body is copied verbatim from 0076_audit_events.sql:170-219 (the current
-- canonical definition — it supersedes 0014 by adding v_old + the log_audit call). The ONLY change
-- is the p_value sign guard immediately after `begin`. All org/role/status SoD guards are intact.
--
-- Guard placement: FIRST, before the row load. A negative value is input validation and reveals
-- nothing about the project, so ordering leaks no information; putting it first means an obviously
-- invalid write never takes a row lock.
--
-- The CHECK is added NOT VALID then VALIDATEd in the same migration: NOT VALID enforces on all new
-- writes without a table scan, VALIDATE then proves no existing row violates it. If VALIDATE fails,
-- the migration fails LOUDLY — which is the correct outcome, because it means production already
-- holds a negative contract value that needs a human decision.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   alter table public.projects drop constraint projects_contract_value_nonneg;
--   -- then re-apply the 0076 body of set_project_contract_value verbatim.

alter table public.projects
  add constraint projects_contract_value_nonneg
  check (contract_value is null or contract_value >= 0) not valid;

alter table public.projects validate constraint projects_contract_value_nonneg;

create or replace function set_project_contract_value(p_id uuid, p_value numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org    uuid;
  v_old    numeric;
  v_role   user_role := auth_role();
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  -- FR-HRD-040: reject negatives here for the human-readable message; the column CHECK is the
  -- authority for every other writer.
  if p_value is not null and p_value < 0 then
    raise exception 'contract value cannot be negative' using errcode = '23514';
  end if;

  select status, org_id, contract_value
    into v_status, v_org, v_old
    from public.projects where id = p_id for update;
  if v_status is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this role/status gate MUST stay (ADR-0019 SoD).
  if v_status::text = any(v_on_hand) then
    if v_role is null or v_role not in ('Admin','Executive','Finance') then
      raise exception 'changing the contract value on a won project requires Executive or Finance'
        using errcode = '42501';
    end if;
  else
    if v_role is null or v_role not in ('Admin','Executive','Project Manager') then
      raise exception 'not authorized to set the contract value' using errcode = '42501';
    end if;
  end if;

  update public.projects
    set contract_value = p_value,
        last_update    = now()
  where id = p_id;

  perform public.log_audit('project.contract_value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value));
end; $$;
```

**Verify:** `scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db`
→ 0161 green (4/4).
**Covers:** FR-HRD-040.

---

### Task B3 — RED: pgTAP 0162 for the automation-cap race

Create `supabase/tests/0162_automation_cap_race.test.sql`:

```sql
-- 0162_automation_cap_race.test.sql
-- FR-HRD-041 [pgTAP]: enforce_automation_owner_cap must not be a bare count-then-insert.
-- Evidence: 0059_agent_automation_bounds.sql:31 counts with no lock; two concurrent inserts can both
-- observe a count below the cap. 0059's own comment names the fix ("row-lock the owner's profile row
-- here if an exact cap ever matters"). The SHARE ROW EXCLUSIVE exemplar at 0065_admin_set_user_status.sql:69
-- shows the intended pattern -- note 0065:69 is the EXEMPLAR, not the defect.
--
-- HONESTY NOTE (read before trusting this test): assertions 1-2 prove the serializing lock is PRESENT
-- and that the function is security definer (so RLS cannot silently hide the row and skip the lock).
-- They do NOT prove the race is closed under true concurrency -- that needs two sessions (dblink /
-- pg_background), which this stack does not have enabled. Tracked as a follow-up in the plan's §8.
-- Assertion 3 is the no-regression check.
begin;
select plan(3);

select matches(
  pg_get_functiondef('public.enforce_automation_owner_cap()'::regprocedure),
  'for update',
  'FR-HRD-041 the cap trigger takes a row lock before counting (no bare count-then-insert)');

select is(
  (select prosecdef from pg_proc where oid = 'public.enforce_automation_owner_cap()'::regprocedure),
  true,
  'FR-HRD-041 the cap trigger is security definer (RLS cannot hide the owner row and skip the lock)');

-- No regression: the cap still fires.
insert into organizations (id, name) values
  ('01620000-0000-0000-0000-000000000001','FR-HRD-041 Org');
insert into auth.users (id, email) values
  ('01620000-0000-0000-0000-0000000000a1','cap-race@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('01620000-0000-0000-0000-0000000000a1','01620000-0000-0000-0000-000000000001',
   'Cap Race','cap-race@example.com','Admin');

insert into public.agent_automations (org_id, owner_id, kind, prompt, timeout_s)
select '01620000-0000-0000-0000-000000000001',
       '01620000-0000-0000-0000-0000000000a1',
       'schedule', 'cap fill ' || g, 120
  from generate_series(1,25) g;

select throws_ok(
  $$ insert into public.agent_automations (org_id, owner_id, kind, prompt, timeout_s)
     values ('01620000-0000-0000-0000-000000000001',
             '01620000-0000-0000-0000-0000000000a1','schedule','over cap',120) $$,
  'P0001', null,
  'FR-HRD-041 the 26th active automation for an owner is still rejected (no regression)');

select * from finish();
rollback;
```

> If `agent_automations` requires columns beyond those listed, read
> `supabase/migrations/0048_agent_automations_notifications.sql` and add the NOT NULL columns to both
> inserts — do not weaken the assertions.

**RED — how to see it fail:** run before 0169. Assertions 1 and 2 fail (`pg_get_functiondef` has no
`for update`; `prosecdef` is `false`). Assertion 3 passes both before and after — it is deliberately
the regression guard, not the proof.
**Verify:** `scripts/with-db-lock.sh supabase test db`
**Covers:** FR-HRD-041 (pgTAP).

---

### Task B4 — GREEN: migration 0169 — serialize the owner cap

Create `supabase/migrations/0169_automation_cap_race.sql`:

```sql
-- 0169_automation_cap_race.sql — FR-HRD-041.
-- 0059's trigger counted active automations with no lock, so two concurrent inserts for the same
-- owner could both observe a count below the cap and both succeed. 0059's own comment names this:
-- "count-then-insert trigger is not serialization-proof ... row-lock the owner's profile row here if
-- an exact cap ever matters."
--
-- Fix: take a ROW lock on the owner's profiles row before counting. Per-owner, not the table-wide
-- SHARE ROW EXCLUSIVE of the 0065 exemplar -- this runs on every automation INSERT, and a table lock
-- there would serialize unrelated owners' writes for no benefit.
--
-- SECURITY DEFINER is required, not cosmetic: profiles carries RLS, and a non-definer trigger could
-- find zero rows for a legitimate owner, take NO lock, and silently reinstate the race. The explicit
-- NOT FOUND check turns that failure mode into an error instead of a silent no-op.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback = re-apply 0059's function body.

create or replace function enforce_automation_owner_cap()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  select id into v_owner from public.profiles where id = new.owner_id for update;
  if v_owner is null then
    raise exception 'unknown automation owner' using errcode = '23503';
  end if;

  if (select count(*) from public.agent_automations
        where owner_id = new.owner_id and archived_at is null) >= 25 then
    raise exception 'automation limit reached (25 active per owner)' using errcode = 'P0001';
  end if;
  return new;
end; $$;

revoke all on function public.enforce_automation_owner_cap() from public;
```

**Verify:** `scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db`
→ 0162 green (3/3).
**Covers:** FR-HRD-041.

---

### Task B5 — `spike-rls.yml` uses `npm ci` (and can)

Two edits, both required — `npm ci` **fails without a lockfile**, and
`spike/agent-native-rls/.gitignore:3` currently ignores `package-lock.json`.

1. Edit `spike/agent-native-rls/.gitignore` — delete line 3 (`package-lock.json`), leaving:

```gitignore
node_modules/
drizzle/
*.log
```

2. Generate and commit the lockfile:

```bash
cd spike/agent-native-rls && npm install --package-lock-only && git add -f package-lock.json
```

3. Edit `.github/workflows/spike-rls.yml:67-69`:

```yaml
      - name: Install spike deps
        working-directory: spike/agent-native-rls
        run: npm ci
```

**RED — how to see it fail:** before edit 1+2, run `cd spike/agent-native-rls && npm ci`. It exits
non-zero: *"The `npm ci` command can only install with an existing package-lock.json"*. That is the
proof the one-line workflow change alone would have red-lit the spike lane.
**Verify:** `cd spike/agent-native-rls && npm ci` exits 0; `git ls-files spike/agent-native-rls/package-lock.json` prints the path.
**Covers:** FR-HRD-043.

---

### Task B6 — Slice B gate

```bash
cd pmo-portal && npm run verify
```
Then from the repo root: `scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db`.

Open PR-2 → `dev`. In the PR body: state explicitly that **FR-HRD-042 (interactive-create
idempotency) is NOT in this PR** and link §8.

---

## 5. Slice C (PR-3) — Edge error coverage · spec §3.1

Branch: `feat/edge-error-coverage`. Design: **ADR-0066**.

### Task C1 — RED: the union must enumerate every deployed function

Create `pmo-portal/src/lib/agent/edgeFunctionNames.test.ts`:

```ts
/**
 * FR-OBS-002 — the `EdgeFunctionName` union is the blocking seam for the whole observability floor:
 * a function not in it CANNOT call logStructuredError without a type error. It listed 5 names while
 * 22 functions were deployed, so 17 functions were structurally unable to report anything.
 *
 * This test compares the union's backing array against the ACTUAL directory listing, so the gap
 * cannot silently reopen when the 23rd function ships.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EDGE_FUNCTION_NAMES } from '../../../../supabase/functions/_shared/errorLog';

const FUNCTIONS_DIR = resolve(__dirname, '../../../../supabase/functions');

function deployedFunctionDirs(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .filter((d) => existsSync(resolve(FUNCTIONS_DIR, d.name, 'index.ts')))
    .map((d) => d.name)
    .sort();
}

describe('EdgeFunctionName', () => {
  it('AC-OBS-002: enumerates EVERY deployed edge function, not a subset', () => {
    expect([...EDGE_FUNCTION_NAMES].sort()).toEqual(deployedFunctionDirs());
  });
});
```

**RED — how to see it fail:** `EDGE_FUNCTION_NAMES` does not exist yet, so add only the export of the
current 5 names first and run: the assertion fails with a 5-vs-22 diff naming all 17 missing
functions. Paste that diff into the PR as the red evidence.
**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/edgeFunctionNames.test.ts`
**Covers:** AC-OBS-002 *(PROPOSED)*, FR-OBS-002.

---

### Task C2 — GREEN: widen the union

Replace `supabase/functions/_shared/errorLog.ts:22-27` with:

```ts
/**
 * Every deployed edge function. Derived union (FR-OBS-002) — kept in lockstep with the actual
 * supabase/functions/*/index.ts listing by pmo-portal/src/lib/agent/edgeFunctionNames.test.ts.
 * Add the name here in the SAME commit that adds the function directory.
 */
export const EDGE_FUNCTION_NAMES = [
  'adapter-dispatch',
  'admin-invite-user',
  'agent-chat',
  'agent-dispatch',
  'clickup-onboard',
  'clickup-sweep',
  'clickup-webhook',
  'clickup-webhook-worker',
  'compose-view',
  'erpnext-onboard',
  'erpnext-sweep',
  'erpnext-webhook',
  'external-companies',
  'external-connect',
  'external-disconnect',
  'external-link',
  'external-lists',
  'external-set-company',
  'external-unlink',
  'health',
  'm365-token-custody',
  'telegram-notify',
] as const;

export type EdgeFunctionName = (typeof EDGE_FUNCTION_NAMES)[number];
```

Also update the file header's parenthetical at `errorLog.ts:2-3` from the five-name list to
"every deployed edge function (see `EDGE_FUNCTION_NAMES`)".

**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/edgeFunctionNames.test.ts && npm run typecheck:edge`
**Covers:** AC-OBS-002 *(PROPOSED)*, FR-OBS-002.

---

### Task C3 — The `error_events` sink that needs no injected client

Create `supabase/functions/_shared/errorEventSink.ts`:

```ts
/**
 * errorEventSink — a service-role writer for public.error_events implemented over `fetch` against
 * PostgREST, satisfying the SAME structural interface `recordErrorEvent` already accepts
 * (ErrorEventSupabaseLike). ADR-0066 §4.
 *
 * Why fetch and not supabase-js: this module is reachable from EVERY edge function, including ones
 * that do not otherwise import supabase-js (e.g. `health`). Reusing recordErrorEvent verbatim keeps
 * one insert code path; the structural interface is what makes that free.
 *
 * Returns `null` when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent — the caller MUST treat
 * that as a visible degradation (ERROR_EVENT_SINK_UNAVAILABLE), never a silent skip.
 * Deno-only: in Vitest `Deno` is undefined, so this returns null and stays offline unless a test
 * explicitly supplies env + a stubbed fetch.
 */
import type { ErrorEventSupabaseLike } from './errorEvent.ts';

export function createServiceRoleErrorEventSink(
  env?: { url?: string; serviceRoleKey?: string },
): ErrorEventSupabaseLike | null {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  const url = env?.url ?? deno?.env.get('SUPABASE_URL');
  const key = env?.serviceRoleKey ?? deno?.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;

  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/error_events`;

  return {
    from() {
      return {
        async insert(row) {
          try {
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: key,
                Authorization: `Bearer ${key}`,
                Prefer: 'return=minimal',
              },
              body: JSON.stringify(row),
            });
            if (!res.ok) return { error: { code: String(res.status) } };
            return { error: null };
          } catch (err) {
            return { error: { code: err instanceof Error ? err.name : 'unknown' } };
          }
        },
      };
    },
  };
}
```

**Verify:** `cd pmo-portal && npm run typecheck:edge`
**Covers:** FR-OBS-001 (enabling).

---

### Task C4 — Unit test for the sink

Create `pmo-portal/src/lib/agent/errorEventSink.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServiceRoleErrorEventSink } from '../../../../supabase/functions/_shared/errorEventSink';

afterEach(() => vi.unstubAllGlobals());

describe('createServiceRoleErrorEventSink', () => {
  it('AC-OBS-001: returns null when the service-role env is absent (caller must report, not skip)', () => {
    expect(createServiceRoleErrorEventSink({})).toBeNull();
  });

  it('AC-OBS-001: POSTs the row to PostGREST with the service-role headers', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const sink = createServiceRoleErrorEventSink({ url: 'https://db.example/', serviceRoleKey: 'srk' })!;
    const res = await sink.from('error_events').insert({ fn: 'erpnext-sweep', error_code: 'X' });

    expect(res.error).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://db.example/rest/v1/error_events');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer srk');
    expect(init.body).toBe(JSON.stringify({ fn: 'erpnext-sweep', error_code: 'X' }));
  });

  it('AC-OBS-001: a non-2xx PostGREST response is surfaced as an error, never swallowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));
    const sink = createServiceRoleErrorEventSink({ url: 'https://db.example', serviceRoleKey: 'srk' })!;
    expect(await sink.from('error_events').insert({ fn: 'health', error_code: 'X' }))
      .toEqual({ error: { code: '403' } });
  });
});
```

**RED:** module does not exist before C3; write this test first, watch it fail on the import, then C3.
**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/errorEventSink.test.ts`
**Covers:** AC-OBS-001 *(PROPOSED)*.

---

### Task C5 — `reportEdgeError` + `serveWithErrorReporting`

Create `supabase/functions/_shared/reportEdgeError.ts`:

```ts
/**
 * reportEdgeError — the ONE call every edge function makes when something fails (ADR-0066).
 * Fans one failure into all three surfaces:
 *   1. a structured console line (greppable in function logs),
 *   2. a PostHog $exception (triage surface, via logStructuredError -> capturePosthogException),
 *   3. an error_events row (the SYSTEM OF RECORD -- tenant-joinable, retained on our terms).
 *
 * The error_events client is injected when the caller already has a service-role client (preserving
 * the deputy invariant for agent-dispatch et al.); otherwise a fetch-based service-role sink is
 * built lazily. An UNAVAILABLE sink is reported, never silently skipped.
 */
import { logStructuredError, type EdgeFunctionName } from './errorLog.ts';
import { recordErrorEvent, type ErrorEventSupabaseLike } from './errorEvent.ts';
import { createServiceRoleErrorEventSink } from './errorEventSink.ts';

export interface ReportEdgeErrorContext {
  fn: EdgeFunctionName;
  errorCode: string;
  contextId?: string;
  orgId?: string;
}

let cachedSink: ErrorEventSupabaseLike | null | undefined;

export async function reportEdgeError(
  ctx: ReportEdgeErrorContext,
  supabase?: ErrorEventSupabaseLike,
): Promise<void> {
  logStructuredError({ fn: ctx.fn, errorCode: ctx.errorCode, contextId: ctx.contextId });

  if (cachedSink === undefined) cachedSink = createServiceRoleErrorEventSink();
  const sink = supabase ?? cachedSink;
  if (!sink) {
    logStructuredError({ fn: ctx.fn, errorCode: 'ERROR_EVENT_SINK_UNAVAILABLE' });
    return;
  }
  await recordErrorEvent(sink, ctx);
}

/** @internal test seam — clears the memoized sink between tests. */
export function __resetSinkForTests(): void {
  cachedSink = undefined;
}
```

Create `supabase/functions/_shared/serveWithErrorReporting.ts`:

```ts
/**
 * serveWithErrorReporting — the single entry point every edge function uses instead of Deno.serve
 * (ADR-0066 §2). It catches whatever the handler throws, reports it through reportEdgeError, and
 * returns a stable 500 -- so an UNHANDLED failure is recorded, not just the catches somebody
 * remembered to write (FR-OBS-001).
 *
 * A function's own inner try/catch still runs first and is unchanged; this is the outermost net.
 * `scripts/check-edge-fn-error-reporting.mjs` (wired into `npm run verify`) makes bypassing this
 * wrapper a build failure.
 */
import { reportEdgeError } from './reportEdgeError.ts';
import type { EdgeFunctionName } from './errorLog.ts';

export function serveWithErrorReporting(
  fn: EdgeFunctionName,
  handler: (req: Request) => Response | Promise<Response>,
): void {
  Deno.serve(async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      await reportEdgeError({
        fn,
        errorCode: 'UNHANDLED_EDGE_ERROR',
        contextId: err instanceof Error ? err.name : 'unknown',
      });
      return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });
}
```

**Verify:** `cd pmo-portal && npm run typecheck:edge`
**Covers:** FR-OBS-001.

---

### Task C6 — RED: the CI gate that proves every function is wired

Create `scripts/check-edge-fn-error-reporting.mjs`:

```js
#!/usr/bin/env node
/**
 * Guard: every deployed edge function MUST route its entry point through serveWithErrorReporting
 * (ADR-0066 §3, FR-OBS-001/002).
 *
 * Why this exists (2026-07-25): v0.8.0's deploy revealed that adapter-dispatch had been serving an
 * 8-day-old build and 11 functions had NEVER been deployed -- and nothing alerted anyone, because
 * only 4 of 22 functions produced error_events at all. Hand-wiring 22 functions fixes today; this
 * gate is what stops the 23rd shipping unwired.
 *
 * Run: node scripts/check-edge-fn-error-reporting.mjs   (paths resolve from this script)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = resolve(REPO, 'supabase/functions');

const dirs = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name)
  .filter((name) => existsSync(resolve(FUNCTIONS, name, 'index.ts')))
  .sort();

let failed = false;
const fail = (file, msg) => { console.error(`✗ ${file}\n    ${msg}`); failed = true; };

for (const name of dirs) {
  const file = `supabase/functions/${name}/index.ts`;
  const src = readFileSync(resolve(FUNCTIONS, name, 'index.ts'), 'utf8');

  if (!/serveWithErrorReporting/.test(src)) {
    fail(file, `must serve through serveWithErrorReporting('${name}', handler) -- an unwired function cannot report any failure`);
    continue;
  }
  if (!new RegExp(`serveWithErrorReporting\\(\\s*['"]${name}['"]`).test(src)) {
    fail(file, `serveWithErrorReporting must be called with the function's OWN name '${name}' (a copy-pasted name misattributes every error)`);
  }
  if (/(^|[^.\w])Deno\.serve\s*\(/m.test(src)) {
    fail(file, 'bare Deno.serve( bypasses the error-reporting wrapper -- use serveWithErrorReporting');
  }
}

if (failed) {
  console.error('\nEvery edge function must route its entry point through serveWithErrorReporting (docs/adr/0066).');
  process.exit(1);
}
console.log(`✓ edge fns route through serveWithErrorReporting (${dirs.length}/${dirs.length})`);
```

**RED — how to see it fail:** `node scripts/check-edge-fn-error-reporting.mjs` from the repo root.
It exits 1 and names **all 22** functions. Paste that output into the PR as the red evidence for
FR-OBS-001.
**Verify:** `node scripts/check-edge-fn-error-reporting.mjs` (exit 1 at this point — expected)
**Covers:** AC-OBS-001 *(PROPOSED)*, FR-OBS-001.

---

### Task C7 — Wire the gate into `verify`

Edit `pmo-portal/package.json`:

```json
    "check:edge-error-reporting": "node ../scripts/check-edge-fn-error-reporting.mjs",
    "verify": "npm run check:migrations && npm run check:e2e-isolation && npm run check:edge-test-binding && npm run check:edge-error-reporting && npm run typecheck && npm run typecheck:edge && npm run lint:ci && npm run test && npm run build",
```

⚑ The parallel `fix/nul-grep-blindness` branch edits this same `verify` line. Resolve by keeping
**both** checks.

**Verify:** `cd pmo-portal && npm run check:edge-error-reporting` (exit 1 until C8 completes)
**Covers:** AC-OBS-001 *(PROPOSED)*.

---

### Task C8 — Wire all 22 functions (one edit each, ~2 min per function)

For each function below: add the import and replace the entry call. **Do the six
`import.meta.main`-guarded functions LAST** — `scripts/check-edge-fn-test-binding.mjs` also inspects
those files, and doing them last keeps that gate's output readable while the others churn.

Import line to add near the other `_shared` imports in each file:

```ts
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
```

**Group 1 — inline handler.** Replace `Deno.serve(` with `serveWithErrorReporting('<name>', ` and
change the trailing `});` of the `Deno.serve(...)` call to `});` (unchanged — only the opening line
moves). Line numbers on this commit:

| # | File | Line | New opening line |
|---|---|---|---|
| C8.1 | `supabase/functions/adapter-dispatch/index.ts` | 615 | `serveWithErrorReporting('adapter-dispatch', async (req: Request): Promise<Response> => {` |
| C8.2 | `supabase/functions/admin-invite-user/index.ts` | 39 | `serveWithErrorReporting('admin-invite-user', async (req: Request): Promise<Response> => {` |
| C8.3 | `supabase/functions/agent-chat/index.ts` | 73 | `serveWithErrorReporting('agent-chat', async (req: Request): Promise<Response> => {` |
| C8.4 | `supabase/functions/agent-dispatch/index.ts` | 43 | `serveWithErrorReporting('agent-dispatch', async (req: Request): Promise<Response> => {` |
| C8.5 | `supabase/functions/clickup-onboard/index.ts` | 132 | `serveWithErrorReporting('clickup-onboard', async (req: Request): Promise<Response> => {` |
| C8.6 | `supabase/functions/clickup-sweep/index.ts` | 264 | `serveWithErrorReporting('clickup-sweep', async (req: Request): Promise<Response> => {` |
| C8.7 | `supabase/functions/compose-view/index.ts` | 50 | `serveWithErrorReporting('compose-view', async (req: Request): Promise<Response> => {` |
| C8.8 | `supabase/functions/erpnext-onboard/index.ts` | 38 | `serveWithErrorReporting('erpnext-onboard', async (req: Request): Promise<Response> => {` |
| C8.9 | `supabase/functions/erpnext-sweep/index.ts` | 1751 | `serveWithErrorReporting('erpnext-sweep', async (req: Request): Promise<Response> => {` |
| C8.10 | `supabase/functions/erpnext-webhook/index.ts` | 382 | `serveWithErrorReporting('erpnext-webhook', async (req: Request): Promise<Response> => {` |
| C8.11 | `supabase/functions/external-disconnect/index.ts` | 67 | `serveWithErrorReporting('external-disconnect', async (req: Request): Promise<Response> => {` |
| C8.12 | `supabase/functions/health/index.ts` | 15 | `serveWithErrorReporting('health', (req: Request): Response => {` |
| C8.13 | `supabase/functions/m365-token-custody/index.ts` | 71 | `serveWithErrorReporting('m365-token-custody', async (req: Request): Promise<Response> => {` |
| C8.14 | `supabase/functions/telegram-notify/index.ts` | 24 | `serveWithErrorReporting('telegram-notify', async (req: Request): Promise<Response> => {` |

**Group 2 — `import.meta.main` + named handler.** Keep the `if (import.meta.main) {` guard; replace
only the inner line.

| # | File | Line | New line |
|---|---|---|---|
| C8.15 | `supabase/functions/clickup-webhook/index.ts` | 128 | `  serveWithErrorReporting('clickup-webhook', async (req: Request): Promise<Response> => {` |
| C8.16 | `supabase/functions/clickup-webhook-worker/index.ts` | 351 | `  serveWithErrorReporting('clickup-webhook-worker', async (req: Request): Promise<Response> => {` |
| C8.17 | `supabase/functions/external-companies/index.ts` | 324 | `  serveWithErrorReporting('external-companies', handleCompaniesRequest);` |
| C8.18 | `supabase/functions/external-connect/index.ts` | 456 | `  serveWithErrorReporting('external-connect', handleConnectRequest);` |
| C8.19 | `supabase/functions/external-link/index.ts` | 713 | `  serveWithErrorReporting('external-link', handleLinkRequest);` |
| C8.20 | `supabase/functions/external-lists/index.ts` | 326 | `  serveWithErrorReporting('external-lists', handleListsRequest);` |
| C8.21 | `supabase/functions/external-set-company/index.ts` | 346 | `  serveWithErrorReporting('external-set-company', handleSetCompanyRequest);` |
| C8.22 | `supabase/functions/external-unlink/index.ts` | 297 | `  serveWithErrorReporting('external-unlink', handleUnlinkRequest);` |

> ⚑ `scripts/check-edge-fn-test-binding.mjs:77` asserts *"if the file contains `Deno.serve(`, it must
> be guarded by `import.meta.main`"*. After C8 these six files contain no `Deno.serve(` at all, so
> that assertion is skipped — the `import.meta.main` guard **must still be kept** or importing the
> module in a test starts a server. Do not remove it.

**Verify after each function:** `node scripts/check-edge-fn-error-reporting.mjs` — the failure list
shrinks by one. After C8.22 it prints `✓ edge fns route through serveWithErrorReporting (22/22)`.
Then `cd pmo-portal && npm run typecheck:edge`.
**Covers:** AC-OBS-001 *(PROPOSED)*, FR-OBS-001.

---

### Task C9 — Slice C gate

```bash
cd pmo-portal && npm run verify
```
Plus the edge boot smoke, because C8 changed 22 module-init paths and a circular import has
TDZ-crashed a deployed worker before (`049d1e2`):

```bash
deno run --allow-all scripts/deno-boot-smoke.ts
```

Open PR-3 → `dev`.

---

## 6. Slice D (PR-4) — Pipeline self-report + retention · spec §3.2, §3.3

Branch: `feat/error-pipeline-self-report`. Depends on PR-3.

### Task D1 — RED: `recordErrorEvent` must report to its caller

Rewrite the three existing tests in `pmo-portal/src/lib/agent/errorEvent.test.ts` to assert the new
contract (this rewrite **is** the red — the current implementation returns `undefined`):

```ts
  it('AC-OBS-011: an insert rejection resolves to a FAILURE indicator (not void), never throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rejectingSupabase = {
      from: () => ({ insert: () => Promise.reject(new Error('connection refused')) }),
    };

    await expect(
      recordErrorEvent(rejectingSupabase as never, { fn: 'agent-chat', errorCode: 'MISSING_OPENROUTER_API_KEY' }),
    ).resolves.toEqual({ ok: false, code: 'Error' });

    expect(errSpy).toHaveBeenCalledWith(
      '[errorEvent] ERROR_EVENT_INSERT_FAILED',
      expect.objectContaining({ errorCode: 'ERROR_EVENT_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-OBS-011: the happy path resolves to a SUCCESS indicator and inserts the row', async () => {
    const insertSpy = vi.fn(() => Promise.resolve({ error: null }));
    const supabase = { from: () => ({ insert: insertSpy }) };

    await expect(
      recordErrorEvent(supabase as never, {
        fn: 'agent-dispatch', errorCode: 'DISPATCH_TICK_FAILED', contextId: 'run_abc', orgId: 'org_1',
      }),
    ).resolves.toEqual({ ok: true });

    expect(insertSpy).toHaveBeenCalledWith({
      fn: 'agent-dispatch', error_code: 'DISPATCH_TICK_FAILED', context_id: 'run_abc', org_id: 'org_1',
    });
  });

  it('AC-OBS-011: a resolve-with-Postgres-error ALSO reports failure (the swallow cannot return)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { from: () => ({ insert: () => Promise.resolve({ error: { code: '42501' } }) }) };

    await expect(
      recordErrorEvent(supabase as never, { fn: 'compose-view', errorCode: 'MISSING_OPENROUTER_API_KEY' }),
    ).resolves.toEqual({ ok: false, code: '42501' });
    errSpy.mockRestore();
  });
```

**RED — how to see it fail:** `cd pmo-portal && npx vitest run src/lib/agent/errorEvent.test.ts` →
all three fail with `expected undefined to deeply equal { ok: … }`. That is precisely the swallow:
the current function cannot distinguish success from failure to any caller.
**Verify:** as above → 3 failing.
**Covers:** AC-OBS-011 (Unit).

---

### Task D2 — GREEN: `recordErrorEvent` returns a result

Replace `supabase/functions/_shared/errorEvent.ts:26-51` with:

```ts
export type RecordErrorEventResult = { ok: true } | { ok: false; code: string };

/**
 * FR-OBS-011: reports insert success or failure to its caller. It still never THROWS (the caller's
 * real error path must not be perturbed) but it no longer returns `void` regardless of outcome --
 * that made a broken recorder indistinguishable from a healthy, quiet one.
 */
export async function recordErrorEvent(
  supabase: ErrorEventSupabaseLike,
  ctx: ErrorEventContext,
): Promise<RecordErrorEventResult> {
  const row: { fn: string; error_code: string; context_id?: string; org_id?: string } = {
    fn: ctx.fn,
    error_code: ctx.errorCode,
  };
  if (ctx.contextId !== undefined) row.context_id = ctx.contextId;
  if (ctx.orgId !== undefined) row.org_id = ctx.orgId;

  try {
    const { error } = await supabase.from('error_events').insert(row);
    if (error) {
      const code = (error as { code?: string }).code ?? 'unknown';
      console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
        errorCode: 'ERROR_EVENT_INSERT_FAILED',
        code,
      });
      return { ok: false, code };
    }
    return { ok: true };
  } catch (err) {
    const code = err instanceof Error ? err.name : 'unknown';
    console.error('[errorEvent] ERROR_EVENT_INSERT_FAILED', {
      errorCode: 'ERROR_EVENT_INSERT_FAILED',
      code,
    });
    return { ok: false, code };
  }
}
```

Update the file header's last sentence (`errorEvent.ts:5-6`) from "Swallows its own failure so the
caller's real error path is never perturbed (FR-OF-002)" to "Never throws, so the caller's real
error path is never perturbed (FR-OF-002) — but REPORTS the outcome (FR-OBS-011)."

**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/errorEvent.test.ts` → 3 passing.
**Covers:** AC-OBS-011 (Unit), FR-OBS-011.

---

### Task D3 — RED: a failed insert must reach PostHog

Create `pmo-portal/src/lib/agent/reportEdgeError.test.ts`:

```ts
/**
 * FR-OBS-010 / AC-OBS-010 — when the error_events INSERT fails, the failure must produce a
 * COUNTABLE signal outside the pipeline that is failing. Today it produces only a console line
 * inside the very function whose logs nobody aggregates.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const posthog = vi.hoisted(() => ({ capturePosthogException: vi.fn(async () => {}) }));
vi.mock('../../../../supabase/functions/_shared/posthogError', () => posthog);

import { reportEdgeError, __resetSinkForTests } from '../../../../supabase/functions/_shared/reportEdgeError';

afterEach(() => { __resetSinkForTests(); posthog.capturePosthogException.mockClear(); });

describe('reportEdgeError', () => {
  it('AC-OBS-010: an unwritable error_events emits ERROR_EVENT_INSERT_FAILED to PostHog, not just console', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unwritable = { from: () => ({ insert: async () => ({ error: { code: '42501' } }) }) };

    await reportEdgeError({ fn: 'erpnext-sweep', errorCode: 'ERP_PUSH_FAILED' }, unwritable as never);

    // The ORIGINAL error still reaches the triage surface...
    expect(posthog.capturePosthogException).toHaveBeenCalledWith(
      expect.objectContaining({ fn: 'erpnext-sweep', errorCode: 'ERP_PUSH_FAILED' }),
    );
    // ...AND the pipeline's own failure is separately countable.
    expect(posthog.capturePosthogException).toHaveBeenCalledWith(
      expect.objectContaining({ fn: 'erpnext-sweep', errorCode: 'ERROR_EVENT_INSERT_FAILED' }),
    );
    errSpy.mockRestore();
  });

  it('AC-OBS-010: an absent sink is REPORTED (ERROR_EVENT_SINK_UNAVAILABLE), never silently skipped', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await reportEdgeError({ fn: 'health', errorCode: 'X' }); // no injected client, no Deno env
    expect(posthog.capturePosthogException).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'ERROR_EVENT_SINK_UNAVAILABLE' }),
    );
    errSpy.mockRestore();
  });
});
```

**RED — how to see it fail:** test 1's second assertion fails — after PR-3, `reportEdgeError` awaits
`recordErrorEvent` but ignores its result, so no `ERROR_EVENT_INSERT_FAILED` exception is forwarded.
**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/reportEdgeError.test.ts` → 1 failing.
**Covers:** AC-OBS-010 (Unit).

---

### Task D4 — GREEN: forward the pipeline's own failure

Replace the tail of `reportEdgeError` (from `if (!sink)` onward) in
`supabase/functions/_shared/reportEdgeError.ts`:

```ts
  if (!sink) {
    // FR-OBS-010: a missing sink is a DEPLOY-CONFIG failure, and it must be countable on a surface
    // other than the one that is missing.
    logStructuredError({ fn: ctx.fn, errorCode: 'ERROR_EVENT_SINK_UNAVAILABLE' });
    return;
  }

  const written = await recordErrorEvent(sink, ctx);
  if (!written.ok) {
    // FR-OBS-010: the pipeline reports its OWN failure to PostHog. Without this, "no rows in
    // error_events" is ambiguous between a healthy quiet system and a dead recorder.
    logStructuredError({
      fn: ctx.fn,
      errorCode: 'ERROR_EVENT_INSERT_FAILED',
      contextId: written.code,
    });
  }
}
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/agent/reportEdgeError.test.ts` → 2 passing.
**Covers:** AC-OBS-010 (Unit), FR-OBS-010.

---

### Task D5 — RED: pgTAP 0164 for the retention purge

Create `supabase/tests/0164_error_events_retention.test.sql`:

```sql
-- 0164_error_events_retention.test.sql
-- AC-OBS-020 [pgTAP]: rows older than the retention window are deleted, rows inside it are untouched,
-- and the job records how many it deleted.
-- AC-OBS-021 [pgTAP]: a cron entry for the purge exists AND is enabled.
--
-- PAIRING NOTE (spec 3.3): "a schedule exists" is NOT the same as "the schedule works". 0071
-- registered a telegram-notify-tick that ran thousands of times with ZERO successes in production
-- because its GUCs were never set -- discovered only when 0083 replaced it. So AC-OBS-021 is paired
-- with an assertion that the job actually recorded a success into ops_job_heartbeats.
--
-- ASSUMPTION AS-1: the 90-day window is owner-confirmable, not settled. It lives in ONE default
-- argument and ONE cron literal.
begin;
select plan(6);

insert into public.error_events (fn, error_code, created_at) values
  ('erpnext-sweep','OLD_1',  now() - interval '120 days'),
  ('erpnext-sweep','OLD_2',  now() - interval '91 days'),
  ('erpnext-sweep','FRESH_1',now() - interval '89 days'),
  ('erpnext-sweep','FRESH_2',now());

select is(public.purge_error_events(90), 2,
  'AC-OBS-020 the purge deletes exactly the 2 rows outside the 90-day window and RETURNS the count');

select is((select count(*)::int from public.error_events where error_code like 'OLD_%'), 0,
  'AC-OBS-020 rows older than the window are gone');
select is((select count(*)::int from public.error_events where error_code like 'FRESH_%'), 2,
  'AC-OBS-020 rows inside the window are untouched');

select is(
  (select (last_detail->>'deleted')::int from public.ops_job_heartbeats
    where job_name = 'error-events-purge'),
  2, 'AC-OBS-020 the job records how many it deleted');

select is(
  (select count(*)::int from cron.job where jobname = 'error-events-purge' and active),
  1, 'AC-OBS-021 a cron entry for the purge exists AND is enabled');

select isnt(
  (select last_success_at from public.ops_job_heartbeats where job_name = 'error-events-purge'),
  null, 'AC-OBS-021 the job has actually SUCCEEDED (a registered schedule is not a working one)');

select * from finish();
rollback;
```

**RED — how to see it fail:** run before migration 0171 — every assertion fails
(`function public.purge_error_events(integer) does not exist`).
**Verify:** `scripts/with-db-lock.sh supabase test db`
**Covers:** AC-OBS-020, AC-OBS-021 (pgTAP).

---

### Task D6 — GREEN: migration 0171 — the purge job

Create `supabase/migrations/0171_error_events_retention.sql`:

```sql
-- 0171_error_events_retention.sql — FR-OBS-020/021, AC-OBS-020/021.
-- error_events has had NO retention since 0071; it grows unbounded.
--
-- ASSUMPTION AS-1 (owner-confirmable, spec 8 Q3): the window is 90 days, chosen to outlive a
-- quarterly audit cycle while bounding table growth. It appears exactly twice below -- the function
-- default and the cron literal -- so changing it is a one-line migration.
--
-- The function stamps ops_job_heartbeats (0167) on every run. That is what makes AC-OBS-021's
-- "the schedule exists" assertion meaningful: 0071's tick existed and never once succeeded.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   select cron.unschedule('error-events-purge');
--   drop function if exists public.purge_error_events(integer);

create extension if not exists pg_cron;

create or replace function public.purge_error_events(p_retention_days integer default 90)
  returns integer language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  if p_retention_days is null or p_retention_days < 1 then
    raise exception 'retention window must be at least 1 day' using errcode = '22023';
  end if;

  delete from public.error_events
   where created_at < now() - make_interval(days => p_retention_days);
  get diagnostics v_deleted = row_count;

  insert into public.ops_job_heartbeats (job_name, last_success_at, last_detail)
  values ('error-events-purge', now(),
          jsonb_build_object('deleted', v_deleted, 'retention_days', p_retention_days))
  on conflict (job_name) do update
    set last_success_at = excluded.last_success_at,
        last_detail     = excluded.last_detail;

  return v_deleted;
end $$;

comment on function public.purge_error_events(integer) is
  'Deletes error_events rows older than the retention window (default 90 days, ASSUMPTION AS-1) and '
  'stamps ops_job_heartbeats with the deleted count. FR-OBS-020/021.';

revoke all on function public.purge_error_events(integer) from public;

-- 03:17 UTC daily — off the hour so it never contends with the top-of-hour telegram-notify tick.
select cron.schedule('error-events-purge', '17 3 * * *', 'select public.purge_error_events(90)');
```

**Verify:** `scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db`
→ 0164 green (6/6).
**Covers:** AC-OBS-020, AC-OBS-021, FR-OBS-020, FR-OBS-021.

---

### Task D7 — Slice D gate

```bash
cd pmo-portal && npm run verify
```
Then from the repo root: `scripts/with-db-lock.sh supabase db reset && scripts/with-db-lock.sh supabase test db`.

Open PR-4 → `dev`. In the PR body raise **AS-1** (90-day window) as a question for the owner.

---

## 7. Slice E (PR-5) — Client config + consent · spec §5.1, §6

Branch: `feat/analytics-config-consent`. Design: **ADR-0067** (consent half), **D6** above.

### Task E1 — RED: the init config assertions

Append to `pmo-portal/src/lib/analytics/client.test.ts`:

```ts
describe('analyticsClient.init — signal config (FR-PHG-001..004, FR-CON-001)', () => {
  it('AC-PHG-001: enables heatmaps via capture_heatmaps (NOT the deprecated enable_heatmaps)', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    const opts = initSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.capture_heatmaps).toBe(true);
    expect(opts).not.toHaveProperty('enable_heatmaps');
  });

  it('AC-PHG-001: sets capture_dead_clicks EXPLICITLY (the SDK type declares @default undefined)', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).capture_dead_clicks).toBe(true);
  });

  it('AC-PHG-001: web vitals on, network timing off', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).capture_performance)
      .toEqual({ web_vitals: true, network_timing: false });
  });

  it('AC-PHG-004: sets capture_pageleave EXPLICITLY (its default defers to capture_pageview)', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).capture_pageleave).toBe(false);
  });

  it('AC-CON-001: sets respect_dnt', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).respect_dnt).toBe(true);
  });
});
```

> Reuse whatever `posthog.init` spy and enabled-config factory `client.test.ts` already defines; if
> it does not expose one, add `const enabledConfig = () => ({ ...getAnalyticsConfig({ VITE_POSTHOG_KEY: 'phc_' + 'a'.repeat(24), VITE_ANALYTICS_ENABLED: 'true', PROD: true }) });`
> at the top of the new describe.

**RED — how to see it fail:** `cd pmo-portal && npx vitest run src/lib/analytics/client.test.ts`.
Five failures, and the first one is the interesting one: `client.ts:143` currently sets
`enable_heatmaps: false` — deprecated **and** the wrong value.
**Covers:** AC-PHG-001 *(PROPOSED)*, AC-PHG-004 *(PROPOSED)*, AC-CON-001 *(PROPOSED)*.

---

### Task E2 — GREEN: the init config

Replace `pmo-portal/src/lib/analytics/client.ts:140-145` with:

```ts
      capture_pageview: false,
      // FR-PHG-004: EXPLICIT. Its default is 'if_capture_pageview', so capture_pageview:false had
      // silently disabled $pageleave too. We keep it off deliberately: "last module before exit"
      // (FR-PHG-020) is answered by the final app_route_viewed of a session, which we already send,
      // and $pageleave is a billed event that would add nothing.
      capture_pageleave: false,
      person_profiles: 'identified_only',
      // FR-CON-001 (OD-OBS-2): honour Do Not Track. Disclosure + opt-out + DNT, no banner.
      respect_dnt: true,
      disable_session_recording: !config.replayAndAutocapture,
      // FR-PHG-001/002. `capture_heatmaps`, not the deprecated `enable_heatmaps` (which was also set
      // to the WRONG value). Heatmaps carry rage- and dead-click COORDINATES and are NOT billed
      // against the event allowance -- under OD-OBS-1 (no autocapture for real users) this is the
      // only rage-click signal available at all, since $rageclick is emitted from inside the
      // autocapture code path and is unreachable with autocapture:false.
      capture_heatmaps: true,
      // FR-PHG-003: EXPLICIT. The docs claim a default of true but the SDK type source declares
      // `@default undefined`, which defers to remote project config -- relying on the documented
      // default risks capturing nothing.
      capture_dead_clicks: true,
      // FR-PHG-001: web vitals yes, network timing no (URLs/payload shapes are a leak surface).
      capture_performance: { web_vitals: true, network_timing: false },
      enable_recording_console_log: false,
```

> If `capture_heatmaps` / `capture_dead_clicks` / `capture_performance` are missing from the
> installed `posthog-js` types, that means the SDK is older than the documented API. **Bump
> `posthog-js`; do not cast.** A cast here would compile and silently configure nothing.

**Verify:** `cd pmo-portal && npx vitest run src/lib/analytics/client.test.ts`
**Covers:** FR-PHG-001, FR-PHG-002, FR-PHG-003, FR-PHG-004, FR-CON-001.

---

### Task E3 — RED: opt-out unit tests

Append to `pmo-portal/src/lib/analytics/client.test.ts`:

```ts
describe('analytics opt-out (FR-CON-002/003)', () => {
  beforeEach(() => { window.localStorage.clear(); analyticsClient.__resetForTests(); initSpy.mockClear(); });

  it('AC-CON-002: opting out persists the preference', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.optOut();
    expect(analyticsClient.hasOptedOut()).toBe(true);
    expect(window.localStorage.getItem('pmo.analyticsOptOut')).toBe('true');
  });

  it('AC-CON-003: opting out calls posthog.opt_out_capturing (stops the CURRENT session)', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.optOut();
    expect(optOutSpy).toHaveBeenCalled();
  });

  it('AC-CON-003: a persisted opt-out means init NEVER calls posthog.init on the next session', () => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    analyticsClient.init(enabledConfig());
    expect(initSpy).not.toHaveBeenCalled();
    analyticsClient.capture('app_route_viewed', {});
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('AC-CON-002: opting back in clears the preference and initialises', () => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    analyticsClient.init(enabledConfig());
    analyticsClient.optIn();
    expect(analyticsClient.hasOptedOut()).toBe(false);
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});
```

Add `optOutSpy` / `optInSpy` to the existing `vi.mock('posthog-js', …)` factory in that file.

**RED:** `optOut`/`optIn`/`hasOptedOut` do not exist → 4 failures.
**Verify:** `cd pmo-portal && npx vitest run src/lib/analytics/client.test.ts`
**Covers:** AC-CON-002 *(PROPOSED)*.

---

### Task E4 — GREEN: opt-out in `client.ts`

Insert above `export const analyticsClient` in `pmo-portal/src/lib/analytics/client.ts`:

```ts
/**
 * FR-CON-002/003 (OD-OBS-2, ADR-0067). The preference is OURS, in localStorage — not the SDK's
 * internal opt-out cookie. That matters: posthog-js's own opt-out still permits its remote-config
 * fetch, so "no network request to the PostHog host" (AC-CON-003) is only true if we never call
 * `posthog.init` at all. `posthog.opt_out_capturing()` is still called so the CURRENT session stops
 * immediately, before any reload.
 */
const OPT_OUT_STORAGE_KEY = 'pmo.analyticsOptOut';

function readOptOut(): boolean {
  try {
    return globalThis.localStorage?.getItem(OPT_OUT_STORAGE_KEY) === 'true';
  } catch {
    return false; // storage blocked (private mode / embedded) — default is opt-IN per OD-OBS-2
  }
}

function doInit(config: AnalyticsConfig): void {
  activeConfig = config;
  if (!config.enabled || initialized || !config.posthogKey || readOptOut()) return;
  posthog.init(config.posthogKey, { /* …the options object from E2, unchanged… */ });
  initialized = true;
}
```

Then in `analyticsClient`: replace the body of `init(config)` with `doInit(config);`, and add:

```ts
  /** FR-CON-002: has this browser opted out of analytics? Survives reloads. */
  hasOptedOut(): boolean {
    return readOptOut();
  },

  /** FR-CON-003: stop capture now AND on every future session. */
  optOut() {
    try {
      globalThis.localStorage?.setItem(OPT_OUT_STORAGE_KEY, 'true');
    } catch { /* storage blocked — the in-session opt-out below still applies */ }
    if (initialized) posthog.opt_out_capturing();
  },

  /** FR-CON-002: opt back in; initialise if the opt-out had suppressed init. */
  optIn() {
    try {
      globalThis.localStorage?.removeItem(OPT_OUT_STORAGE_KEY);
    } catch { /* storage blocked */ }
    if (initialized) {
      posthog.opt_in_capturing();
      return;
    }
    if (activeConfig) doInit(activeConfig);
  },
```

Export from `pmo-portal/src/lib/analytics/index.ts`:

```ts
/** FR-CON-002/003 — the in-app analytics opt-out (see /privacy). */
export function analyticsOptOut(): void { analyticsClient.optOut(); }
export function analyticsOptIn(): void { analyticsClient.optIn(); }
export function hasAnalyticsOptedOut(): boolean { return analyticsClient.hasOptedOut(); }
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/analytics/client.test.ts`
**Covers:** AC-CON-002 *(PROPOSED)*, FR-CON-002, FR-CON-003.

---

### Task E5 — RED: the opt-out toggle component test

Create `pmo-portal/src/components/legal/AnalyticsOptOutToggle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const analytics = vi.hoisted(() => ({
  analyticsOptOut: vi.fn(),
  analyticsOptIn: vi.fn(),
  hasAnalyticsOptedOut: vi.fn(() => false),
}));
vi.mock('@/src/lib/analytics', () => analytics);

import { AnalyticsOptOutToggle } from './AnalyticsOptOutToggle';

beforeEach(() => {
  analytics.analyticsOptOut.mockClear();
  analytics.analyticsOptIn.mockClear();
  analytics.hasAnalyticsOptedOut.mockReturnValue(false);
});

describe('AnalyticsOptOutToggle', () => {
  it('AC-CON-002: reflects the persisted preference on mount', () => {
    analytics.hasAnalyticsOptedOut.mockReturnValue(true);
    render(<AnalyticsOptOutToggle />);
    expect(screen.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
  });

  it('AC-CON-002: checking it opts out', async () => {
    render(<AnalyticsOptOutToggle />);
    await userEvent.click(screen.getByRole('checkbox', { name: /usage analytics/i }));
    expect(analytics.analyticsOptOut).toHaveBeenCalledTimes(1);
  });

  it('AC-CON-002: unchecking it opts back in', async () => {
    analytics.hasAnalyticsOptedOut.mockReturnValue(true);
    render(<AnalyticsOptOutToggle />);
    await userEvent.click(screen.getByRole('checkbox', { name: /usage analytics/i }));
    expect(analytics.analyticsOptIn).toHaveBeenCalledTimes(1);
  });
});
```

**RED:** component does not exist → 3 failures on the import.
**Verify:** `cd pmo-portal && npx vitest run src/components/legal/AnalyticsOptOutToggle.test.tsx`
**Covers:** AC-CON-002 *(PROPOSED)*.

---

### Task E6 — GREEN: the toggle component

Create `pmo-portal/src/components/legal/AnalyticsOptOutToggle.tsx`:

```tsx
import React, { useState } from 'react';
import { analyticsOptIn, analyticsOptOut, hasAnalyticsOptedOut } from '@/src/lib/analytics';

/**
 * FR-CON-002/003 — the in-app analytics opt-out. Lives on /privacy, next to the disclosure it
 * relates to; /privacy is reachable from the login footer (LoginPage.tsx:334) and the in-app
 * account menu (ContextBar.tsx:275), so this satisfies "in-app" without a new settings surface.
 * No banner (OD-OBS-2).
 */
export const AnalyticsOptOutToggle: React.FC = () => {
  const [optedOut, setOptedOut] = useState<boolean>(() => hasAnalyticsOptedOut());

  const onChange = (next: boolean) => {
    setOptedOut(next);
    if (next) analyticsOptOut();
    else analyticsOptIn();
  };

  return (
    <label className="flex items-start gap-3 text-muted-foreground">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-primary"
        checked={optedOut}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Don&rsquo;t send my usage analytics. This stops all product-analytics collection from this
        browser, including error diagnostics. Your choice is remembered on this device.
      </span>
    </label>
  );
};
```

**Verify:** `cd pmo-portal && npx vitest run src/components/legal/AnalyticsOptOutToggle.test.tsx`
**Covers:** AC-CON-002 *(PROPOSED)*, FR-CON-002.

---

### Task E7 — RED then GREEN: the privacy disclosure

Append to `pmo-portal/pages/Privacy.test.tsx`:

```tsx
  it('AC-CON-004: discloses what analytics is collected, by whom it is processed, and how to opt out', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /Analytics and Cookies/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/PostHog/);
    expect(text).toMatch(/opt out|opt-out/i);
    expect(text).toMatch(/Do Not Track/i);
    expect(within(section).getByRole('checkbox', { name: /usage analytics/i })).toBeInTheDocument();
  });
```

**RED:** `cd pmo-portal && npx vitest run pages/Privacy.test.tsx` → fails; `pages/Privacy.tsx`
currently contains **zero** mentions of analytics, PostHog or cookies.

**GREEN:** insert this section into `pmo-portal/pages/Privacy.tsx` between the "AI Processing
Disclosure" and "Data Location" sections, and add
`import { AnalyticsOptOutToggle } from '@/src/components/legal/AnalyticsOptOutToggle';`:

```tsx
    <LegalSection title="Analytics and Cookies">
      <p className="text-muted-foreground">
        We collect product-usage analytics to understand which parts of the product are used and
        where people get stuck. This is processed on our behalf by PostHog. We record page and
        feature navigation, anonymised interaction positions, page-performance measurements, and
        error diagnostics. We never send the contents of your records — no names, no financial
        values, no free text, no search terms; a fixed denylist strips those before anything leaves
        your browser, and identifiers are internal account IDs, never your email address.
      </p>
      <p className="text-muted-foreground">
        We honour your browser&rsquo;s Do Not Track setting. You can also opt out here at any time:
      </p>
      <AnalyticsOptOutToggle />
    </LegalSection>
```

> The existing `AC-LEG-013` test enumerates 9 expected `h2`s with `toContain`, not a length check, so
> a 10th section is fine. `LegalSection` supplies the required `text-[20px]` heading token.

**Verify:** `cd pmo-portal && npx vitest run pages/Privacy.test.tsx`
**Covers:** AC-CON-004 *(PROPOSED)*, FR-CON-004, FR-CON-005 (no banner is added).

---

### Task E8 — The e2e lane that makes AC-CON-003 non-vacuous

Edit `pmo-portal/playwright.config.ts` — turn `webServer` into an array and add the `consent`
project:

```ts
    {
      // AC-CON-003 runs against a SECOND dev server with analytics actually ENABLED. Without it the
      // spec is vacuous: getAnalyticsConfig() disables analytics whenever VITE_POSTHOG_KEY is not a
      // valid phc_ key, which it never is in e2e — so "no request to the PostHog host" would pass
      // before any of this work existed. See docs/plans/2026-07-25-observability-analytics.md D6.
      name: 'consent',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3100' },
      testMatch: /AC-CON-003-.*\.spec\.ts/,
      fullyParallel: false,
    },
```

Add `testIgnore: [/auth\.setup\.ts/, /e2e\/serial\//, /AC-CON-003-/]` to the `chromium` project so
it does not also pick the spec up on port 3000.

```ts
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Analytics-ENABLED lane for AC-CON-003 only. The key is a syntactically valid throwaway (it
      // must satisfy isValidPosthogKey); the host is unroutable on purpose, so every PostHog request
      // is trivially identifiable and is intercepted by the spec rather than actually leaving.
      command: 'npm run dev -- --port 3100 --strictPort',
      url: 'http://localhost:3100',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_ANALYTICS_ENABLED: 'true',
        VITE_POSTHOG_KEY: 'phc_e2econsentlanefakekey00000',
        VITE_POSTHOG_HOST: 'https://ph-e2e.invalid',
      },
    },
  ],
```

Add `"e2e:consent": "playwright test --project=consent"` to `pmo-portal/package.json` scripts, and
append `&& playwright test --project=consent` to the existing `e2e` script.

**Verify:** `cd pmo-portal && npx playwright test --project=consent --list` lists the (not-yet-written) spec path.
**Covers:** infrastructure for AC-CON-003.

---

### Task E9 — RED then GREEN: the AC-CON-003 journey

Create `pmo-portal/e2e/AC-CON-003-analytics-opt-out.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

/**
 * AC-CON-003: Given a user who has opted out, When they navigate and trigger errors, Then no network
 * request is made to the PostHog host, and the preference survives a reload.
 *
 * The CONTROL assertion is load-bearing. Analytics is disabled whenever VITE_POSTHOG_KEY is not a
 * valid phc_ key, which is the default everywhere except this lane's dev server — so without first
 * proving that an OPTED-IN session DOES attempt PostHog requests, the opt-out assertion would pass
 * against a build with no analytics at all and prove nothing.
 */
const PH_HOST = /ph-e2e\.invalid/;

async function countPosthogRequests(page: import('@playwright/test').Page, run: () => Promise<void>) {
  const hits: string[] = [];
  await page.route(PH_HOST, async (route) => {
    hits.push(route.request().url());
    await route.abort();
  });
  await run();
  return hits;
}

test('AC-CON-003 CONTROL: an opted-in session DOES attempt PostHog requests', async ({ page }) => {
  const hits = await countPosthogRequests(page, async () => {
    await page.goto('/privacy');
    await page.waitForTimeout(2000);
  });
  expect(hits.length, 'the control must fail if analytics is not actually enabled in this lane')
    .toBeGreaterThan(0);
});

test('AC-CON-003: after opting out, navigation makes ZERO PostHog requests and the choice survives a reload', async ({ page }) => {
  await page.goto('/privacy');
  const toggle = page.getByRole('checkbox', { name: /usage analytics/i });
  await toggle.check();
  await expect(toggle).toBeChecked();

  const hits = await countPosthogRequests(page, async () => {
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
    await page.goto('/terms');
    await page.goto('/privacy');
    await page.waitForTimeout(2000);
  });

  expect(hits, `expected no PostHog traffic, got: ${hits.join(', ')}`).toEqual([]);
  await expect(page.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
});
```

**RED — how to see it fail:** run this **before** E4/E6/E7 land. The second test fails at
`toggle.check()` (no such control exists), and the control test proves the lane is genuinely
capturing. After the slice, control passes and the opt-out test passes.
**Verify:** `cd pmo-portal && npx playwright test --project=consent`
**Covers:** **AC-CON-003 (E2E — the one AC in this program that genuinely warrants e2e).**

---

### Task E10 — Slice E gate

```bash
cd pmo-portal && npm run verify && npx playwright test --project=consent
```

Open PR-5 → `dev`. ⚑ PR→`dev` runs `verify` only; the e2e first executes in CI at the `dev`→`main`
promote, so expect first-time CI-env gaps on the new 3100 lane there (port availability, `env`
passthrough). Run it locally before promoting.

---

## 8. Slice F (PR-6) — Friction, funnel, quota, tile gate · spec §5.2, §5.3, §5.4

Branch: `feat/friction-and-funnel-analytics`. Design: **ADR-0067**.

### Task F1 — RED: friction is captured at `classifyMutationError`

Create `pmo-portal/src/lib/classifyMutationError.analytics.test.ts`:

```ts
/**
 * FR-PHG-010/011 — friction is instrumented at the FUNNEL (classifyMutationError), not the form.
 * See ADR-0067: `save_failed` fired from useEntityForm is inert because (a) no caller passes
 * `entityType` and (b) every form's onValid swallows its own error, so the hook's catch never runs.
 * Passing the missing prop would STILL produce zero events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const analytics = vi.hoisted(() => ({ trackSaveFailed: vi.fn() }));
vi.mock('./analytics', () => analytics);

import { classifyMutationError } from './classifyMutationError';

beforeEach(() => analytics.trackSaveFailed.mockClear());

describe('classifyMutationError friction capture', () => {
  it('AC-PHG-010: a PostgREST error captures EXACTLY ONE friction event with the right reason_code', () => {
    classifyMutationError({ code: '42501', message: 'permission denied for table projects' });
    expect(analytics.trackSaveFailed).toHaveBeenCalledTimes(1);
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('permission_denied', 'classify', '42501', 'unknown');
  });

  it('AC-PHG-010: an unrecognised code still reports, classified as unclassified', () => {
    classifyMutationError({ code: 'XX999', message: 'boom' });
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('unclassified', 'classify', 'XX999', 'unknown');
  });

  it('AC-PHG-010: caller context is forwarded when supplied', () => {
    classifyMutationError({ code: '23503', message: 'in use' }, undefined, { module: 'companies', operation: 'delete' });
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('in_use', 'delete', '23503', 'companies');
  });

  it('AC-PHG-010: no PII — the verbatim message never becomes an event property', () => {
    classifyMutationError({ code: '23505', message: 'duplicate key: acme@example.com' });
    const props = analytics.trackSaveFailed.mock.calls[0];
    expect(props.join('|')).not.toMatch(/acme@example\.com/);
  });

  it('AC-PHG-010: the return value is unchanged (classification stays a pure function of inputs)', () => {
    expect(classifyMutationError({ code: '23503', message: 'x' }))
      .toEqual({ headline: 'Still in use', detail: 'x' });
  });
});
```

**RED — how to see it fail:** `cd pmo-portal && npx vitest run src/lib/classifyMutationError.analytics.test.ts`
→ the first four fail (`trackSaveFailed` never called). Then run the *counter-proof* that the
alternative fix is a dead end:

```bash
cd pmo-portal && grep -rn "entityType" src pages --include='*.ts' --include='*.tsx' | grep -v EmptyState | grep -v 'lib/analytics'
```
Expected: only `src/components/ui/useEntityForm.ts`'s own parameter. Paste that into the PR as the
evidence that "just pass the prop" produces zero events.
**Covers:** AC-PHG-010 (Unit).

---

### Task F2 — GREEN: instrument `classifyMutationError`

Replace `pmo-portal/src/lib/classifyMutationError.ts:27-54` with:

```ts
import { safeTrack } from './analytics/safeTrack';
import { trackSaveFailed } from './analytics';

/** Stable, PII-free classification slugs for the friction event (ADR-0067). */
type FrictionClass =
  | 'illegal_transition' | 'permission_denied' | 'duplicate'
  | 'in_use' | 'timeout' | 'override' | 'unclassified';

export interface ClassifyContext {
  /** Which module the user was in, e.g. 'companies'. Never derived from user input. */
  module?: string;
  /** 'create' | 'update' | 'delete' | … Defaults to 'classify'. */
  operation?: string;
}

export function classifyMutationError(
  err: unknown,
  overrides?: Record<string, string>,
  context?: ClassifyContext,
): { headline: string; detail: string } {
  const detail = err instanceof Error ? err.message : 'An error occurred';
  const code = typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : undefined;

  // FR-PHG-010/011 (ADR-0067): this is the single point where "the user was shown a mutation error"
  // is knowable. Instrumenting here instead of in the 17 entity forms means a new form cannot forget
  // to opt in, and errors that never touch a form (import, export, ERP push) are covered too.
  // safeTrack because this runs INSIDE error handling — an analytics fault must never propagate into
  // the path that is already recovering. Only the stable code + slug leave; never `detail`.
  const classification = classifyCode(code, overrides);
  safeTrack(() =>
    trackSaveFailed(classification, context?.operation ?? 'classify', code ?? 'unknown', context?.module ?? 'unknown'),
  );

  if (code && overrides && Object.prototype.hasOwnProperty.call(overrides, code)) {
    return { headline: overrides[code], detail };
  }

  switch (code) {
    case 'P0001':
      return { headline: "That move isn't allowed from the current stage.", detail };
    case '42501':
      return { headline: "You don't have permission to do that.", detail };
    case '23505':
      return { headline: 'That already exists.', detail };
    case '23503':
      return { headline: 'Still in use', detail };
    case 'REQUEST_TIMEOUT':
      return { headline: "Request timed out — we couldn't confirm whether it saved.", detail };
    default:
      return { headline: 'Update failed', detail };
  }
}

function classifyCode(code: string | undefined, overrides?: Record<string, string>): FrictionClass {
  if (code && overrides && Object.prototype.hasOwnProperty.call(overrides, code)) return 'override';
  switch (code) {
    case 'P0001': return 'illegal_transition';
    case '42501': return 'permission_denied';
    case '23505': return 'duplicate';
    case '23503': return 'in_use';
    case 'REQUEST_TIMEOUT': return 'timeout';
    default: return 'unclassified';
  }
}
```

Extend the existing file header comment with a pointer to ADR-0067 explaining the deliberate impurity.

**Verify:** `cd pmo-portal && npx vitest run src/lib/classifyMutationError.analytics.test.ts src/lib/classifyMutationError.test.ts`
— the 14 existing assertions in `classifyMutationError.test.ts` **must still pass unchanged**.
**Covers:** AC-PHG-010 (Unit), FR-PHG-010, FR-PHG-011.

---

### Task F3 — Delete the dead `save_failed` producer in `useEntityForm`

In `pmo-portal/src/components/ui/useEntityForm.ts`:

1. `:2` → `import { trackFormValidationFailed } from '@/src/lib/analytics';`
2. Delete the `entityType?: string;` option (`:45-46`) and its doc line, and the `entityType`
   mention in the `module` doc block (`:38-43` — reword to reference only `form_validation_failed`).
3. Delete `entityType` from the destructure (`:96`) and from the `handleSubmit` dep array (`:208`).
4. Replace `:190-203`'s catch with:

```ts
      } catch (err) {
        // `save_failed` is NOT fired here (ADR-0067). It is captured once, centrally, at
        // classifyMutationError — the only place that reliably runs when a user is SHOWN an error.
        // This catch existed to fire it and never ran: every form's onValid swallows its own error
        // (e.g. pages/Companies.tsx:421-429), so `onValid` never rejects.
        throw err;
      } finally {
```
5. Delete the now-unused `operation` parameter doc reference at `:75-79` only if `operation` becomes
   unused — it does; also drop `operation?: string` from the `handleSubmit` signature (`:80-83`) and
   from the implementation (`:175`). **Then** run the grep below and fix any call site that passes it.

```bash
cd pmo-portal && grep -rn "handleSubmit(" src pages --include='*.tsx' --include='*.ts' | grep -v '\.test\.'
```

**RED:** N/A (deletion of dead code). The proof is that the existing `useEntityForm` test suite still
passes and no `save_failed` assertion regresses.
**Verify:** `cd pmo-portal && npx vitest run src/components/ui && npm run typecheck`
**Covers:** FR-PHG-013 (removing a second producer of the same event).

---

### Task F4 — Remove `permission_denied_seen` and its tile

1. `pmo-portal/src/lib/analytics/events.ts` — delete `| 'permission_denied_seen'` from
   `AnalyticsEventName` (`:26`) and delete `trackPermissionDeniedSeen` (`:128-137`).
2. `pmo-portal/src/lib/analytics/index.ts` — delete `trackPermissionDeniedSeen` from the re-export
   block (`:11`).
3. `scripts/posthog/provision-dashboards.mjs` — delete the `${NS} Permission-denied surfaces` insight
   (`:190-193`).
4. `pmo-portal/src/lib/analytics/events.test.ts` — delete any `trackPermissionDeniedSeen` assertions.

**Before deleting, confirm the spec's "zero call sites" claim on this commit:**

```bash
cd pmo-portal && grep -rn "trackPermissionDeniedSeen\|permission_denied_seen" src pages e2e | grep -v 'lib/analytics/'
```
Expected: no output. **If there IS output, stop and report it** — the spec's evidence would be wrong
and the event should be wired rather than removed.

**Verify:** `cd pmo-portal && npm run typecheck && npx vitest run src/lib/analytics`
**Covers:** FR-PHG-012.

---

### Task F5 — The event↔call-site registry

Create `pmo-portal/src/lib/analytics/eventCallSites.ts`:

```ts
import type { AnalyticsEventName } from './events';

/**
 * Which producer emits each analytics event, and where a CI check should expect to find that
 * producer being called (FR-PHG-013, AC-PHG-013, ADR-0067).
 *
 *   'facade'   — a track* helper in index.ts; must be referenced from OUTSIDE src/lib/analytics/**.
 *   'provider' — captured directly by AnalyticsProvider/client internals; no external caller expected.
 *
 * A naive "does analyticsClient.capture('save_failed') appear anywhere" grep would have passed for
 * two years while the event never fired once: the wrapper existed, the caller did not. This registry
 * is what makes scripts/check-dashboard-tiles.mjs able to tell the difference.
 */
export const EVENT_PRODUCERS: Record<AnalyticsEventName, { producer: string; kind: 'facade' | 'provider' }> = {
  demo_persona_selected:     { producer: 'trackDemoPersonaSelected',    kind: 'facade' },
  app_route_viewed:          { producer: 'AnalyticsProvider',           kind: 'provider' },
  auth_login_succeeded:      { producer: 'trackAuthLoginSucceeded',     kind: 'facade' },
  auth_login_failed:         { producer: 'trackAuthLoginFailed',        kind: 'facade' },
  auth_logout_succeeded:     { producer: 'trackAuthLogoutSucceeded',    kind: 'facade' },
  project_detail_opened:     { producer: 'trackProjectDetailOpened',    kind: 'facade' },
  project_tab_viewed:        { producer: 'trackProjectTabViewed',       kind: 'facade' },
  procurement_detail_opened: { producer: 'trackProcurementDetailOpened',kind: 'facade' },
  filter_applied:            { producer: 'trackFilterApplied',          kind: 'facade' },
  search_used:               { producer: 'trackSearchUsed',             kind: 'facade' },
  coming_soon_clicked:       { producer: 'trackComingSoonClicked',      kind: 'facade' },
  form_validation_failed:    { producer: 'trackFormValidationFailed',   kind: 'facade' },
  save_failed:               { producer: 'classifyMutationError',       kind: 'facade' },
  empty_state_seen:          { producer: 'trackEmptyStateSeen',         kind: 'facade' },
  agent_panel_opened:        { producer: 'trackAgentPanelOpened',       kind: 'facade' },
  agent_run_started:         { producer: 'trackAgentRunStarted',        kind: 'facade' },
  agent_run_completed:       { producer: 'trackAgentRunCompleted',      kind: 'facade' },
  agent_run_errored:         { producer: 'trackAgentRunErrored',        kind: 'facade' },
  agent_approval_shown:      { producer: 'trackAgentApprovalShown',     kind: 'facade' },
  agent_approval_decided:    { producer: 'trackAgentApprovalDecided',   kind: 'facade' },
  agent_thread_resumed:      { producer: 'trackAgentThreadResumed',     kind: 'facade' },
  agent_feedback_rated:      { producer: 'trackAgentFeedbackRated',     kind: 'facade' },
  agent_compose_view_saved:  { producer: 'trackAgentComposeViewSaved',  kind: 'facade' },
};
```

> The `Record<AnalyticsEventName, …>` type makes a missing entry a **typecheck** failure the moment a
> new event is added to the union.

**Verify:** `cd pmo-portal && npm run typecheck`
**Covers:** FR-PHG-013 (enabling).

---

### Task F6 — RED: the tile↔call-site CI gate

Create `scripts/check-dashboard-tiles.mjs`:

```js
#!/usr/bin/env node
/**
 * Guard: no provisioned dashboard tile may depend on an event that has no call site
 * (FR-PHG-013, AC-PHG-013, ADR-0067).
 *
 * Why this exists (2026-07-25): TWO tiles have been provisioned for months against events that
 * cannot fire. `save_failed` needed an `entityType` prop nobody passes AND a rethrow every form
 * swallows; `permission_denied_seen` had zero call sites outright. An empty chart reads as
 * "our users never hit this", which is a product conclusion drawn from a broken measurement.
 *
 * Run: node scripts/check-dashboard-tiles.mjs   (paths resolve from this script; wired into verify)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(REPO, 'pmo-portal');

const tilesSrc = readFileSync(resolve(REPO, 'scripts/posthog/provision-dashboards.mjs'), 'utf8');
const registrySrc = readFileSync(resolve(APP, 'src/lib/analytics/eventCallSites.ts'), 'utf8');

// Every `{ event: 'x' }` and `funnel(['a','b'])` reference in the dashboard spec.
const tileEvents = new Set();
for (const m of tilesSrc.matchAll(/\bevent:\s*'([a-z0-9_$]+)'/g)) tileEvents.add(m[1]);
for (const m of tilesSrc.matchAll(/funnel\(\[([^\]]+)\]/g)) {
  for (const e of m[1].matchAll(/'([a-z0-9_$]+)'/g)) tileEvents.add(e[1]);
}

// event -> { producer, kind } from the typed registry.
const registry = new Map();
for (const m of registrySrc.matchAll(/^\s{2}([a-z0-9_]+):\s*\{\s*producer:\s*'([A-Za-z0-9_]+)',\s*kind:\s*'(facade|provider)'/gm)) {
  registry.set(m[1], { producer: m[2], kind: m[3] });
}

// All non-test source outside src/lib/analytics/**.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === '.auth') continue;
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(name)) continue;
    if (p.includes(join('src', 'lib', 'analytics'))) continue;
    out.push(p);
  }
  return out;
}
const sources = [...walk(resolve(APP, 'src')), ...walk(resolve(APP, 'pages'))]
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');

let failed = false;
for (const event of [...tileEvents].sort()) {
  const entry = registry.get(event);
  if (!entry) {
    console.error(`✗ tile event '${event}' is not in pmo-portal/src/lib/analytics/eventCallSites.ts`);
    failed = true;
    continue;
  }
  if (entry.kind === 'provider') continue; // captured by the provider; no external caller expected
  if (!new RegExp(`\\b${entry.producer}\\b`).test(sources)) {
    console.error(
      `✗ tile event '${event}' has NO call site: '${entry.producer}' is never referenced outside src/lib/analytics/**.\n` +
      `    A provisioned tile for an event that cannot fire renders an empty chart that reads as a product fact.`,
    );
    failed = true;
  }
}

if (failed) {
  console.error('\nEvery provisioned dashboard tile must depend on an event with a real call site (docs/adr/0067).');
  process.exit(1);
}
console.log(`✓ dashboard tiles all have live call sites (${tileEvents.size} events)`);
```

**RED — how to see it fail:** `git stash` F2/F3/F4 (so `save_failed`'s producer is
`trackSaveFailed`, uncalled, and `permission_denied_seen` still has a tile), temporarily point the
registry's `save_failed` producer at `trackSaveFailed`, and run
`node scripts/check-dashboard-tiles.mjs`. It exits 1 naming **both** events. Paste that into the PR.
Then unstash → it prints ✓.
**Verify:** `node scripts/check-dashboard-tiles.mjs`
**Covers:** AC-PHG-013 (CI gate), FR-PHG-013.

---

### Task F7 — The demo-funnel dashboard

Append a fourth entry to `SPEC` in `scripts/posthog/provision-dashboards.mjs` (after the
`Product · Usage & Friction` block, before the closing `];`):

```js
  {
    dashboard: `${NS} Demo · Prospect Funnel`,
    description:
      'Land -> persona selected -> login -> first module opened. Source: demo_persona_selected, ' +
      'auth_login_succeeded, app_route_viewed, coming_soon_clicked (FR-PHG-020/021).',
    insights: [
      {
        name: `${NS} Demo funnel — persona -> login -> module`,
        query: funnel(['demo_persona_selected', 'auth_login_succeeded', 'app_route_viewed']),
      },
      {
        name: `${NS} Demo personas chosen`,
        query: trend([{ event: 'demo_persona_selected' }], { breakdown: 'persona_role', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Demo — first modules opened`,
        query: trend([{ event: 'app_route_viewed' }], { breakdown: 'route', display: 'ActionsBarValue' }),
      },
      {
        name: `${NS} Coming-soon demand by feature`,
        query: trend([{ event: 'coming_soon_clicked' }], { breakdown: 'feature_id', display: 'ActionsBarValue' }),
      },
    ],
  },
```

`demo_persona_selected` and `coming_soon_clicked` already fire and had **no tile** — free signal
being collected and never looked at.

**"Last module before exit" is deliberately not a tile.** PostHog trends cannot express
"session-final event" without a HogQL insight, and a wrong tile is worse than none. Add this to
`docs/analytics-events.md` under a new "Demo funnel" heading instead, runnable via
`scripts/posthog/query.mjs`:

```sql
-- Last module a demo session viewed before exiting (FR-PHG-020)
SELECT argMax(properties.route, timestamp) AS last_route, count() AS sessions
FROM events
WHERE event = 'app_route_viewed' AND properties.demo_audience = 'prospect'
  AND timestamp > now() - INTERVAL 30 DAY
GROUP BY $session_id
```

**Verify:** `node -c scripts/posthog/provision-dashboards.mjs` (syntax) then
`node scripts/check-dashboard-tiles.mjs` — the new tiles' events must all resolve.
**Covers:** FR-PHG-020, FR-PHG-021.

---

### Task F8 — RED then GREEN: the quota alarm

Create `pmo-portal/src/lib/analytics/quota.test.ts`:

```ts
/**
 * FR-PHG-030/031, AC-PHG-030. Exceeding a PostHog free allowance is DESTRUCTIVE, not billed:
 * ingestion stops and the excess is "lost forever". A mid-month quota stop flattens every chart —
 * which is indistinguishable from nobody using the product. PostHog's own 80%/100% emails go only
 * to the org owner and are easy to miss.
 */
import { describe, it, expect } from 'vitest';
import { evaluateQuota } from '../../../../scripts/posthog/quota.mjs';

const payload = {
  quota_limits: [
    { resource: 'events', usage: 810_000, limit: 1_000_000 },
    { resource: 'recordings', usage: 100, limit: 5_000 },
    { resource: 'exceptions', usage: 100_000, limit: 100_000 },
  ],
};

describe('evaluateQuota', () => {
  it('AC-PHG-030: a resource at >=80% exits non-zero and names resource, usage and limit', () => {
    const r = evaluateQuota(payload, 0.8);
    expect(r.exitCode).toBe(1);
    expect(r.lines.join('\n')).toMatch(/events.*810000.*1000000/);
    expect(r.lines.join('\n')).toMatch(/exceptions.*100000.*100000/);
  });

  it('AC-PHG-030: a resource below the threshold is not reported as a breach', () => {
    expect(evaluateQuota(payload, 0.8).lines.join('\n')).not.toMatch(/recordings/);
  });

  it('AC-PHG-030: all clear exits zero', () => {
    const r = evaluateQuota({ quota_limits: [{ resource: 'events', usage: 1, limit: 1_000_000 }] }, 0.8);
    expect(r.exitCode).toBe(0);
  });

  it('AC-PHG-030: a resource with no limit (unlimited) is skipped, not divided by zero', () => {
    const r = evaluateQuota({ quota_limits: [{ resource: 'events', usage: 5, limit: null }] }, 0.8);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual([]);
  });
});
```

**RED:** module does not exist. **GREEN** — create `scripts/posthog/quota.mjs`:

```js
/**
 * quota — pure evaluation of PostHog's GET /api/projects/:project_id/quota_limits/ response
 * (personal API key, project:read scope). Split from the CLI so AC-PHG-030 is unit-owned.
 */
export function evaluateQuota(payload, threshold = 0.8) {
  const rows = payload?.quota_limits ?? [];
  const lines = [];
  for (const row of rows) {
    const limit = Number(row?.limit);
    const usage = Number(row?.usage);
    if (!Number.isFinite(limit) || limit <= 0) continue; // unlimited / unknown — nothing to breach
    if (!Number.isFinite(usage)) continue;
    const ratio = usage / limit;
    if (ratio >= threshold) {
      lines.push(
        `QUOTA ${row.resource}: ${usage} / ${limit} (${(ratio * 100).toFixed(1)}% of the free allowance)`,
      );
    }
  }
  return { exitCode: lines.length > 0 ? 1 : 0, lines };
}
```

and `scripts/posthog/check-quota.mjs`:

```js
#!/usr/bin/env node
/**
 * check-quota — alerts when any PostHog free allowance passes 80% (FR-PHG-030/031).
 * Env: POSTHOG_API_KEY (personal, project:read), POSTHOG_PROJECT_ID, optional POSTHOG_HOST,
 * optional QUOTA_THRESHOLD (default 0.8). Feed the key via op-get.sh; never write it to disk.
 */
import { evaluateQuota } from './quota.mjs';

const HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/$/, '');
const KEY = process.env.POSTHOG_API_KEY;
const PID = process.env.POSTHOG_PROJECT_ID;
if (!KEY || !PID) {
  console.error('Missing POSTHOG_API_KEY and/or POSTHOG_PROJECT_ID env.');
  process.exit(2);
}

const res = await fetch(`${HOST}/api/projects/${PID}/quota_limits/`, {
  headers: { Authorization: `Bearer ${KEY}` },
});
if (!res.ok) {
  console.error(`quota_limits -> ${res.status}`);
  process.exit(2);
}

const { exitCode, lines } = evaluateQuota(await res.json(), Number(process.env.QUOTA_THRESHOLD ?? '0.8'));
for (const line of lines) console.error(line);
if (exitCode === 0) console.log('✓ all PostHog quotas below threshold');
process.exit(exitCode);
```

**Verify:** `cd pmo-portal && npx vitest run src/lib/analytics/quota.test.ts`
**Covers:** AC-PHG-030 (Unit), FR-PHG-030, FR-PHG-031.

---

### Task F9 — Wire the tile gate into `verify`

Edit `pmo-portal/package.json`:

```json
    "check:dashboard-tiles": "node ../scripts/check-dashboard-tiles.mjs",
    "verify": "npm run check:migrations && npm run check:e2e-isolation && npm run check:edge-test-binding && npm run check:edge-error-reporting && npm run check:dashboard-tiles && npm run typecheck && npm run typecheck:edge && npm run lint:ci && npm run test && npm run build",
```

⚑ Third edit to this line across the program (C7 here, plus `fix/nul-grep-blindness`). Keep **all**
checks when resolving.

**Verify:** `cd pmo-portal && npm run check:dashboard-tiles`
**Covers:** AC-PHG-013.

---

### Task F10 — Documentation

Update `docs/analytics-events.md`:

- move `save_failed` to a "Friction (central)" section; state that it is produced by
  `classifyMutationError`, that its meaning is now "a classified mutation error was shown to the
  user" (not only a form save), and list its four properties (`entity_type` carries the
  classification slug, `operation`, `reason_code`, `module`);
- delete `permission_denied_seen` and note it was removed (ADR-0067), answerable from
  `save_failed` breakdown by `reason_code=42501`;
- add the "Demo funnel" section with the HogQL query from F7;
- add a "Quota" line pointing at `scripts/posthog/check-quota.mjs`;
- add the consent paragraph: `respect_dnt`, the `/privacy` opt-out, `pmo.analyticsOptOut`.

**Verify:** `grep -n "permission_denied_seen" docs/analytics-events.md` → only the removal note.
**Covers:** documentation for FR-PHG-012/013, FR-CON-004.

---

### Task F11 — Slice F gate

```bash
cd pmo-portal && npm run verify
```

Open PR-6 → `dev`. Note in the body that **FR-PHG-032** (PostHog error-tracking rate limits +
suppression rules) is an **owner settings action**, not code, and is not covered by this PR.

---

## 9. Traceability

Owning layer per ADR-0010 — each AC owned by exactly one layer, the lowest sufficient one.
"PROPOSED" marks an AC id this plan introduces for a spec requirement that has an FR but no AC
(see §10 Q1); those ids need spec ratification before merge.

| AC / FR | Owning layer | Owning test | Task | Spec §7 assignment | Agreement |
|---|---|---|---|---|---|
| **AC-OBS-001** *(PROPOSED, = FR-OBS-001)* | CI gate + Unit | `scripts/check-edge-fn-error-reporting.mjs`; `src/lib/agent/errorEventSink.test.ts` | C4, C6, C8 | *(absent)* | — |
| **AC-OBS-002** *(PROPOSED, = FR-OBS-002)* | Unit (Vitest) | `src/lib/agent/edgeFunctionNames.test.ts` | C1 | *(absent)* | — |
| **AC-OBS-010** | Unit (Vitest) | `src/lib/agent/reportEdgeError.test.ts` | D3, D4 | Unit — `errorEvent.test.ts` | Agree (split file; same layer) |
| **AC-OBS-011** | Unit (Vitest) | `src/lib/agent/errorEvent.test.ts` | D1, D2 | Unit — `errorEvent.test.ts` | Agree |
| **AC-OBS-020** | Integration (pgTAP) | `supabase/tests/0164_error_events_retention.test.sql` | D5, D6 | pgTAP | Agree |
| **AC-OBS-021** | Integration (pgTAP) | `supabase/tests/0164_error_events_retention.test.sql` | D5, D6 | pgTAP | Agree |
| **AC-HRD-001** | Unit (Vitest) | `src/lib/agent/telegramDrain.test.ts` | A3, A4 | Unit — "telegram drain logic" | Agree — **requires D2** (drain body moves to `logic.ts`; `index.ts` is excluded from unit testing by its own header) |
| **AC-HRD-002** *(PROPOSED)* | Integration (pgTAP) | `supabase/tests/0160_alert_ops_tables_lockdown.test.sql` | A1, A2 | *(absent)* | — |
| **AC-HRD-010** *(PROPOSED, = FR-HRD-010)* | Unit (Vitest) | `src/lib/agent/telegramDrain.test.ts` | A5 | *(absent)* | — |
| **AC-HRD-020** *(PROPOSED, = FR-HRD-020)* | Unit (Vitest) | `src/lib/agent/notifyOwner.test.ts` | A7, A8 | *(absent)* | — |
| **AC-HRD-030 / 031** | — | **EXCLUDED** — branch `fix/nul-grep-blindness` | — | CI gate | Out of scope here |
| **FR-HRD-040** | Integration (pgTAP) | `supabase/tests/0161_contract_value_nonneg.test.sql` | B1, B2 | pgTAP | Agree |
| **FR-HRD-041** | Integration (pgTAP) | `supabase/tests/0162_automation_cap_race.test.sql` | B3, B4 | pgTAP | **Partial disagreement — see §10 Q3** (pgTAP proves the lock is present, not that the race is closed) |
| **FR-HRD-042** | — | **BLOCKED** | — | pgTAP | **Disagree that it is plannable — see §10 Q2** |
| **FR-HRD-043** | CI/manual | `npm ci` in `spike/agent-native-rls` | B5 | *(absent)* | — |
| **AC-PHG-001 / 004** *(PROPOSED, = FR-PHG-001..004)* | Unit (Vitest) | `src/lib/analytics/client.test.ts` | E1, E2 | *(absent)* | — |
| **AC-PHG-010** | Unit (Vitest) | `src/lib/classifyMutationError.analytics.test.ts` | F1, F2 | Unit — "analytics" | Agree |
| **AC-PHG-013** | CI gate | `scripts/check-dashboard-tiles.mjs` | F5, F6, F9 | CI gate | Agree |
| **AC-PHG-030** | Unit (Vitest) | `src/lib/analytics/quota.test.ts` | F8 | Unit — quota script | Agree |
| **FR-PHG-020 / 021** | Manual (provisioning) | `node scripts/posthog/provision-dashboards.mjs` + `check-dashboard-tiles` | F7 | *(absent)* | — |
| **FR-PHG-032** | **Owner action, not code** | PostHog project settings | — | *(absent)* | — |
| **AC-CON-001 / 002 / 004** *(PROPOSED)* | Unit (Vitest) | `client.test.ts`, `AnalyticsOptOutToggle.test.tsx`, `Privacy.test.tsx` | E1–E7 | *(absent)* | — |
| **AC-CON-003** | **E2E (Playwright)** | `e2e/AC-CON-003-analytics-opt-out.spec.ts` | E8, E9 | E2E — "genuinely cross-stack" | Agree it is e2e; **the spec's version would be vacuous — see §10 Q4** |

**AC-id tagging:** Vitest in the `it(...)` title; pgTAP as the leading token of each test
description; Playwright as the leading token of the `test(...)` title with file
`e2e/AC-CON-003-analytics-opt-out.spec.ts`. `grep -r AC-OBS-010` finds exactly one owning proof.

---

## 10. Open questions for the Director / owner

**Q1 — Nine requirements in the spec have no AC id.** FR-OBS-001/002/003, FR-HRD-010/020/043,
FR-PHG-001..004, FR-PHG-020/021, FR-CON-001/002/004/005. §7's traceability table covers ten ACs plus
three bare FRs; the rest are untracked. I have **not invented behaviour** — every "PROPOSED" AC in §9
is a direct restatement of its FR — but they need ratifying into the spec before merge so the tests
trace to a signed id. **This is a spec amendment, not a design change.**

**Q2 — FR-HRD-042 (interactive-create idempotency) is not plannable as written. BLOCKED.** The
requirement is one sentence — "Interactive record creation shall be idempotent under retry" — with
one line of evidence ("idempotency exists only on the bulk-import path, `0072`/`0073`") and **no AC**.
To plan it I need four decisions I refuse to invent:
1. **Which entities?** All 12+ creatable types, or only the money-bearing ones (procurement records,
   invoices, payments, timesheets)?
2. **What is the idempotency key?** A client-minted `client_request_id` UUID per submit (needs a
   column + unique index per table + a FE change in every form), or a natural key (needs a per-entity
   uniqueness decision, and `companies.name` etc. are not currently unique)?
3. **What is "a retry"?** Double-click, React StrictMode double-invoke, a user's browser refresh
   after a timeout, or an automated client retry? The `REQUEST_TIMEOUT` path
   (`classifyMutationError.ts:49`) says "we couldn't confirm whether it saved" — that is the real
   user-facing symptom and it argues for a client-minted key.
4. **What does a duplicate return?** The original row (idempotent success) or a 23505 (duplicate)?
   These are materially different contracts for the FE.

This is a multi-table schema change with an `org_id`/RLS surface and a FE contract. It deserves its
own spec + ADR, not a task in this plan. Everything else in §4.6 is planned and shipping in PR-2.

**Q3 — The FR-HRD-041 pgTAP proves the lock exists, not that the race is closed.** A true two-session
proof needs `dblink` or `pg_background`, neither of which is enabled in this stack (I checked the
existing concurrency tests, e.g. `supabase/tests/0151_timesheet_fence_concurrency.test.sql`). I have
written the test honestly — it asserts the lock is present and the function is `security definer`,
and says so in its own header. **Two options:** (a) accept the structural proof, which is
proportionate given `0059`'s own comment calls this a "soft cap against amplification, not an exact
invariant"; or (b) enable `dblink` in `supabase/config.toml` for the test lane and I will plan a real
two-session test. **My recommendation: (a)** — the cap is a cost-amplification bound, not a money
invariant, and enabling `dblink` widens the DB surface for one assertion.

**Q4 — AC-CON-003 as written would have been a guaranteed vacuous pass.** `getAnalyticsConfig`
(`src/lib/analytics/config.ts:98`) disables analytics whenever `VITE_POSTHOG_KEY` is not a valid
`phc_` key, which is always true in e2e — so "no network request is made to the PostHog host" is
already true today, before any of this work exists. That is the spec's own defect class, reproduced
inside its acceptance test. My fix (Task E8/E9): a second dev server on :3100 with analytics
genuinely enabled, plus a **control** assertion that an opted-in session *does* attempt PostHog
requests. **Cost: one extra Vite process in the e2e lane.** If the Director would rather not pay
that, the alternative is to move AC-CON-003 down to Unit (mock `posthog-js`, assert `posthog.init`
is never called when the preference is set) and lean on the existing ESLint `no-restricted-imports`
rule as the proof that no other module can reach the PostHog host. That is cheaper and genuinely
sound, but it is a layer move and the spec explicitly assigned e2e — so it is the Director's call,
not mine. **I have planned the e2e version.**

**Q5 — Spec §8's own three questions are still open** and I have not answered them:
1. `HEARTBEAT_URL` unset in production. Task A5/A4 add a **daily all-clear on Telegram** so silence
   stops being ambiguous, but that is a mitigation, not the external monitor the spec asks about.
2. Hourly Telegram cadence (**AS-2**) — recorded as an assumption, raised in PR-1's body.
3. 90-day retention (**AS-1**) — recorded as an assumption, raised in PR-4's body.

**Q6 — Two spec statements I could not fully verify and did not act on.**
`recordErrorEvent` currently has 9–10 references in `supabase/functions/` depending on whether `grep`
skips a NUL-containing file; the spec's own §4.5 documents that
`agent-dispatch/dispatcher.ts` is one such file. After `fix/nul-grep-blindness` lands, re-run
`grep -rn "recordErrorEvent" supabase/functions/` and confirm PR-3/PR-4 did not miss a producer that
`grep` was blind to. **I planned against `grep -an` output and the explicit `Deno.serve` inventory,
so this plan does not depend on the blind grep — but the verification step is worth keeping.**

---

## 11. Task count

| Slice | PR | Tasks |
|---|---|---|
| A — Alerting hardening | PR-1 | 9 |
| B — Money & concurrency | PR-2 | 6 |
| C — Edge error coverage | PR-3 | 9 (C8 expands to 22 one-line function edits) |
| D — Pipeline self-report + retention | PR-4 | 7 |
| E — Client config + consent | PR-5 | 10 |
| F — Friction, funnel, quota, tile gate | PR-6 | 11 |
| **Total** | **6 PRs** | **52 tasks** (73 discrete edits counting C8's 22) |
