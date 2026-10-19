# #1216 — Daily statement refresh: design and TDD implementation plan

**Date:** 2026-10-19 · **Status:** Proposed, docs only. Build requires sign-off of `docs/specs/statement-daily-refresh.spec.md`, including D1–D7. **32 tasks**, each a 2–5 minute implementation increment. No task authorises a push/deploy. Director routes the role-checked write-path work to a fresh issue-scoped executor; dev remains the release ceiling.

Read the spec's existing-behaviour evidence table first: every existing-code claim in this plan refers to those cited artifacts, with additional anchors below. Proposed code below is a design, not shipped behaviour. Architectural decision: `docs/adr/0089-statement-refresh-admission.md`.

## Design

### One scheduler decision, two lanes

Keep the five-minute trigger. Replace the whole-handler early return (`supabase/functions/erpnext-sweep/index.ts:2954–2956`) with per-org work selection:

```text
cron tick → fixed handlerEntry instant → load activated orgs
         → schedule work read in groups of <=100 org IDs
         → hourly? legacy stages for all their ordinary candidates
         → due? fenced native statement stage for that org only
         → finally release existing org lease and credential-cache entry
```

UTC minute 0–4 continues to mean hourly legacy work. An idle published org never enters native metadata/report/attempt/batch/publish stages. Non-hourly native work never invokes doctype/outbox/link/ledger/accounting/budget/timesheet/expense stages. Keep the existing per-org lease (`index.ts:654–775`) and native seven-second/five-second limits (`pmo-portal/src/lib/adapterSeam/erpnext/statementReportRefresh.ts:20–21,560–616`). Do not split a lease into concurrently running worker lanes.

Move the first-publication matching decision from `allActiveBindingsHavePublishedStatementGeneration` (`index.ts:958–1051`) into **one** private SQL work helper. Port its valid binding guard, same-instant activation comparison, exact map/company/version match, future-activation guard, six-hour activation window and matching recent-batch window. Do not retain a global “one org accelerates every org” boolean. The native collector's own input/context guards remain unchanged and authoritative (`index.ts:885–913,2973–3011`; `supabase/migrations/0321_financial_statement_incremental_refresh.sql:443–674`).

### Minimal durable state

Use two forward migrations (0331/0332 are available in the inspected migration directory; rebase and use `scripts/renumber-migration.sh` if another lane takes them):

- `supabase/migrations/0331_statement_refresh_schedule.sql`: schedule table, private identity/work helpers, parameterless request RPC, narrow status view and service-only list/admit RPCs.
- `supabase/migrations/0332_statement_refresh_publication.sql`: batch run ID plus exact opener/publisher replacements based on 0321, preserving all native validation/retention/dirty handling.
- Matching `_down.sql` files under `supabase/migrations/rollback/`.

Table sketch (actual new columns; no financial values or requester identities):

```sql
create table public.erp_financial_statement_refresh_schedule (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  completed_day date,
  completed_timezone text,
  completed_identity jsonb,
  request_id uuid,
  requested_at timestamptz,
  last_requested_at timestamptz,
  active_run_id uuid,
  active_started_at timestamptz,
  active_day date,
  active_timezone text,
  active_identity jsonb,
  active_kind text check (active_kind in ('first','daily','manual')),
  active_request_id uuid,
  last_attempt_at timestamptz,
  check ((request_id is null) = (requested_at is null)),
  check ((completed_day is null and completed_timezone is null and completed_identity is null)
    or (completed_day is not null and completed_timezone is not null and completed_identity is not null)),
  check ((active_run_id is null and active_started_at is null and active_day is null
    and active_timezone is null and active_identity is null and active_kind is null and active_request_id is null)
    or (active_run_id is not null and active_started_at is not null and active_day is not null
      and active_timezone is not null and active_identity is not null and active_kind is not null)),
  check (active_request_id is null or (request_id is not null and active_request_id = request_id))
);
alter table public.erp_financial_statement_refresh_schedule enable row level security;
alter table public.erp_financial_statement_refresh_schedule force row level security;
revoke all on public.erp_financial_statement_refresh_schedule from public, anon, authenticated, service_role;
grant select on public.erp_financial_statement_refresh_schedule to service_role;
```

Internal table deliberately has **no authenticated policy/grant**; fixed-search-path definer RPCs are the mutation boundary. The status view is postgres-owned/security-barrier with explicit own-org/active-member/company-reader filtering, like the existing availability-view pattern (`supabase/migrations/0321_financial_statement_incremental_refresh.sql:955–991`). No new general org settings or per-report jobs.

The org primary key bounds request state to one row and supports worker/status lookups. Batch has `refresh_run_id uuid` nullable, permitting pre-feature batches to resume and service-only existing publication callers to retain their contract. The live worker must always call the new fenced admission RPC first. Native-only fairness orders by schedule `last_attempt_at NULLS FIRST, org_id`; it must not reuse legacy watermark recency as statement progress. Legacy order stays as shipped (`index.ts:820–847`).

### Authoritative scheduling algorithm

Signatures in migration 0331:

```sql
-- Private, no public/anon/authenticated/service execute grants:
-- _erp_statement_binding_identity(p_org_id uuid) returns jsonb (NULL if ineligible)
-- _erp_statement_refresh_work(p_org_id uuid,p_tick_at timestamptz) returns jsonb
-- _request_erp_statement_refresh(p_org_id uuid,p_now timestamptz) returns jsonb
-- Service-only:
-- list_erp_statement_refresh_work(p_org_ids uuid[],p_tick_at timestamptz)
--   returns table(org_id uuid,run_statements boolean,last_attempt_at timestamptz)
-- admit_erp_statement_refresh(p_org_id uuid,p_holder uuid,p_tick_at timestamptz)
--   returns boolean
-- Authenticated only, explicitly NOT service/anon/PUBLIC:
-- request_erp_statement_refresh() returns jsonb
```

All functions use `SET search_path = public, pg_temp`; mutations are SECURITY DEFINER. The private identity is `{binding:{id,activatedAt,versionMajor},company,projectMap}` from current binding columns only. Require an activated version-16 binding, object config, `jsonb_typeof(config->'company') = 'string'` with nonblank company, and object map (missing map becomes `{}`); database UUID types supply UUID validation. Compare publication/batch activation text by timestamptz instant after validating its presence; compare map JSON with `=` (not subset containment). Compare only this binding identity subset, not the ERP metadata/calendar fields nested elsewhere in trusted contexts. Context tables are machine-private in migration source (`0321_financial_statement_incremental_refresh.sql:20–31`).

