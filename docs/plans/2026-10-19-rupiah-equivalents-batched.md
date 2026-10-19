# #1012 — Batched, display-only rupiah equivalents

Date: 2026-10-19 · Status: proposed build plan; docs-only planning delivery.
Spec: `docs/specs/rupiah-equivalents-batched.spec.md` (baseline `cbacb2a0`).
Architecture: `docs/adr/0085-jisdor-display-only-equivalents.md`, proposed batching addendum.

## Design decisions, in dependency order

1. **Reuse, do not rebuild.** The evidence ledger E1–E14 in the spec gives file:line citations for the inspected behavior. Existing `fx_rates`, upload/audit, Administration route, repository and `FxEquivalent` stay. The current hook makes one call per distinct date (`pmo-portal/src/hooks/useFxRates.ts:22-32`), so a Finance register with 20 different invoice dates can generate 20 rate round trips; batching is a transport/scalability improvement, not a new financial model.
2. **Keep the highest-value surface set.** Contract header/Overview and invoice register/detail already call the shared component (`pmo-portal/pages/project-detail/ProjectDetailHeader.tsx:216-229`, `pmo-portal/pages/project-detail/tabs/OverviewTab.tsx:104-115`, `pmo-portal/pages/SalesInvoices.tsx:760-795`; detail preview at `pmo-portal/pages/approvals/SalesInvoiceApprovalRow.tsx:70-101`). Do not add a Projects-list, pipeline, payment, vendor or aggregate conversion. The spec separately inventories those follow-ups and the owner scope question.
3. **One authoritative selector.** Add `fx_rates_on(base text, quote text, on_dates date[])`, a STABLE invoker wrapper around `fx_rate_on`, not a second predecessor algorithm. A lateral LEFT JOIN preserves an explicit null match for each requested cutoff. No organization argument; existing table/RLS/current-user semantics remain. This is a batch extension of ADR-0085's selector exception to REST-first reads, not a new backend service.
4. **Batch below presentation, cache above transport.** `useFxRate` retains its signature and per-org/pair/day React Query keys. A per-QueryClient/per-org coalescer collects query functions until a zero-delay timer flushes, groups pair+distinct days and calls `repositories.fxRates.onDates`. It holds only pending subscribers, never another rate cache. All existing page compositions benefit without threading data or organization IDs through cells. Retain scalar `onDate` for compatibility, but the shared hook no longer calls it.
5. **Bound work.** 64 input dates per RPC, one in-flight batch per coalescer, sequential 64/1 chunks for 65 dates. Repeated dates share the same lookup result. SQL rejects null input, null elements, >64 elements and non-finite date sentinels; client deduplicates before dispatch. Empty input returns no rows. No download of whole history. The existing `(org_id, source, base_currency, quote_currency, rate_date)` unique key and `(org_id, rate_date desc)` index are declared at `supabase/migrations/0291_fx_rates_jisdor.sql:14-17`; measure the actual plan, do not infer runtime efficiency from names alone.
6. **Absence is data; failure is not.** Response validation requires precisely one requested-date result, with rate and publication date either both present or both null. A malformed/partial response throws, never becomes a null rate. Batch failure rejects every live subscriber in that chunk; unrelated chunks can continue. Aborted subscribers reject locally and do not consume results or abort siblings' shared transport. Consuming React Query's signal preserves cancellation during query removal/identity-cache clearing (`pmo-portal/src/auth/AuthProvider.tsx:68-73`).
7. **No new accounting/UI semantics.** Actual/Committed/Margin remain governed by DD-MONEY-1..4 (`docs/decisions.md:2940-2964`); date semantics come from DD-FX-1 (`:2308-2314`), not DD-MONEY. Preserve `≈`, visible publication date, original amount, tax basis, numeric locale and all distinct unavailable states. Apply DD-FMT-1's negative-before-symbol rule (`:1547-1557`) only in the FX formatter. Do not introduce a decimal-arithmetic package or rewrite shared money formatting.

### Data flow / files

```text
Existing page amount + FxEquivalent
  → useFxRate(base, quote, cutoff, enabled)
  → React Query (org/pair/day, 30s; amount and locale excluded)
  → per-QueryClient/org pending coalescer
  → fxRatesRepository.onDates(base, quote, distinctDays)
  → db/fxRates.fxRatesOn → POST RPC fx_rates_on
  → unnest bounded days → existing fx_rate_on per distinct cutoff → existing fx_rates
  → validated requested_date + nullable rate/rate_date
  → resolve each date query → existing formatter → existing caption
```

Latest-day prerequisites can settle in a later turn: a second batch then is legitimate. One batch is promised for concurrently queued eligible cutoffs, **not** one HTTP call for the route's lifetime. Org-context and document queries are outside the rate-request count.

New source files: `pmo-portal/src/lib/fxRateBatcher.ts` and its test; `pmo-portal/src/components/fx/FxEquivalent.batch.test.tsx`. Other source changes stay in existing FX DAL/repository/types/hook/formatter files. No page/layout rewrite or new public component props. Additive DB function only: migration `supabase/migrations/0331_fx_rates_on.sql`, reversal `supabase/migrations/rollback/0331_fx_rates_on_down.sql`.