`_erp_statement_refresh_work` returns `{run,kind,day,timezone,identity}`. Capture `p_tick_at` once at handler entry and use it for all work decisions in that tick. It performs only DB reads:

1. Read identity and organisation timezone; return `run:false` for ineligible identity, missing org or invalid timezone. `day := (p_tick_at AT TIME ZONE timezone)::date`. Ignore profiles/personal preferences.
2. Find a committed native publication for that exact identity using trusted published context and its matching snapshot/source generation. This is the first-publication witness. If schedule has no completed marker, use the newest such publication's `as_of` local date as a read-only rollout baseline. Persist that baseline at next fenced admission, not during listing or a browser read.
3. Calculate `hourly := extract(minute from p_tick_at AT TIME ZONE 'UTC') < 5`. Calculate initial `first_fast`: no matching publication AND activation is not future AND (activation age < six hours OR exact-identity batch age is in [0,six hours)). Preserve exact boundary polarity.
4. If an active run exists, **do not create another daily run**. For active first-kind runs without a manual capture, allow continuation iff `hourly OR first_fast`; for active daily/manual runs allow iff `hourly OR (0 <= tick-start < six hours)`. A pending request arriving later does not renew this window. A stale active identity/timezone is replaced only under admission, retaining the original `active_started_at` and captured receipt.
5. With no active run, pending request wins (`kind:manual`, run now); otherwise a matching publication with absent/older completed day, changed timezone or changed completed identity is `kind:daily`, run now. With no matching publication, `kind:first`, run only iff `hourly OR first_fast`. Completed day greater than today is not due in the same timezone (clock rollback); timezone/identity changes still require one re-establishment. No dirty-date predicate is used.
6. Otherwise return `run:false`. New manual/daily demand coalesces with one active run according to D2/D3; a later request survives for its follow-up.

`list_erp_statement_refresh_work` rejects NULL tick, more than 100 IDs or malformed input; deduplicates IDs and calls the private work helper once per ID, returning only those IDs' flags/attempt stamps. It does not list another org or return identity/context. It is service-only. Native candidate sorting is stable by `last_attempt_at NULLS FIRST,org_id`; the remaining tick budget prevents entering the native collector after budget exhaustion.

`admit_erp_statement_refresh` takes locks in the existing publication order **lease row → binding row → schedule row**, validates holder/expiry and recomputes work. Insert missing schedule row with `ON CONFLICT DO NOTHING` while binding row is held. If no longer due, return false. For a genuinely new run set UUID, pinned day/timezone/identity/kind/first-admission time, and `active_request_id := request_id`. Before creating it, check for an existing exact-compatible native batch without schedule linkage: adopt that batch's `started_at`, `effective_date` and `planning_timezone` as the run's original start/day/timezone; set kind to first if no exact publication exists, otherwise daily. Capture an outstanding receipt only if `requested_at <= batch.started_at`; a later receipt is a follow-up. Treat that batch as a virtual active run in the work helper even before the schedule row exists, applying its original bounded continuation window. A pre-feature batch with NULL planning fields must be rebuilt, not credited with a fabricated day. For a resumed run update only last attempt, unless binding/timezone changed: discard incompatible pending batch under the same lease, mint a replacement run ID/pinned day/context but keep original fast-window start and captured request ID. Recheck lease before returning true. Missing schedule completed baseline comes only from the exact-current publication in step 2. No user/client clock is accepted; `p_tick_at` exists only on service APIs for deterministic worker/test decisions.

### Request/acknowledgement contract

Parameterless outer RPC authorises before the private enqueue helper:

```sql
if public.auth_org_id() is null
   or not coalesce(public.is_active_member(),false)
   or coalesce(public.auth_role()::text,'') not in ('Admin','Finance') then
  raise exception 'Not permitted' using errcode='42501';
end if;
return public._request_erp_statement_refresh(public.auth_org_id(),clock_timestamp());
```

The private helper locks the current binding, checks `_erp_statement_binding_identity`, creates/locks its schedule row, then runs this exact decision core:

```sql
if v_state.request_id is not null then
  return jsonb_build_object('outcome','queued','requestId',v_state.request_id,
    'requestedAt',v_state.requested_at,
    'retryAfter',v_state.last_requested_at + interval '5 minutes');
end if;
if v_state.last_requested_at is not null
   and p_now < v_state.last_requested_at + interval '5 minutes' then
  return jsonb_build_object('outcome','cooldown','retryAfter',
    v_state.last_requested_at + interval '5 minutes');
end if;
v_request_id := gen_random_uuid();
update public.erp_financial_statement_refresh_schedule
set request_id=v_request_id, requested_at=p_now, last_requested_at=p_now
where org_id=p_org_id;
return jsonb_build_object('outcome','queued','requestId',v_request_id,
  'requestedAt',p_now,'retryAfter',p_now + interval '5 minutes');
```

No active-run field is changed by enqueue; automatic runs already in progress therefore cannot consume a request they never captured. Missing/ineligible binding raises `55000` with a generic connection-unavailable message. Idempotency is bounded to an outstanding receipt; this is not a generic exactly-once API for arbitrarily delayed retries after completion. The cooldown additionally bounds rapid repeat captures after fast success.

At new batch insertion, copy active run ID into `refresh_run_id`. On resuming an old NULL-linked exact-compatible batch after fenced admission, attach it to the current active run; do not reset its acquired reports, dirty cutoff, started time or planning date. For an adopted pre-feature batch, keep its original effective date as the run's acknowledgement day, never the day the schedule row happened to be created; publication therefore leaves a later day's obligation due under D2. A request accepted after that old batch began remains a follow-up, not a captured request. New batches use their existing organisation-local planning logic. If planning timezone or run identity is incompatible, opener rebuilds as it already does for incompatible context (`0321_financial_statement_incremental_refresh.sql:246–257`).

In the existing publisher, **before** deleting the batch, after all validation/insertion/dirty acknowledgement succeeds:

```sql
if v_batch.refresh_run_id is not null then
  select * into v_schedule from public.erp_financial_statement_refresh_schedule
   where org_id=p_org_id for update;
  if not found or v_schedule.active_run_id is distinct from v_batch.refresh_run_id
     or v_schedule.active_identity is distinct from public._erp_statement_binding_identity(p_org_id)
     or v_schedule.active_timezone is distinct from
       (select default_timezone from public.organizations where id=p_org_id)
     or v_batch.planning_timezone is distinct from v_schedule.active_timezone then
    raise exception 'statement refresh admission changed' using errcode='55000';
  end if;
  update public.erp_financial_statement_refresh_schedule
  set completed_day=v_schedule.active_day,
      completed_timezone=v_schedule.active_timezone,
      completed_identity=v_schedule.active_identity,
      request_id=case when request_id=v_schedule.active_request_id then null else request_id end,
      requested_at=case when request_id=v_schedule.active_request_id then null else requested_at end,
      active_run_id=null, active_started_at=null, active_day=null, active_timezone=null,
      active_identity=null, active_kind=null, active_request_id=null
  where org_id=p_org_id;
end if;
```

SQL UPDATE right-hand sides read the pre-update row. Publication's existing early idempotent snapshot return (`0321_financial_statement_incremental_refresh.sql:701–710`) remains **before acknowledgement**: replay must not clear a later request. Retain the terminal lease check so acknowledgement rolls back on expiry. Lock schedule before batch/dirty advisory work in both opener/publisher after lease+binding locks, maintaining one lock order. Enqueue never acquires a lease or batch lock, so there is no inverse dependency.

### Browser and UX contract

Do not change saved catalogue/read envelopes or their strict parser. Add a separate narrow REST status read, avoiding another large catalogue RPC. `erp_financial_statement_refresh_status` exposes exactly `available,queued,running,follow_up_queued,retry_after,timezone,last_published_at`; filter to `auth_org_id()`, active membership and roles Admin/Finance/Executive. Return one row for an eligible binding, none otherwise. `queued := request_id IS NOT NULL`, `running := active_run_id IS NOT NULL`; both may be true. `follow_up_queued := active_run_id IS NOT NULL AND request_id IS NOT NULL AND active_request_id IS DISTINCT FROM request_id` distinguishes a later receipt from the request currently being processed. Last publication comes from the saved availability surface, not last attempt. Never select the schedule table from the browser.

New types in `pmo-portal/src/lib/statementRefresh.ts`:

```ts
export type StatementRefreshReceipt =
  | { outcome: 'queued'; requestId: string; requestedAt: string; retryAfter: string }
  | { outcome: 'cooldown'; retryAfter: string };
export type StatementRefreshStatus = {
  available: boolean;
  queued: boolean;
  running: boolean;
  followUpQueued: boolean;
  retryAfter: string | null;
  timezone: string;
  lastPublishedAt: string | null;
};
```

`financialStatementsRepository.refreshStatus(): Promise<StatementRefreshStatus | null>` reads status via the DAL (`null` means unavailable); `requestRefresh(): Promise<StatementRefreshReceipt>` calls only `supabase.rpc('request_erp_statement_refresh')`. Strictly parse booleans, UUID receipt, finite ISO instants, nonblank timezone and the declared union; malformed data becomes `AppError` with code `statement-invalid-response`. Preserve server error codes. Do not add org parameters.

Extend `useFinancialStatements.ts`'s private live-auth helper to export a narrowly named `useStatementLiveAuth` for the new hook; preserve existing identity-parts/epoch/retirement semantics (`pmo-portal/src/hooks/useFinancialStatements.ts:103–145,179–217`). New `useStatementRefresh` uses that identity, real/effective role and `may('refresh','financialStatements',{record:{viewOnly:effectiveRole!==realRole}})`. Add action `'refresh'`; only this entity receives it. Policy requires `!ctx.record?.viewOnly` and Admin/Finance. Other read/write policies are unchanged.

Status key: `['financial-statements', ...identityParts, 'refresh-status']`. Mutation captures identity/epoch plus a view-as epoch before awaiting; ignore late success/error and avoid invalidation if current identity/epoch/eligibility changed. Increment the local view-as epoch on every effective/real-role mismatch transition, including leaving and re-entering view-as, so a stale mutation cannot become visible after a round trip through preview. Recheck live admission on imperative submission, not only in the rendered button. One in-flight ref prevents double-clicks before rerender. Use mutation `retry:false`; explicit retry returns the outstanding receipt if the first response was lost.

When queued/running, status `refetchInterval` is 15,000 ms; `refetchIntervalInBackground:false`; hide/unauthorise/unmount stops polling, including a visibility check for the interval callback. Stop after idle, but refetch on window focus. A status transition in `lastPublishedAt` invalidates only the exact identity's catalogue/detail queries; it must not recursively invalidate its own status key or mapped-project-name queries. Request success invalidates that identity's status key; retain old saved statements while awaiting publication. Keep completed receipt feedback local only until status confirms queue/running; no optimistic financial timestamp.

Operate-mode surface, incumbent `DESIGN.md` tokens: add a compact wrapping row above the existing controls, no new card/dashboard. Text: `Refresh daily at midnight · {timezone}`. Link-styled **button** (`type=button`, underline, existing AA text token, focus ring, `.touch-target`) is an action, not navigation; do not use `href="#"`. Pending label `Queuing refresh…`; queued `Refresh queued`; running `Refreshing saved statements…`; only `followUpQueued` adds `Another refresh is queued`; a captured manual request being processed must not imply another run. Inactive action has `disabled` and `aria-describedby` pointing to state/cooldown text. Persistent local error uses `role=alert` and `Couldn't queue refresh. Try again.`; an unavailable status read uses `Refresh status unavailable` and a separate read Retry. Existing statement Retry only reloads saved data (`FinancialStatementsSection.tsx:78–103`). Existing provenance remains untouched; the displayed publication timestamp must not be described as every historical report's acquisition time.

Locales in `pmo-portal/public/locales/{en,id}/common.json`: `refreshNow` = `Refresh now` / `Perbarui sekarang`; `queueing` = `Queuing refresh…` / `Mengantrekan pembaruan…`; `queued` = `Refresh queued` / `Pembaruan dalam antrean`; `workerRunning` = `Refreshing saved statements…` / `Memperbarui laporan tersimpan…`; `followUpQueued` = `Another refresh is queued` / `Pembaruan berikutnya dalam antrean`; `dailySchedule` = `Refresh daily at midnight · {{timezone}}` / `Diperbarui setiap hari pada tengah malam · {{timezone}}`; `queueFailed` = `Couldn't queue refresh. Try again.` / `Pembaruan belum dapat diantrekan. Coba lagi.`; `statusUnavailable` = `Refresh status unavailable` / `Status pembaruan tidak tersedia`; `retryAfter` = `You can request another refresh after {{time}}` / `Anda dapat meminta pembaruan lagi setelah {{time}}`. Place all under `financialStatements`. Format time with the existing format helpers; the schedule label names organisation timezone even if a user's timestamp display preference differs.