### UI / failure contract

Operate mode, incumbent DESIGN.md grammar. Original money remains primary; the shared muted Inter-tabular caption retains `≈ Rp … (JISDOR ISO-date)`, compact visual truncation plus full accessible text (`pmo-portal/src/components/fx/FxEquivalent.tsx:144-160`). Status and retry copy remains visible, not color/tooltip-only (`:41-153`). Preserve both number locales independently of language. No caption says “booked”; no equivalent enters exports, tax or totals. Missing uploaded publication is not a known BI holiday. An older selected publication always shows its actual date; no arbitrary expiry is introduced. Follow-up surfaces and freshness policy are owner questions, not implementation freedom.

### Migration, RLS, rollout and rollback

- Do not edit migration 0291, rate rows, its RLS, grants, audit triggers or upload RPC. Add only the invoker batch function, authenticated execute grant and generated type entry. No new business table/backfill/seed/index is proposed. The `org_id` seam remains server-owned through the existing selector and table.
- Verify own-org/inactive/anonymous behavior through the new function under actual local grants; existing 0291 RLS/write suites remain regression gates. Do not claim local results prove a deployed environment.
- Expand first: deploy/add function before new client code; old scalar function remains compatible. Roll back client first, then drop only `fx_rates_on(text,text,date[])`. Rates/documents/audit history remain untouched. No destructive rollback of migration 0291.
- 0331 is a candidate at this baseline. Before editing SQL, rebase and inspect migration numbers. On collision use `scripts/renumber-migration.sh` with the actual replacement number and update plan/spec references. Do not hand-edit old applied migration numbers.
- No schema operation is performed in this planning task. Eventual code release is dev-only and separately authorized; never push from this worktree as part of this brief.

## Task conventions

**16 tasks**, each 2–5 minutes of focused work; verification may take longer waiting on shared locks. Build is a separate authorized activity, not performed by this planner. Director chooses the executor under `docs/factory-workflow.md:137-145`; this plan is read-only FX display plus a bounded invoker read, not permission to touch money transitions.

All commands below start at repository root unless a `cd` is present. Vitest/typecheck use the test lock; DB work uses the DB lock. Keep RED output, implement only the specified change, then run the identical command GREEN. Where tests already pass for retained behavior, keep them as regression evidence: do not manufacture RED or mutate a test oracle. New behavior tasks below identify the failing assertion before their implementation. Never delete/skip a test to get green.

### Task 1 (5 min) — RED: batch selection contract [AC-1012-001]

Create `supabase/tests/0331_fx_rates_on.test.sql`. Use this complete transactional fixture and contract:

```sql
begin;
create extension if not exists pgtap;
select no_plan();
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
        ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
begin
  insert into public.organizations(id,name,default_currency,default_timezone)
    values(a,'Synthetic batch A','IDR','Asia/Jakarta'),
          (b,'Synthetic batch B','IDR','UTC');
  insert into auth.users(id,email)
    values(ua,ua::text||'@example.invalid'),(ub,ub::text||'@example.invalid');
  insert into public.profiles(id,org_id,full_name,email,role,status)
    values(ua,a,'Synthetic batch A',ua::text||'@example.invalid','Finance','active'),
          (ub,b,'Synthetic batch B',ub::text||'@example.invalid','Admin','active');
  perform set_config('test.fx_actor_a',ua::text,true);
  perform set_config('test.fx_actor_b',ub::text,true);
  insert into public.fx_rates(org_id,rate_date,rate)
    values(a,'2026-10-09',16234.56),(a,'2026-10-12',16300),
          (b,'2026-10-09',18000);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('test.fx_actor_a'),'role','authenticated')::text,true);
select results_eq(
  $$select requested_date,rate,rate_date from public.fx_rates_on('USD','IDR',
      array['2026-10-12','2026-10-10','2026-10-09','1999-12-31','2026-10-10']::date[])
      order by requested_date$$,
  $$values(date '1999-12-31',null::numeric,null::date),
          (date '2026-10-09',16234.56::numeric,date '2026-10-09'),
          (date '2026-10-10',16234.56::numeric,date '2026-10-09'),
          (date '2026-10-12',16300::numeric,date '2026-10-12')$$,
  'AC-1012-001: distinct cutoff results retain the selected publication');
select is((select count(*)::integer from public.fx_rates_on('IDR','USD',
  array['2026-10-10']::date[]) where rate is not null),0,
  'AC-1012-001: inverse is not inferred');
select is((select count(*)::integer from public.fx_rates_on('EUR','IDR',
  array['2026-10-10']::date[]) where rate is not null),0,
  'AC-1012-001: unsupported pair is not inferred');
select results_eq(
  $$select b.rate,b.rate_date from public.fx_rates_on('USD','IDR',
      array['2026-10-10']::date[]) b$$,
  $$select rate,rate_date from public.fx_rate_on('USD','IDR','2026-10-10')$$,
  'AC-1012-001: scalar and batch agree');
reset role;
select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh supabase test db supabase/tests/0331_fx_rates_on.test.sql` — missing `fx_rates_on`, not a fixture/setup failure.

### Task 2 (5 min) — RED: batch read scope and bounds [AC-1012-002]

Create `supabase/tests/0331_fx_rates_on_access.test.sql` with this transactional setup and the assertions below:

```sql
begin;
create extension if not exists pgtap;
select no_plan();
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
        ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
begin
  insert into public.organizations(id,name,default_currency,default_timezone)
    values(a,'Synthetic batch A','IDR','Asia/Jakarta'),
          (b,'Synthetic batch B','IDR','UTC');
  insert into auth.users(id,email)
    values(ua,ua::text||'@example.invalid'),(ub,ub::text||'@example.invalid');
  insert into public.profiles(id,org_id,full_name,email,role,status)
    values(ua,a,'Synthetic batch A',ua::text||'@example.invalid','Finance','active'),
          (ub,b,'Synthetic batch B',ub::text||'@example.invalid','Admin','active');
  perform set_config('test.fx_actor_a',ua::text,true);
  perform set_config('test.fx_actor_b',ub::text,true);
  insert into public.fx_rates(org_id,rate_date,rate)
    values(a,'2026-10-09',16234.56),(a,'2026-10-12',16300),
          (b,'2026-10-09',18000);
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('test.fx_actor_a'),'role','authenticated')::text,true);
```

```sql
select ok((select provolatile='s' and not prosecdef from pg_proc
  where oid='public.fx_rates_on(text,text,date[])'::regprocedure),
  'AC-1012-002: STABLE invoker');
select is((select rate from public.fx_rates_on('USD','IDR',array['2026-10-10']::date[])),
  16234.56::numeric,'AC-1012-002: caller A own rate');
select set_config('request.jwt.claims',jsonb_build_object(
  'sub',current_setting('test.fx_actor_b'),'role','authenticated')::text,true);
select is((select rate from public.fx_rates_on('USD','IDR',array['2026-10-10']::date[])),
  18000::numeric,'AC-1012-002: caller B own rate, never A');
select is((select count(*)::integer from public.fx_rates_on('USD','IDR','{}'::date[])),
  0,'AC-1012-002: empty input');
select throws_ok($$select * from public.fx_rates_on('USD','IDR',null)$$,
  '22023','Provide at most 64 finite cutoff dates','AC-1012-002: null array');
select throws_ok($$select * from public.fx_rates_on('USD','IDR',array[null]::date[])$$,
  '22023','Provide at most 64 finite cutoff dates','AC-1012-002: null element');
select throws_ok($$select * from public.fx_rates_on('USD','IDR',
  array_fill(date '2026-10-10',array[65]))$$,
  '22023','Provide at most 64 finite cutoff dates','AC-1012-002: oversize');
select throws_ok($$select * from public.fx_rates_on('USD','IDR',array['infinity']::date[])$$,
  '22023','Provide at most 64 finite cutoff dates','AC-1012-002: finite dates only');
select is((select count(*)::integer from public.fx_rates_on('USD','IDR',
  array_fill(date '2026-10-10',array[64]))),1,'AC-1012-002: 64 allowed then deduplicated');
reset role;
update public.profiles set role='Engineer' where id=current_setting('test.fx_actor_b')::uuid;
set local role authenticated;
select is((select rate from public.fx_rates_on('USD','IDR',array['2026-10-10']::date[])),
  18000::numeric,'AC-1012-002: non-manager active member reads');
reset role;
update public.profiles set status='disabled' where id=current_setting('test.fx_actor_b')::uuid;
set local role authenticated;
select is((select count(*)::integer from public.fx_rates_on('USD','IDR',
  array['2026-10-10']::date[]) where rate is not null),0,'AC-1012-002: inactive has no match');
reset role;
select ok(not has_function_privilege('anon','public.fx_rates_on(text,text,date[])','EXECUTE'),
  'AC-1012-002: no anonymous execute');
set local role anon;
select throws_ok($$select * from public.fx_rates_on('USD','IDR',array['2026-10-10']::date[])$$,
  '42501',null,'AC-1012-002: anonymous call refused');
reset role;
select * from finish();
rollback;
```

Verify RED before adding the function: `scripts/with-db-lock.sh supabase test db supabase/tests/0331_fx_rates_on_access.test.sql` — the missing function is the expected failure; fixture/setup errors are not acceptable RED evidence.

### Task 3 (4 min) — GREEN: bounded wrapper and reversal [AC-1012-001/002]

Create `supabase/migrations/0331_fx_rates_on.sql`:

```sql
create function public.fx_rates_on(base text, quote text, on_dates date[])
returns table(requested_date date, rate numeric, rate_date date)
language plpgsql stable security invoker set search_path = public as $$
begin
  if on_dates is null or cardinality(on_dates) > 64
     or exists(select 1 from unnest(on_dates) d where d is null or not isfinite(d)) then
    raise exception 'Provide at most 64 finite cutoff dates' using errcode = '22023';
  end if;
  return query
    select d.day, m.rate, m.rate_date
    from (select distinct unnest(on_dates) as day) d
    left join lateral public.fx_rate_on(base,quote,d.day) m on true
    order by d.day;
end $$;
revoke all on function public.fx_rates_on(text,text,date[]) from public,anon,authenticated;
grant execute on function public.fx_rates_on(text,text,date[]) to authenticated;
```