### Risks, alternatives and scalability

- A full native catalogue may not complete at midnight; D1 is start-time semantics. No completion SLA is invented.
- The native stage precedes the hourly ledger feed in the shipped cycle (`index.ts:702–723`); a dirty change first observed after publication waits until the next admitted run. D5 explicitly needs sign-off. Do not silently make dirty markers an hourly refresh trigger.
- Per-org row locks bound coalescing/races; use a two-session integration test, not just sequential `ON CONFLICT` reasoning. Never hold a transaction across ERP calls.
- Old source calculations remain parked; do not broaden into ledger arithmetic or prune native history.
- Work listing currently depends on loading activated bindings; bound all new SQL/RPC input arrays and HTTP projections. This is O(orgs), not O(users/clicks). Check EXPLAIN on org/binding/context/snapshot joins and avoid reading report bodies. Millions of orgs require measured fleet partitioning, outside this issue; never claim the existing full-fleet loader already solves that scale.
- Persist last-attempt ordering independently of legacy watermarks to avoid repeatedly giving the native budget to the same head org. An exhausted collector segment must not suppress hourly recovery stages.
- Private status/request failures never clear a known catalogue or imply zero values. Polling reads saved state only and shares one query key per identity.
- Preserve 0330's org-cascade behaviour (`supabase/migrations/0330_statement_dirty_org_delete.sql:19–24`) and all existing RLS/private raw-report boundaries. This plan describes desired controls, not an open-defect inventory.

## Verification commands and task discipline

Commands below run from repository root. Define these local shell functions once for the build session (no credentials or remote target):

```bash
DB1() { scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0331_statement_refresh_schedule.test.sql supabase/tests/0331_statement_refresh_request.test.sql'; }
DB2() { scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0332_statement_refresh_publication.test.sql supabase/tests/0319_financial_statement_native_reports.test.sql supabase/tests/0321_financial_statement_incremental_refresh.test.sql'; }
EDGE() { (cd supabase/functions/erpnext-sweep && deno test --allow-all statementDailyCadence.test.ts statementHandlerCadence.test.ts statementSingleFlight.test.ts statementReportBatch.test.ts); }
UNIT() { scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run "$@"' _ "$@"; }
```

DB1/DB2 deliberately reset and test within one lock because Tasks 1–14 edit migrations; never test an edited migration against a stale or sibling schema. After schema edits stop, use the non-reset targeted commands in Task 31. Write each task's failing test first and observe its actual failing assertion, then implement only that increment, rerun its listed command, and refactor only while green. Missing exports/functions/schema are acceptable first REDs, not final verification. Retain existing tests; changes to assertions are allowed only for the explicitly superseded cadence oracle, never to hide regressions. Each task below states its ACs; supporting tests do not change the canonical owners in the final table.

### 1. Schedule storage and access contract — 3 min (AC-005, AC-013)

Create `supabase/tests/0331_statement_refresh_schedule.test.sql` and `supabase/tests/0331_statement_refresh_request.test.sql` with transactional `begin; create extension if not exists pgtap; select no_plan();` fixtures and `finish(); rollback;`. First assertions: table existence, exact column names/types from the table sketch, forced RLS, org cascade and lack of direct INSERT/UPDATE/DELETE/TRUNCATE for every application role. Record role-table ACL assertions via `has_table_privilege` and PUBLIC ACL expansion, not policy-text search. Add the exact table DDL above to `0331_statement_refresh_schedule.sql`. Use only synthetic org/profile fixtures; reuse the role-claim setup pattern in `supabase/tests/0318_financial_statement_reads.test.sql` without copying any customer values. Verify RED before migration, then `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0331_statement_refresh_schedule.test.sql supabase/tests/0331_statement_refresh_request.test.sql'` as one lock hold.

### 2. One eligible-binding identity helper — 4 min (AC-003, AC-005)

In the schedule pgTAP file write a table-driven helper test for activated/current binding, absent map → `{}`, blank company, nonobject map, unsupported version, absent activation, and activation represented with equivalent offsets. Implement `_erp_statement_binding_identity(uuid)` in migration 0331 using `jsonb_build_object` from the current binding and the exact guards in Design. NULL for ineligible; do not expose a user callable or fields beyond the identity subset. Verify `DB1`; mutation check changing the version guard to accept another version must fail its test, then restore.

### 3. Daily due predicate and timezone vectors — 5 min (AC-001)

Write pgTAP work-helper assertions at `2026-10-19T18:29:59Z` and `18:30:00Z` for Asia/Kolkata; `2026-10-20T03:59:59Z`/`04:00:00Z` for America/New_York; `23:59:59Z`/next `00:00:00Z` for UTC. Also cover DST spring/fall dates using `AT TIME ZONE`'s local calendar day, not 24-hour arithmetic, missed three days, unchanged same day, clock rollback and personal-preference independence. Add `_erp_statement_refresh_work`'s daily/baseline branches exactly as algorithm steps 1/2/5/6, using real trusted-context+snapshot fixtures for the baseline. Verify `DB1`.

### 4. Preserve bounded first-publication semantics — 5 min (AC-003)

In the schedule test add first-publication vectors: new activation age 5:59:59 vs 6:00:00; old activation without batch; matching batch age 5:59:59 vs 6:00:00; future activation; company/map/version/activation mismatch; exact publication suppresses the exception. Add algorithm step 3 and the first-kind active branch. A future activation cannot borrow a recent batch fast exception. Test both `Z` and equivalent offset serialization from committed context. Verify `DB1`. These are supplementary SQL proofs; AC-003's canonical owner remains the real handler test added in Task 16.

### 5. Fenced admission and constant-size run state — 5 min (AC-001, AC-002)

Add pgTAP assertions for two holders, expired holder, not-due admission and a repeated admitted run returning the same active UUID/day/start/receipt. Implement `admit_erp_statement_refresh(uuid,uuid,timestamptz)` with lease→binding→schedule lock order and algorithm's exact updates. Add active daily/manual six-hour continuation in work helper step 4. Assert completion-after-midnight will still acknowledge admission day by inspecting the pinned `active_day`; Task 12 proves actual publication. Verify `DB1`.

### 6. Authorised parameterless enqueue — 4 min (AC-005)