Create `supabase/migrations/rollback/0331_fx_rates_on_down.sql` containing only:

```sql
drop function if exists public.fx_rates_on(text,text,date[]);
```

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0331_fx_rates_on.test.sql supabase/tests/0331_fx_rates_on_access.test.sql supabase/tests/0291_fx_rates_rls.test.sql supabase/tests/0291_fx_rates_write.test.sql supabase/tests/0291_fx_rate_on.test.sql'`.

Mutation-check locally inside a DB-lock-held transaction: replace the wrapper with the above body but `SECURITY DEFINER`, run Task 2's assertions and require RED; roll back to restore before proceeding. Never commit a mutation. Task 15 supplies the rollback contract proof.

### Task 4 (5 min) — RED: batch decoding contracts [AC-1012-003]

In `pmo-portal/src/lib/db/__tests__/fxRates.test.ts`, import `fxRatesOn` and add an AC-leading case that sets the existing harness response to:

```ts
[
  { requested_date: '2026-10-09', rate: 16234.56, rate_date: '2026-10-09' },
  { requested_date: '1999-12-31', rate: null, rate_date: null },
]
```

Assert `fxRatesOn('USD','IDR',['2026-10-09','1999-12-31','2026-10-09'])` returns those rows, makes exactly one `fx_rates_on` RPC with sorted unique `on_dates`, and empty input makes no RPC. RED command: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/db/__tests__/fxRates.test.ts`.

Before implementation, also add AC-1012-003 `it.each` rejection cases in the same test file: missing requested row; duplicate requested row; unrequested cutoff; `rate:null,rate_date:'2026-10-09'`; positive rate with null date; rate 0; publication after cutoff; `data:null`; and RPC error `{code:'42501',message:'denied'}`. Assert rejection, never a null result. Assert >64 unique dates rejects before network. Run the same RED command; missing implementation is expected, not an unrelated harness failure.

### Task 5 (4 min) — GREEN: typed, validated batch DAL [AC-1012-003]

In `pmo-portal/src/lib/repositories/types.ts`, add:

```ts
export type FxRateBatchRow = {
  requested_date: string;
  rate: number | null;
  rate_date: string | null;
};
```

In `pmo-portal/src/lib/supabase/database.types.ts`, add the generated `fx_rates_on` function entry adjacent to `fx_rate_on`, with `Args: { base: string; quote: string; on_dates: string[] }` and rows containing `requested_date`, `rate`, `rate_date`. Generate with `scripts/with-db-lock.sh supabase gen types typescript --local > /tmp/pmo-1012-database.types.ts`; transfer only this function's generated hunk, not unrelated type churn. PostgreSQL table-return nullability is validated at runtime; `FxRateBatchRow` intentionally models nullable matches even if generated numeric/date fields are non-nullable.

In `pmo-portal/src/lib/db/fxRates.ts`, import `FxRateBatchRow` and implement:

```ts
const batchRowSchema = z.object({
  requested_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.number().finite().min(1000).max(100000).nullable(),
  rate_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).strict().refine(row => (row.rate === null) === (row.rate_date === null));

export async function fxRatesOn(
  base: string, quote: string, onDates: string[],
): Promise<FxRateBatchRow[]> {
  const dates = [...new Set(onDates)].sort();
  if (!dates.length) return [];
  if (dates.length > 64) throw new RangeError('At most 64 cutoff dates per batch');
  const { data, error } = await supabase.rpc('fx_rates_on', { base, quote, on_dates: dates });
  if (error) throw error;
  const rows = z.array(batchRowSchema).parse(data);
  const returned = new Set(rows.map(row => row.requested_date));
  if (rows.length !== dates.length || returned.size !== dates.length ||
      dates.some(day => !returned.has(day)) ||
      rows.some(row => row.rate_date !== null && row.rate_date > row.requested_date)) {
    throw new Error('Incomplete or invalid exchange-rate batch');
  }
  return rows;
}
```

GREEN: rerun the RED command, then `cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck`.

### Task 6 (3 min) — RED/GREEN: repository batch seam [AC-1012-003]

Add `onDates(base: string, quote: string, onDates: string[]): Promise<FxRateBatchRow[]>` to `FxRatesRepository` in `pmo-portal/src/lib/repositories/types.ts`. In `pmo-portal/src/lib/repositories/fxRates.test.ts`, add `fxRatesOn: vi.fn()` to the DAL mock. Write a failing test asserting exact argument delegation, matched/null response preservation and preservation of a rejected database error code through `fxRatesRepository.onDates`.

Import `fxRatesOn` in `pmo-portal/src/lib/repositories/fxRates.ts` and add this property beside `onDate`:

```ts
onDates: (base, quote, dates) => normalized(() => fxRatesOn(base, quote, dates)),
```

Keep `onDate`, `existing`, `list`, `upsert`, `context` unchanged. RED then GREEN command: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/repositories/fxRates.test.ts`.

### Task 7 (4 min) — RED: deterministic coalescer tests [AC-1012-004]

Create `pmo-portal/src/lib/fxRateBatcher.test.ts` with Vitest fake timers, cleanup via `vi.useRealTimers`, and import the not-yet-created `createFxRateBatcher`. The loader returns reversed rows to prevent index-based mapping:

```ts
const load = vi.fn(async (_base: string, _quote: string, days: string[]) =>
  [...days].reverse().map(requested_date => ({
    requested_date, rate: 16234.56, rate_date: '2026-10-09',
  })));
const batcher = createFxRateBatcher(load);
const dates = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 10).padStart(2, '0')}`);
const promises = dates.map(day => batcher.onDate('USD', 'IDR', day));
promises.push(batcher.onDate('USD', 'IDR', dates[0]));
expect(load).not.toHaveBeenCalled();
await vi.runAllTimersAsync();
expect(load).toHaveBeenCalledOnce();
expect(load.mock.calls[0][2]).toEqual(dates);
expect(await Promise.all(promises)).toEqual(
  promises.map(() => ({ rate: 16234.56, rate_date: '2026-10-09' })));
```

For the 65-date case import `parseISO`, `addDays`, `formatISO` from date-fns and construct `const sixtyFive = Array.from({ length: 65 }, (_, i) => formatISO(addDays(parseISO('2026-01-01'), i), { representation: 'date' }));`. Assert request lengths `[64,1]` and defer the first loader promise to assert the second does not start before it settles. Include different base/quote pairs and a null/null row. Use AC-1012-004 in each title. Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/fxRateBatcher.test.ts`.

### Task 8 (4 min) — RED: failure/cancellation lifecycle [AC-1012-004]

Extend `pmo-portal/src/lib/fxRateBatcher.test.ts` before implementing the coalescer: abort before flush rejects with `AbortError` and causes zero loader calls; abort one of two subscribers to the same day leaves the other fulfilled; abort during a deferred load prevents the aborted result from settling successfully; loader rejection rejects all live chunk subscribers; a new request after rejection uses a fresh loader call and can succeed; requests arriving during a deferred first load queue for the next flush; missing result keys reject. Attach `.catch`/`Promise.allSettled` observers **before** aborting/rejecting to avoid unhandled-rejection false positives. Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/fxRateBatcher.test.ts` — the module is still missing.

### Task 9 (5 min) — GREEN: implement bounded coalescer [AC-1012-004]

Create `pmo-portal/src/lib/fxRateBatcher.ts` with this complete implementation sketch (no global result cache):

```ts
import type { FxRateBatchRow, FxRateMatch } from './repositories/types';
type Load = (base: string, quote: string, days: string[]) => Promise<FxRateBatchRow[]>;
type Pending = {
  base: string; quote: string; day: string; signal?: AbortSignal;
  resolve: (match: FxRateMatch | null) => void;
  reject: (error: unknown) => void;
};
export function createFxRateBatcher(load: Load) {
  let queue: Pending[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const schedule = () => {
    if (timer !== undefined || running || !queue.length) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, 0);
  };
  async function flush() {
    running = true;
    const pending = queue;
    queue = [];
    try {
      const groups = new Map<string, Pending[]>();
      for (const item of pending) {
        if (item.signal?.aborted) continue;
        const key = JSON.stringify([item.base,item.quote]);
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key,group);
      }
      for (const group of groups.values()) {
        const days = [...new Set(group.map(item => item.day))].sort();
        for (let offset = 0; offset < days.length; offset += 64) {
          const chunkDays = days.slice(offset,offset + 64);
          const subscribers = group.filter(item =>
            !item.signal?.aborted && chunkDays.includes(item.day));
          const requested = [...new Set(subscribers.map(item => item.day))].sort();
          if (!requested.length) continue;
          try {
            const first = subscribers[0];
            const rows = await load(first.base,first.quote,requested);
            const byDate = new Map(rows.map(row => [row.requested_date,row]));
            if (byDate.size !== requested.length || rows.length !== requested.length ||
                requested.some(day => !byDate.has(day))) {
              throw new Error('Incomplete exchange-rate batch');
            }
            for (const item of subscribers) {
              if (item.signal?.aborted) continue;
              const row = byDate.get(item.day)!;
              item.resolve(row.rate === null || row.rate_date === null ? null :
                { rate: row.rate, rate_date: row.rate_date });
            }
          } catch (error) {
            for (const item of subscribers) item.reject(error);
          }
        }
      }
    } finally {
      running = false;
      schedule();
    }
  }
  return {
    onDate(base: string, quote: string, day: string, signal?: AbortSignal): Promise<FxRateMatch | null> {
      return new Promise((resolve,reject) => {
        let settled = false;
        const finish = (error: unknown, match: FxRateMatch | null, failed: boolean) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort',abort);
          if (failed) reject(error); else resolve(match);
        };
        const abort = () => finish(new DOMException('Aborted','AbortError'),null,true);
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort',abort,{ once: true });
        queue.push({ base,quote,day,signal,
          resolve: match => finish(null,match,false),
          reject: error => finish(error,null,true),
        });
        schedule();
      });
    },
  };
}
```

DAL validation is still required before this typed loader: the coalescer must not be treated as the untrusted-response boundary. Verify GREEN using Task 7's exact command.

### Task 10 (5 min) — RED: composed captions bind to batch transport [AC-1012-007]

Create `pmo-portal/src/components/fx/FxEquivalent.batch.test.tsx`. Use a real QueryClient/provider and real `useFxRate`/`FxEquivalent`; mock only auth, organization currency/day and `repositories.fxRates` (`onDates`, scalar `onDate`, `upsert`). Use `I18nextProvider` with the actual en/id `common.json` catalogues, and explicit number-locale setup/reset. Do **not** mock the shared rate hook or copy its implementation. The scalar mock returns null; require `onDates` to be called and `onDate` never called, so the existing hook produces meaningful RED.

Render these actual siblings together:

```tsx
<div>
  <span data-testid="original">USD 100.00</span>
  <FxEquivalent amount={100} currency="USD" date="2026-10-10" />
  <FxEquivalent amount={25} currency="USD" date="latest" />
  <FxEquivalent amount={0} currency="USD" date="2026-10-10" compact />
  <FxEquivalent amount={100} currency="USD" date={null} />
  <FxEquivalent amount={null} currency="USD" date="2026-10-10" />