Add owning `AC-005 #1216` pgTAP role-matrix assertions for Admin/Finance allow, Executive/PM/Engineer deny, inactive/banned profile deny, anonymous deny, changed org identity isolation and ineligible connection refusal. Assert the public function has zero parameters and grant boundaries for all new private/service/public functions. Implement the outer auth check and private enqueue core in Design; fix search paths, revoke PUBLIC/anon/service execute on public request and grant authenticated only. Private helpers have no application execute grants. Verify `DB1`; locally mutate the outer role check to unconditional allow and confirm the denied-role assertion goes RED, restore and rerun green.

### 7. Coalescing and cooldown boundary — 4 min (AC-006)

Add owning `AC-006 #1216` cases to the request pgTAP file: original UUID/timestamp returned on repeat, active manual capture repeat, automatic run with NULL captured receipt leaves one queued follow-up, quick completion followed by request returns cooldown, exactly `last_requested_at + interval '5 minutes'` accepts one new receipt. Call the private time-parameterised helper as the test owner only for deterministic clocks; test the public RPC separately under real role claims. Complete the private enqueue helper using Design's exact core; never update active run fields on enqueue. Verify `DB1`.

### 8. Safe status view — 4 min (AC-008)

Add owning `AC-008 #1216` assertions for one own-org status row, captured-manual versus later-follow-up status, and exactly the seven documented output columns; other org, inactive, anonymous, project-only roles get no accessible status. Assert no report/binding/request identity projection. Add `erp_financial_statement_refresh_status` as the narrow security-barrier view described above, postgres-owned, revoke all then grant SELECT authenticated. Derive `retry_after` from last acceptance, `last_published_at` from saved availability; missing schedule means idle, not unavailable if binding itself is eligible. Verify `DB1`.

### 9. Bounded worker work listing — 3 min (AC-001, AC-004)

Add pgTAP cases for empty, duplicate, two-org and 101-ID lists, NULL tick, and service versus user execution. Implement `list_erp_statement_refresh_work(uuid[],timestamptz)` with cardinality <=100 and `SELECT DISTINCT` unnest; call the one private helper per requested org, return flag and last-attempt only. No scheduling writes during list/status. Verify `DB1`; record EXPLAIN for a 100-ID synthetic set and ensure org PK/binding key/indexed trusted-context lookup paths rather than snapshot payload scans.

### 10. Context/zone changes do not renew fast windows — 4 min (AC-001, AC-002, AC-007)

Write pgTAP tests changing binding activation/map/company and organisation timezone while an admitted run has staged work. Implement admission's replacement branch: new run ID and pinned day/timezone/identity, preserved original `active_started_at`/`active_request_id`, delete incompatible pending batch under the held lease. A late queued receipt remains queued. Include organisation deletion with active schedule and a peer org control; preserve the 0330 trigger unchanged. Verify `DB1`.

### 11. Attach batches to admitted runs — 4 min (AC-002, AC-007)

Create `supabase/tests/0332_statement_refresh_publication.test.sql` starting with an isolated copy of the **synthetic fixture setup** from `supabase/tests/0321_financial_statement_incremental_refresh.test.sql:122–157`, changing every synthetic fixture UUID to this test's namespace. Do not import another whole test suite. Add assertions for new/legacy-compatible batch attachment and incompatible run refusal, including an old batch admitted before midnight and a manual receipt queued after that batch started: adoption pins the old effective day and leaves that receipt uncaptured. Add `refresh_run_id uuid` to batch in migration 0332. Copy the complete current `open_erp_statement_report_batch` definition from `0321_financial_statement_incremental_refresh.sql:186–382` into migration 0332; after lease/binding locking, lock schedule; at insertion copy active UUID; on exact compatible resume attach a NULL link, reject a different non-NULL active run link. Preserve the current JSON return keys byte-for-byte. With no active schedule, existing service-only callers retain NULL linkage and cannot acknowledge schedule. Verify `DB2` and `scripts/with-db-lock.sh supabase test db supabase/tests/0321_financial_statement_incremental_refresh.test.sql`.

### 12. Acknowledge only successful matching publication — 5 min (AC-001, AC-002, AC-007)

Write the owning `AC-002 #1216` and `AC-007 #1216` assertions using complete staged **native** synthetic reports: before commit old snapshot/day/request unchanged; after success new snapshot plus admitted day, clear captured receipt only, preserve follow-up receipt and newer dirty revision. Copy the complete current publisher from `0321_financial_statement_incremental_refresh.sql:663–904` **using function boundaries, not a truncated line copy** into migration 0332, then apply the acknowledgement block in Design before its batch deletion. Add `v_schedule` row variable and acquire its row after lease/binding locks, before batch/advisory locks. Retain native plan/retention/integrity/precision/capture-window checks and idempotent return; do not wrap/rename the publisher or change its signature. Verify `DB2` and the existing 0319/0321 publication suites with `scripts/with-db-lock.sh supabase test db supabase/tests/0319_financial_statement_native_reports.test.sql supabase/tests/0321_financial_statement_incremental_refresh.test.sql`.

### 13. Publication rollback and lost-response fencing — 4 min (AC-002, AC-007)

Extend the publication pgTAP test: incomplete batch, changed binding, expired lease, mismatched run ID and changed timezone all preserve prior catalogue/day/request; retry already-published batch after a new receipt is queued leaves that receipt untouched. Use exception-catching subtransactions to inspect rollback. Adjust migration 0332's acknowledgement guards and leave the existing terminal lease test after all schedule mutations. Assert unchanged historical raw responses/acquiredAt and dirty revisions beyond cutoff, not just row counts. Verify `DB2`.

### 14. Reversible migration proof — 5 min (AC-013)

Extend `scripts/financial-statements-rollback.test.mjs` with case `AC-013 #1216` using its existing local-only file-read/SQL execution harness. Build one transaction containing pgTAP `no_plan()` assertions and the **actual file contents** of both down and forward migrations read by the host; do not assume test containers mount sibling migration files or duplicate migration bodies into a test. First assert pending/active-state rollback guard refuses destructive rollback using `throws_ok` on the down-file SQL string. Clear only its own synthetic queue/run, retain a native snapshot and dirty marker, execute down 0332 then down 0331, assert snapshot/dirty rows survive and original opener/publisher bodies/grants match saved pre-feature definitions. Execute forward 0331 then 0332, assert restored contracts, `finish()` and rollback the whole test. The Node case must require SQL process success, at least one TAP plan and no `not ok` TAP lines (including padded/NOTICE-prefixed failure output); missing output is failure. Down 0332 restores full 0321 opener/publisher definitions **before** dropping batch column; down 0331 drops view/RPCs/helpers before schedule table. Take an ACCESS EXCLUSIVE lock on the schedule table before checking demand and hold it through the down transaction. Guard before any drop if any request or active run exists; pause/drain the worker and request ingress first for an operator rollback, never erase intent silently. Verify `scripts/with-db-lock.sh node --test --test-name-pattern='AC-013 #1216' scripts/financial-statements-rollback.test.mjs`.