</div>
```

Loader returns Friday for Saturday and Monday for mocked organization day Monday. Use a deferred promise to assert pending before resolution, then assert distinct publication dates, `≈ Rp 0` only for the genuine zero, unchanged `original`, the missing-date reason, compact `.sr-only` full caption and translated copy. Separate cases return paired nulls (no-rate reason), reject (alert+Retry, no zero/old caption), then resolve on Retry. Include a failing background refetch after a successful result; the error must replace, not silently retain, the old caption.

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/components/fx/FxEquivalent.batch.test.tsx` — expected failure is the batch-binding assertion, not a broken fixture/provider.

### Task 11 (5 min) — RED/GREEN: hook uses the shared coalescer [AC-1012-005/007]

In `pmo-portal/src/hooks/useFxRates.test.tsx`, add `onDates` to the repository harness and mock. Mount one component that calls `useFxRate` for 20 distinct days, not 20 separate sequential `renderHook` calls. Have `onDates` map requested dates to matched rows; assert one call, exact unique dates and `onDate` **zero calls**. Include one latest-day cell after its mocked organization-day resolution. Existing same-date/org tests must retain their data/cache assertions; replace only their scalar-call expectations with the new batch contract (the transport expectation intentionally changes).

In `pmo-portal/src/hooks/useFxRates.ts`, add `QueryClient` as a type import and import `createFxRateBatcher`. Add a private scope map and helper:

```ts
const batchers = new WeakMap<QueryClient, Map<string, ReturnType<typeof createFxRateBatcher>>>();
function batcherFor(client: QueryClient, org: string) {
  let scopes = batchers.get(client);
  if (!scopes) { scopes = new Map(); batchers.set(client,scopes); }
  let batcher = scopes.get(org);
  if (!batcher) {
    batcher = createFxRateBatcher((base,quote,days) =>
      repositories.fxRates.onDates(base,quote,days));
    scopes.set(org,batcher);
  }
  return batcher;
}
```

Inside `useFxRate`, get `const client = useQueryClient();`. Replace only its `queryFn`:

```ts
queryFn: ({ signal }) => batcherFor(client,org as string)
  .onDate(base,quote,day as string,signal),
```

Keep the existing `enabled`, `queryKey`, `staleTime` and return signature. No org is sent to the repository/RPC. Private maps hold empty coalescers after completion, not results; the weak QueryClient key permits garbage collection. Verify RED/GREEN: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/hooks/useFxRates.test.tsx src/components/fx/FxEquivalent.batch.test.tsx src/components/fx/FxEquivalent.test.tsx pages/project-detail/__tests__/ProjectFxEquivalent.test.tsx pages/__tests__/SalesInvoices.fx.test.tsx`. This also turns Task 10's composed batch-binding tests GREEN.

### Task 12 (5 min) — Retained-contract regression: cache, invalidation and retry [AC-1012-005]

In `pmo-portal/src/hooks/useFxRates.test.tsx`, add AC-leading cases using real QueryClient instances: separate clients/same org must not share a batch; different orgs on the same client keep separate keys; same org/pair/day duplicates coalesce; input amount/number-locale changes do not change rate identity; failed `onDates` sets error, `refetch()` succeeds; successful existing `upsert` invalidation refreshes an active date's changed rate; failed upsert does not invalidate; unmount before flush consumes `signal` and sends no pending rate batch. Inspect query options to assert `staleTime === 30_000`. Existing invalidation code stays unless a real RED demonstrates a regression. Verify: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/hooks/useFxRates.test.tsx src/hooks/useFxOrgDay.test.tsx`.

### Task 13 (5 min) — RED/GREEN: native currency sign and rounding [AC-1012-006]