### 15. Two-session enqueue/publication interleaving — 5 min (AC-006, AC-007)

Add a supplementary case to `scripts/financial-statements-publication-race.test.mjs` using its existing local DB subprocess harness. Create a unique synthetic org/binding/Finance fixture; session A holds its binding row, queues through the public authenticated RPC, session B concurrently calls the same RPC after A commits. Assert both JSON receipts have identical IDs/time and one outstanding row. Second interleaving: enqueue after automatic admission but before matching publication; assert publication preserves the follow-up. Always clean up own fixture in finally; reject non-local execution using the harness's existing target check. Verify `scripts/with-db-lock.sh node --test scripts/financial-statements-publication-race.test.mjs`. Canonical AC ownership stays pgTAP; this proves actual lock interleaving rather than sequential simulation.

### 16. Real-handler scheduling harness — 4 min (AC-003, AC-004)

Create `supabase/functions/erpnext-sweep/statementDailyCadence.test.ts` by extracting the request-recording fixture mechanics from `statementHandlerCadence.test.ts:1–220`, keeping the import of shipped `./index.ts` and `globalThis.fetch` interception. Extend mocks for work-list/admission RPC responses. Write owning `AC-003 #1216` assertions with mixed new/old/published/future/mismatched/expired orgs and exact six-hour boundaries. Change the existing cadence test's superseded **whole-sweep fast** oracle to native-only while preserving its published-context/age/map/unsupported/maintenance-route assertions. Do not duplicate a production scheduler in the test; fixture expected work flags and assert shipped handler calls. First RED: handler never calls the new RPC and still accelerates legacy work. Verify `EDGE` after Task 18.

### 17. Explicit cycle lane inputs — 5 min (AC-004)

In `index.ts` extend `OrgBinding` with `sweepWork?: { legacy: boolean; statements: boolean }`. Existing unit callers with this field absent retain both=true for compatibility; the **live handler always supplies explicit flags**. In `runErpSweepCycle`, skip an org before lease/cache/client work when both false; wrap legacy stages 1/2/2b and 3–7 in `if (work.legacy)`; wrap native stage in `if (work.statements)`. Keep native position between the legacy halves and try/catch resilience/finally release. Add supporting cycle-level cases to `supabase/functions/erpnext-sweep/statementSingleFlight.test.ts`; verify that file independently with `(cd supabase/functions/erpnext-sweep && deno test --allow-all statementSingleFlight.test.ts)` before live wiring. Retain the pending owning `AC-004 #1216` handler assertions from Task 16: one idle and one queued org, hourly and minute-30 calls, zero idle native RPC/metadata/report calls, zero nonhourly legacy calls, native failure does not skip hourly ledger/timesheet. Also assert an unavailable native budget does not swallow legacy reconciliation. Handler RED is resolved by Task 18; cycle supporting assertions must be green now.

### 18. Wire per-org work and fenced native admission — 5 min (AC-003, AC-004)

In the shipped handler replace the global early return with one `listEmployingOrgsLive` load and <=100-ID `list_erp_statement_refresh_work` RPC calls using `new Date(handlerEntryMs).toISOString()`. Set `legacy = new Date(handlerEntryMs).getUTCMinutes() < 5`; `statements` from validated returned flags only. On work-read failure, log a bounded safe event, set statement flags false, continue hourly legacy stages; between hours return skipped with zero ERP calls. In `refreshNativeStatements` callback call `admit_erp_statement_refresh` before `erpClientForOrg`; false returns without an ERP call, error is a safe native admission error. Preserve remaining tick budget passed to collector. Remove `allActiveBindingsHavePublishedStatementGeneration` and its now-unreferenced cadence-only types/functions/constants; retain `nativeStatementBindingContext` for collector validation. Ported SQL tests preserve the removed helper's semantics. Verify `EDGE`.

### 19. Budget/fairness and no-op regression — 4 min (AC-003, AC-004)

Add handler/cycle tests with two due orgs and an exhausted tick budget: last-attempt-stalest native candidate gets first access; unattempted org keeps demand and gets priority next tick; legacy hourly candidate ordering remains unchanged. Sort the native-only candidate list by work-list attempt stamp/UUID, but do not reorder hourly legacy orgs. If a legacy+native hourly tick is budget constrained, do not write a new attempt stamp without entering admission, and never clear demand for a skipped segment. Check zero credentials resolved for all-idle nonhourly tick and one cache cleanup per processed org. Verify `EDGE` and `(cd supabase/functions/erpnext-sweep && deno test --allow-all sweepTickBudget.test.ts statementLegacyCompatibility.test.ts)`.

### 20. Typed status/receipt DAL — 5 min (AC-010)

Create `pmo-portal/src/lib/statementRefresh.ts` with the exact union/status types in Design plus strict `parseStatementRefreshReceipt(unknown)` and `parseStatementRefreshStatus(unknown)` exports. Add DAL exports in `pmo-portal/src/lib/db/financialStatements.ts`: `getStatementRefreshStatus()` selects the seven status-view columns with `.maybeSingle()` and maps snake_case to typed camelCase; `requestStatementRefresh()` calls the parameterless RPC. Extend `financialStatements.test.ts` with malformed object/UUID/timestamp/booleans, null status, server error preservation and exact no-org/no-period call assertions before implementation. Regenerate `pmo-portal/src/lib/supabase/database.types.ts` against the locked local migrated DB with `scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`; review/revert unrelated generator drift only, not feature types. Verify `UNIT src/lib/db/financialStatements.test.ts` and `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'`.

### 21. Repository seam — 3 min (AC-010)

In `pmo-portal/src/lib/repositories/financialStatements.test.ts` test `refreshStatus()`/`requestRefresh()` delegate without arguments and convert errors through `toAppError`. Add those exact methods to `financialStatements.ts` and `FinancialStatementsRepository` in `pmo-portal/src/lib/repositories/types.ts:787–790`, using the new types from `statementRefresh.ts`. Update explicit typed repository mocks in affected tests with status/request stubs; do not make interface methods optional. Verify `UNIT src/lib/repositories/financialStatements.test.ts` and locked typecheck command from Task 20.

### 22. Refresh permission — 3 min (AC-009)

Add owning `AC-009 #1216` cases to `pmo-portal/src/auth/policy.test.ts`: five roles × viewOnly true/false; null role denies; existing financialStatements view list unchanged. Add `'refresh'` to Action, then `refresh: (role,ctx) => !ctx.record?.viewOnly && (role === 'Admin' || role === 'Finance')` to only the `financialStatements` entry. Do not reuse view permission for a write. Verify `UNIT src/auth/policy.test.ts src/auth/usePermission.test.tsx`.

### 23. Identity-scoped status query and bounded polling — 5 min (AC-010)

Create `pmo-portal/src/hooks/useStatementRefresh.ts` and owning `useStatementRefresh.test.tsx`. Test eligible Admin/Finance/Executive status read, inactive/session-profile mismatch denial, queued/running 15s polling, hidden idle/unmount stop and focus refetch, and distinct org/user/role keys. Export/rename the existing private `useLiveAuth` as `useStatementLiveAuth` in `useFinancialStatements.ts`; use its existing epoch/ref contract rather than a parallel identity implementation. Implement status query with the key and interval rules in Design, `retry:false`. Verify `UNIT src/hooks/useStatementRefresh.test.tsx src/hooks/useFinancialStatements.permissions.test.tsx`.

### 24. Nonoptimistic request mutation — 4 min (AC-010)

Test new hook `requestRefresh(): Promise<void>` handles accepted/cooldown/error and a same-event-loop double click with only one repository call; `canRequest` combines live identity, policy/viewOnly, eligible status, outstanding request/in-flight and authoritative retry time. Return `status, statusPending, statusError, retryStatus, canRequest, requestPending, requestError, requestRefresh` from the hook. Implement the imperative guard/in-flight ref, no auto mutation retry, accepted status-key invalidation and no optimistic asOf. Cooldown returns its retryAfter and triggers authoritative status refetch; a bounded timer re-enables affordance at cooldown expiry without an ERP call. Verify `UNIT src/hooks/useStatementRefresh.test.tsx`.

### 25. Late-result retirement and publication invalidation — 4 min (AC-010)

Write deferred-promise tests: request/status result after logout/org switch/role loss/view-as change cannot expose a receipt/error or invalidate the new identity; status publication transition invalidates only matching identity catalogue/read keys once, not project-name or status itself. Implement identity+epoch checks before/after awaits and feature retirement using existing statement hook semantics; cancel/remove retired query keys on identity loss. Include the case of a response lost after acceptance followed by explicit retry returning the original outstanding receipt. Verify `UNIT src/hooks/useStatementRefresh.test.tsx src/hooks/useFinancialStatements.permissions.test.tsx`.

### 26. Page action and queue/running states — 4 min (AC-011)

Create `pmo-portal/pages/__tests__/FinancialStatements.refresh.test.tsx` using existing page scope test providers. Add owning `AC-011 #1216` tests for Finance/Admin action, Executive status without action, unavailable first-publication page with eligible action, ineligible connection no action, and no action in view-as. In `pmo-portal/pages/FinancialStatements.tsx` mount the hook unconditionally; add the compact status/action row before catalogue controls. Use the exact button/status grammar in Design, preserve all picker selections and saved `detailRead.generation.asOf`. A known queued receipt disables duplicate click until server status settles. Verify `UNIT pages/__tests__/FinancialStatements.refresh.test.tsx pages/__tests__/FinancialStatements.scope.test.tsx`.

### 27. Errors and read-retry separation — 3 min (AC-011)

Add page assertions for failed request persistent alert with old rows/selection intact; lost request response does not display unconfirmed success; failed status read has its own read Retry; existing section Retry invokes only saved-read refetch and never requestRefresh. Implement these local error branches beside the queue row, not by replacing the statement section. Do not overload `FinancialStatementsSection`'s existing refreshing/read-retry strings with worker state. Verify `UNIT pages/__tests__/FinancialStatements.refresh.test.tsx`.

### 28. Locale/a11y/phone retention — 4 min (AC-011)

Add the nine exact English/Indonesian entries from Design to `pmo-portal/public/locales/en/common.json` and `id/common.json`, rebasing translation edits immediately before the eventual code PR. Extend page tests for both locales, the timezone schedule label, semantic button (not fake navigation), `role=status` feedback, disabled described-by text, keyboard activation and axe on idle/queued/error. Use `min-w-0 flex-wrap`, existing AA text/focus/touch-target tokens; no new visual system. Verify `UNIT pages/__tests__/FinancialStatements.refresh.test.tsx`, `(cd pmo-portal && npm run check:i18n)` and `(cd pmo-portal && npx eslint --max-warnings=0 pages/FinancialStatements.tsx pages/__tests__/FinancialStatements.refresh.test.tsx)`.

### 29. One real queue-persistence browser journey — 5 min (AC-012)

Create `pmo-portal/e2e/serial/AC-012-statement-refresh-queue.spec.ts`, header `// @e2e-isolation: serial — queues an org-global statement request on the shared synthetic Finance organisation.` Read `docs/e2e-parallel-conventions.md` first. Use existing `signIn` from `pmo-portal/e2e/helpers.ts` and local fixture access already used by serial integration specs; record the synthetic org's original binding/schedule state, configure only an eligible synthetic binding with no saved publication, and restore in `afterEach` even on assertion failure. No customer fixture, remote ERP, served-worker call, CI-dependent gate or mock of request/status endpoints. Assert real navigation → unavailable statements → Refresh now → Refresh queued → page reload → Refresh queued from real status read. Observe network to ensure no browser collector/function dispatch. A real worker is not needed to prove durable queue intent; publication/consumer contracts are owned below the browser layer. Verify `scripts/e2e-local.sh AC-012-statement-refresh-queue` and `bash scripts/check-e2e-isolation.sh`.

### 30. Schema inventory, rollback integration and scope audit — 4 min (AC-005, AC-013)