Add an AC-1012-006 `it.each` to `pmo-portal/src/lib/fxEquivalent.test.ts`, pinning `setActiveLocale` to en-US/id-ID and resetting afterward. Assert rates `1000.5`, amounts `1/-1` yield `≈ Rp 1,001 …`/`≈ -Rp 1,001 …` and `≈ Rp 1.001 …`/`≈ -Rp 1.001 …`; test `1.01 × 16234.56`, genuine zero, NaN, Infinity, negative/zero rates and unchanged original inputs. Negative-sign assertions are RED against the existing `≈ Rp -…` construction.

In `pmo-portal/src/lib/format.ts`, add this helper beside `formatNumberWhole`, reusing the existing locale-keyed `currencyFormatterFor` (DD-FMT-1 requires native currency formatting, not a manually moved minus sign):

```ts
export function formatRupiahWhole(value: number): string {
  return currencyFormatterFor('fxWhole', 'IDR', {
    currencyDisplay: 'code', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).formatToParts(value).map(part => {
    if (part.type === 'currency') return 'Rp';
    return part.type === 'literal' ? part.value.replace(/\s+/g, ' ') : part.value;
  }).join('');
}
```

In `pmo-portal/src/lib/fxEquivalent.ts`, replace its `formatNumberWhole` import with `formatRupiahWhole`; after the existing validation replace the return with:

```ts
return `≈ ${formatRupiahWhole(converted)} (JISDOR ${match.rate_date})`;
```

The currency formatter owns sign/rounding; only its currency token becomes the required `Rp` and whitespace becomes an ordinary space, preserving existing positive captions in both supported locales. Do not round the inputs or call `Math.round`. RED/GREEN command: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/fxEquivalent.test.ts src/lib/format.locale.test.ts`. The FX test directly exercises the new shared helper.

### Task 14 (3 min) — Reuse the one cross-stack journey [AC-1012-008]

In `pmo-portal/e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts`, append ` [AC-1012-008]` to the existing single `test` title. Keep its leading AC-FX-015, self-isolated tag, disposable fixture setup/cleanup, reload/re-import and exact original/equivalent amount oracles unchanged. Add no second `test()` and no skip/CI gate. A transport optimization should pass this already-proven user journey without weakening any assertion. Run `scripts/check-e2e-isolation.sh` and `scripts/e2e-local.sh --reset AC-FX-015-jisdor-upload-equivalents` (reset required because this branch adds a migration; the wrapper holds reset+browser under one DB lock). This regression run may exceed the task's editing time. It proves the real stack, not the request-count budget already owned by unit tests.

### Task 15 (4 min) — Plan/rollback and regression evidence [AC-1012-001/002; supports all]

In `supabase/tests/0331_fx_rates_on.test.sql`, insert this block after the fixture DO block and before `set local role authenticated` (test transaction only):

```sql
alter table public.fx_rates disable trigger user;
insert into public.fx_rates(org_id,rate_date,rate)
select (select org_id from public.profiles where id=current_setting('test.fx_actor_a')::uuid),
       date '2000-01-01' + day, 16000 + day % 500
from generate_series(0,8999) as days(day);
alter table public.fx_rates enable trigger user;
analyze public.fx_rates;
create function pg_temp.fx_explain(statement text) returns setof text language plpgsql as $$
declare plan_row record;
begin
  for plan_row in execute 'EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ' || statement loop
    return next plan_row."QUERY PLAN";
  end loop;
end $$;
grant execute on function pg_temp.fx_explain(text) to authenticated;
```

After the authenticated claims are set, add diagnostics (TAP comments, not timing assertions):

```sql
select diag(e.line) from pg_temp.fx_explain($q$
  select f.rate,f.rate_date from public.fx_rates f
  where f.org_id=public.auth_org_id() and f.source='JISDOR'
    and f.base_currency='USD' and f.quote_currency='IDR'
    and f.rate_date <= date '2026-10-10'
  order by f.rate_date desc limit 1
$q$) as e(line);
select diag(e.line) from pg_temp.fx_explain($q$
  select * from public.fx_rates_on('USD','IDR',
    array(select date '2026-01-01' + n from generate_series(0,63) as days(n)))
$q$) as e(line);
```

Keep the before-history cutoff `1999-12-31`. Inspect rows/buffers/loops and the wrapper's underlying scalar query; check predecessor probes are bounded, rather than transferring all history. Do not assert a specific planner node/time or claim opaque function-scan timing proves its internals. Record actual observations in builder evidence. Keep transaction rollback.

Create `supabase/tests/0331_fx_rates_on_rollback.test.sql` with:

```sql
begin;
create extension if not exists pgtap;
select no_plan();
\ir ../migrations/rollback/0331_fx_rates_on_down.sql
select ok(to_regprocedure('public.fx_rates_on(text,text,date[])') is null,
  'AC-1012-002 supporting: reversal removes only the new signature');
select ok(to_regprocedure('public.fx_rate_on(text,text,date)') is not null,
  'AC-1012-002 supporting: scalar remains');
select ok(to_regclass('public.fx_rates') is not null,
  'AC-1012-002 supporting: history table remains');