Extend `scripts/financial-statements-schema.test.mjs` to assert both migration/down files, schedule RLS/grant contract, private/public/service function signatures and new status view inventory. Update `scripts/isolation-probe-denominator.json` with the schedule table, safe view, outer request RPC, list/admit RPCs and private helpers according to its existing entry schema; no policy exemption without a test reference. Ensure generated types include no undocumented API inputs. Run `node --test scripts/financial-statements-schema.test.mjs`, `scripts/with-db-lock.sh supabase test db supabase/tests/0331_statement_refresh_schedule.test.sql supabase/tests/0331_statement_refresh_request.test.sql supabase/tests/0332_statement_refresh_publication.test.sql`, `scripts/with-db-lock.sh node --test --test-name-pattern='AC-013 #1216' scripts/financial-statements-rollback.test.mjs` and `git diff --check`.

### 31. Targeted final builder gates — 5 min (AC-001–013; verification only)

From root run:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
(cd pmo-portal && npx eslint --max-warnings=0 pages/FinancialStatements.tsx pages/__tests__/FinancialStatements.refresh.test.tsx src/auth/policy.ts src/auth/policy.test.ts src/hooks/useFinancialStatements.ts src/hooks/useStatementRefresh.ts src/hooks/useStatementRefresh.test.tsx src/lib/statementRefresh.ts src/lib/db/financialStatements.ts src/lib/db/financialStatements.test.ts src/lib/repositories/financialStatements.ts src/lib/repositories/financialStatements.test.ts src/lib/repositories/types.ts)
(cd supabase/functions/erpnext-sweep && deno test --allow-all)
node scripts/check-edge-fn-test-binding.mjs
scripts/with-db-lock.sh supabase test db supabase/tests/0331_statement_refresh_schedule.test.sql supabase/tests/0331_statement_refresh_request.test.sql supabase/tests/0332_statement_refresh_publication.test.sql
scripts/with-db-lock.sh node --test --test-name-pattern='AC-013 #1216' scripts/financial-statements-rollback.test.mjs
scripts/e2e-local.sh AC-012-statement-refresh-queue
```

If migration/schema changed since last reset, replace the DB test command with `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0331_statement_refresh_schedule.test.sql supabase/tests/0331_statement_refresh_request.test.sql supabase/tests/0332_statement_refresh_publication.test.sql && node --test --test-name-pattern="AC-013 #1216" scripts/financial-statements-rollback.test.mjs'`. Record actual failing/passing bodies, not only pipeline exit status. A red gate is unfinished work. CI owns full four unit shards, verify, pgTAP and changed-code >=80% coverage; don't run a second full local suite. Code PR closes the statement piece, so Director dispatches its browser integration via `scripts/ci-e2e.sh "$(git branch --show-current)"` from the actual code worktree, applying shared concurrency limits; this planning branch is not a code-release branch.

### 32. Review/Discover/acceptance record — 3 min (AC-001–013; evidence only)

Prepare a per-AC pass matrix with canonical filenames/test titles and commands for the Director. Require spec-reviewer, code-quality-reviewer and security-auditor on code, mutation evidence for role/tenant guards, and index/query-plan review. Run rendered Discover on rich synthetic seed at phone/desktop, en/id, light/dark; graduate every finding to a deterministic test and `docs/qa-portfolio.md` route/oracle cell. Add a compact approved note to `docs/decisions.md` only **after** owner signs the new cadence/defaults; do not prelabel D1–D7 as owner rulings. Route cells: `/financial-statements × Finance queue/reload/role-state/a11y/provenance`; no layout or permission change on project totals. No new source behaviour is permitted in this evidence task; route any fix back through its failing-test task. Obtain Director acceptance, preserve dev-only ceiling and never deploy production from this plan.

## Traceability (one canonical owner per AC)

| AC | Canonical owning test/title prefix | Tasks |
|---|---|---|
| AC-001 | pgTAP `0331_statement_refresh_schedule.test.sql` — `AC-001 #1216` | 3,5,9,10,12 |
| AC-002 | pgTAP `0332_statement_refresh_publication.test.sql` — `AC-002 #1216` | 5,10–13 |
| AC-003 | Deno unit `statementDailyCadence.test.ts` — `AC-003 #1216` | 2,4,16,18,19 |
| AC-004 | Deno unit `statementDailyCadence.test.ts` — `AC-004 #1216` | 9,16–19 |
| AC-005 | pgTAP `0331_statement_refresh_request.test.sql` — `AC-005 #1216` | 1,2,6,30 |
| AC-006 | pgTAP `0331_statement_refresh_request.test.sql` — `AC-006 #1216` | 7,15 |
| AC-007 | pgTAP `0332_statement_refresh_publication.test.sql` — `AC-007 #1216` | 10–13,15 |
| AC-008 | pgTAP `0331_statement_refresh_request.test.sql` — `AC-008 #1216` | 8 |
| AC-009 | Vitest `src/auth/policy.test.ts` — `AC-009 #1216` | 22 |
| AC-010 | RTL `src/hooks/useStatementRefresh.test.tsx` — `AC-010 #1216` | 20,21,23–25 |
| AC-011 | RTL `pages/__tests__/FinancialStatements.refresh.test.tsx` — `AC-011 #1216` | 26–28 |
| AC-012 | Playwright `e2e/serial/AC-012-statement-refresh-queue.spec.ts` — `AC-012 #1216` | 29 |
| AC-013 | pgTAP SQL bundled/executed by `scripts/financial-statements-rollback.test.mjs` — `AC-013 #1216` | 1,14,30 |

Tasks 31/32 verify the whole matrix. Full pgTAP paths are under `supabase/tests/`; unit app paths under `pmo-portal/`; Deno paths under `supabase/functions/erpnext-sweep/`. Supplementary tests must say “support” rather than claiming a second owning layer.

## OPEN QUESTIONS for the owner (recommended defaults in spec)

1. **OQ-1:** Midnight admission versus completion — recommend first available five-minute tick, no invented completion SLA.
2. **OQ-2:** Does manual success cover the scheduled day? — recommend yes for admission day; midnight-spanning runs do not consume the next day.
3. **OQ-3:** Request during automatic work / rate limit — recommend one durable follow-up, one outstanding manual receipt per org and five-minute acceptance cooldown.
4. **OQ-4:** Continuation cadence — recommend statement-only five-minute continuation for six hours, then hourly recovery; all other reconciliation remains hourly.
5. **OQ-5:** Dirty-history timing / manual scope — recommend next admitted daily/manual batch, existing incremental scope, no independent dirty-triggered run or forced history reread.
6. **OQ-6:** Timezone changes / rollout — recommend one new-zone catch-up; lazily credit an exact-current native publication already completed today.