select * from finish();
rollback;
```

This is regression proof of the reversible additive contract; do not mutate stored rates or drop 0291.

Verify: `scripts/with-db-lock.sh supabase test db supabase/tests/0331_fx_rates_on.test.sql supabase/tests/0331_fx_rates_on_access.test.sql supabase/tests/0331_fx_rates_on_rollback.test.sql supabase/tests/0291_fx_rate_on.test.sql`.

### Task 16 (5 min editing; gates/review run separately) — Close the evidence matrix

Run from root, inspect the **output bodies**, and preserve each result in the eventual builder report:

```bash
(cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck)
(cd pmo-portal && npx eslint --max-warnings=0 src/lib/db/fxRates.ts src/lib/db/__tests__/fxRates.test.ts src/lib/repositories/types.ts src/lib/repositories/fxRates.ts src/lib/repositories/fxRates.test.ts src/lib/fxRateBatcher.ts src/lib/fxRateBatcher.test.ts src/hooks/useFxRates.ts src/hooks/useFxRates.test.tsx src/lib/fxEquivalent.ts src/lib/fxEquivalent.test.ts src/lib/format.ts src/components/fx/FxEquivalent.batch.test.tsx e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts)
(cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev)
scripts/with-db-lock.sh supabase test db supabase/tests/0331_fx_rates_on.test.sql supabase/tests/0331_fx_rates_on_access.test.sql supabase/tests/0331_fx_rates_on_rollback.test.sql supabase/tests/0291_fx_rates_rls.test.sql supabase/tests/0291_fx_rates_write.test.sql supabase/tests/0291_fx_rate_on.test.sql
```

The touched browser journey's Task 14 evidence is reusable; do not chain redundant full local suites. Require ≥80% changed-line coverage from CI, the normal four unit shards, verify and pgTAP, plus a closing browser integration dispatch through `scripts/ci-e2e.sh` on the eventual code branch per current caps. The Director supplies that branch name at release; this is not authorization to push or dispatch from the planning branch.

Spec/quality/security reviewers run on the code change. Quality review inspects batching lifetime, chunk bounds, cancellation and actual query-plan evidence. Rendered Discover uses rich synthetic data for the five existing routes in the traceability section, both locales/themes at 390/1280px; graduate findings to tests and `docs/qa-portfolio.md` before acceptance. Do not claim `docs/qa-portfolio.md:133-140`'s outstanding cells are already green. The final code task is not done while tests/reviews/required rendered cells are incomplete.

## Traceability — exactly one canonical owner per new AC

| AC | Requirements | Task(s) | Owning layer | Canonical artifact |
|---|---|---|---|---|
| AC-1012-001 | FR-001/002; NFR-002 | 1,3,15 | pgTAP | `supabase/tests/0331_fx_rates_on.test.sql` |
| AC-1012-002 | NFR-002/005 | 2,3,15 | pgTAP | `supabase/tests/0331_fx_rates_on_access.test.sql` |
| AC-1012-003 | FR-007; NFR-001/002 | 4,5,6 | unit | `pmo-portal/src/lib/db/__tests__/fxRates.test.ts` |
| AC-1012-004 | FR-007/008; NFR-003 | 7,8,9 | unit | `pmo-portal/src/lib/fxRateBatcher.test.ts` |
| AC-1012-005 | FR-002/007/008; NFR-001/003 | 11,12 | unit | `pmo-portal/src/hooks/useFxRates.test.tsx` |
| AC-1012-006 | FR-005/006; NFR-004 | 13 | unit | `pmo-portal/src/lib/fxEquivalent.test.ts` |
| AC-1012-007 | FR-001..006; NFR-004/005 | 10,11 | unit | `pmo-portal/src/components/fx/FxEquivalent.batch.test.tsx` |
| AC-1012-008 | FR-001/002/003; NFR-004 | 14 | e2e | `pmo-portal/e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts` |

Task 16 gathers evidence for all ACs; it does not reassign ownership. Existing AC-FX-001..015 remain intact. The rollback pgTAP and repository tests support their corresponding ACs without moving canonical ownership. Prefixes `FR-`/`NFR-` in this table abbreviate the spec's full `FR-1012-`/`NFR-1012-` IDs.

Affected route × oracle sweep: `/administration/exchange-rates`, `/projects/:id`, `/projects/:id/overview`, `/sales-invoices`, `/sales-invoices/:invoiceId`; preserve action-completeness, states, data correctness, cross-screen consistency, a11y, phone geometry and role job-fit. No route is added.

## Risks and owner questions

Risks: incomplete uploads versus genuine non-publication; indicative floating-number precision at large magnitudes; timer/cancellation/invalidation races; batch transport still executes up to 64 indexed predecessor probes; migration-number collision; incomplete historical rendered review. No unverified production claims or client fixtures enter these docs.

**OPEN QUESTIONS (recommended defaults are already used in the spec):**
- **OQ-1012-1:** expand the same-delivery surface set? **Default: no; preserve contract detail and invoice register/detail.** Projects-list contract values are the next candidate, not part of this build.
- **OQ-1012-2:** impose a maximum-age warning/refusal for latest uploaded rates? **Default: no arbitrary cutoff; visible actual publication date/source and indicative-only use.** A future explicit freshness policy must distinguish old documents from open-balance reference freshness and cannot infer BI publication coverage.
