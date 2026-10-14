# JISDOR display equivalents — implementation design and TDD plan

Issue #1012 · 2026-10-14 · migration **0288** (do not use 0286/0287).
Spec: `docs/specs/fx-rates-jisdor.spec.md`. Architecture: ADR-0085.
Status: build instructions for Director review, not evidence that implementation/tests have run.

## Design decisions, in order

1. **Exact versus approximate.** Keep the currency seam from 0187 and DD-CUR-6's exact per-currency totals. Add only subordinate labelled text at the specified contract/invoice locations. No money-path, exporter, tax or aggregation changes. Copy DD-FX-1 from the spec into `docs/decisions.md` during the code issue.
2. **Storage and authority.** Org-scoped reference rows, FORCE RLS, active-member read, Finance/Admin insert/update. Use column grants after table-level revoke; stamps and audit events belong to triggers. Admin-only manual-add/edit UI follows the specific owner ruling; Finance may upload corrections. Operator membership never substitutes for the org role. No DELETE grant/policy/UX.
3. **One historical selector.** `fx_rate_on(base text, quote text, on_date date)` is STABLE SECURITY INVOKER and returns zero or one row `{rate,rate_date}`. DAL maps zero rows to `null`. Latest balance = invoke the same selector with today's organization-local calendar date, never the invoice date. Missing document date never invokes the function. No client-side scan to find a prior publication.
4. **Import reuse.** Extend the shared ExcelJS read seam with a bounded raw-cell grid while preserving the old parser's exact default behavior. Reuse its error/row-limit contracts, not its create-per-row commit loop. FX has a focused file→preview→confirm→result flow built on shared modal/table/button/confirmation primitives, plus an atomic invoker upsert writer. No new dependency or package/lock edit. Real BI decoder compatibility is settled by the supplied file before merge.
5. **Administration access.** Add `/administration/exchange-rates` to the existing section shell. Finance gets a native Administration link/palette target directly to that section and sees only that section. Admin retains existing sections plus FX. Executive/PM/Engineer and Operator-only viewers retain existing administration behavior, without FX. Do not broaden `user.view` or unrelated setup policies to admit Finance.
6. **Cache and bounds.** Table index supports date seek and management pagination. Management reads use `limit(51)` and `lt(rate_date,cursor)`, show 50 rows and derive `nextCursor` from the last shown date. Fixed pair/source means dates are unique within an org. React Query shares one lookup by org/pair/day, not by amount. Finite 30s rate stale time, success invalidation, org-keyed caches, refetch-on-focus; latest org day is recomputed every minute while mounted. No all-history downloads for display, no per-cell workbook dependency.
7. **Errors and trust.** Resolve the org default before deciding to convert; the existing USD placeholder is not authoritative. Pending, lookup failure, missing rate, missing date and unsupported pair are distinct. Failure preserves forms/preview. Reject any bad row before commit; report actual committed counts rather than claiming preview counts were written. File names/raw workbook values are not telemetry or audit payloads. Audit only normalized dates and before/after rates.

### Components and data flow

```text
Administration shell → AdministrationExchangeRates → useFxRates / useFxRateMutations
  file → readWorkbookGrid / readCsvGrid → parseFxRows → buildFxPreview
  preview → ConfirmDialog → repositories.fxRates.upsert → DAL → upsert_fx_rates → RLS/triggers
  list   → repositories.fxRates.list → indexed fx_rates page
Project header/overview + SalesInvoices list/detail → FxEquivalent
  → useOrgCurrencyState + useFxOrgDay (latest only) + useFxRate
  → repositories.fxRates.onDate → DAL → fx_rate_on → rate/date → formatFxEquivalent
```

New files are under `pages/`, `src/components/fx/`, `src/hooks/`, `src/lib/import/`, `src/lib/db/`, `src/lib/repositories/`, and `src/lib/fxEquivalent.ts`. Existing primitives live in `src/components/ui`, not the legacy root components directory. Tests import shipped modules; no copied production algorithm in an oracle.

**Scaling / reuse audit.** Rates are a bounded daily reference series; composite key has org first, pair/source equality then date range. A separate `(org_id,rate_date DESC)` index serves the management list. Fifty invoice rows can need fifty distinct historical lookups (one per distinct date), never one per amount plus one per total; React Query coalesces duplicates and all outstanding cells share today's key. This is bounded by the mounted invoice working set but the existing invoice page loads its list wholesale: do not silently rewrite its list contract here. Observe unique-date request count in the DAL/hook test and rendered review; if real-volume invoice lists warrant it, Director can separately authorize a batch selector retaining `fx_rate_on` as the only selection rule. No fetch-every-publication workaround. File processing is capped at 5 MiB/500 rows and ExcelJS stays lazy. Shared parser extraction is quality-only: compatibility tests must show existing import outputs/errors unchanged.

## Shared type/signature contract

Paths below are relative to `pmo-portal/` unless prefixed `supabase/`, `scripts/`, or `docs/`.

```ts
// src/lib/repositories/types.ts
export type FxRateRow = Tables<'fx_rates'>;
export type FxRateInput = { rate_date: string; rate: number };
export type FxRateMatch = Pick<FxRateRow, 'rate' | 'rate_date'>;
export type FxRatePage = { rows: FxRateRow[]; nextCursor: string | null };
export type FxCommitCounts = { new: number; changed: number; unchanged: number };
export interface FxRatesRepository {
  list(before?: string): Promise<FxRatePage>;
  existing(dates: string[]): Promise<Pick<FxRateRow, 'rate_date' | 'rate'>[]>;
  onDate(base: string, quote: string, onDate: string): Promise<FxRateMatch | null>;
  upsert(rows: FxRateInput[]): Promise<FxCommitCounts>;
  context(): Promise<{ currency: string; timezone: string }>;
}
// src/lib/import/fxRateParser.ts
export type FxRejected = { row: number; reason: string }; // reason = stable i18n code, never raw HTML
export type FxParsed = { rows: FxRateInput[]; rejected: FxRejected[]; duplicates: number };
export function parseFxRows(grid: WorkbookGrid, today: string): FxParsed;
export async function parseFxFile(file: File, today: string): Promise<FxParsed>;
// src/lib/import/fxRatePreview.ts
export type FxPreview = FxParsed & FxCommitCounts;
export function buildFxPreview(parsed: FxParsed, existing: Pick<FxRateRow, 'rate_date' | 'rate'>[]): FxPreview;
// src/lib/fxEquivalent.ts
export function formatFxEquivalent(amount: number, match: FxRateMatch): string;
export function orgDay(instant: Date, timezone: string): string;
// src/components/fx/FxEquivalent.tsx
export interface FxEquivalentProps { amount: number | null; currency: string; date: string | null; }
// date === 'latest' is the only latest-mode sentinel; null means missing document date.
```

Generated Supabase types remain the row authority (ADR-0003); do not hand-maintain a duplicate FX table shape in `types.ts`. The `rate` arrives as a number with six decimal places maximum; it is not a cents-scaled integer. Approximation multiplication is display-only; `formatNumber` rounds once to whole rupiah. Never mutate the caller's amount.

## Verification command contract

All shell commands start at the worktree root. `V` is the exact unit wrapper, defined once and reused literally in tasks:

```bash
V() { scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run "$@"' fx-unit "$@"; }
D() { scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db "$@"' fx-db "$@"; }
```

`D` holds reset+test together. Engineering work in each task is 2–5 minutes; DB reset/browser wait time is additional, not permission to combine tasks. Write the named failing assertions **before** the named implementation; capture RED then GREEN. Do not skip/weaken existing tests. Tasks reusing an AC add supporting cases to its canonical owning test, not new ownership.

## Tasks (42)

### 01 — Schema contract test (3 min; AC-FX-002)

Create `supabase/tests/0288_fx_rates_write.test.sql`. Begin transaction, create pgTAP extension, use `no_plan()` and `finish()`, rollback. First RED assertions: `has_table('public','fx_rates', 'AC-FX-002 table exists')`, `has_column` for each schema column listed in task 02, `col_type_is('public','fx_rates','rate','numeric(18,6)','AC-FX-002 rate precision')`. Insert a synthetic org with `insert into organizations(id,name) values(gen_random_uuid(),'FX Test Org') returning id`, capture the returned id and call `set_config('fx.org',id::text,true)`; no production identifiers/emails. As table owner, insert date `2026-10-09`, rate `16234.56`, that org. Assert stored rate with `is((select rate from fx_rates where org_id=current_setting('fx.org')::uuid),16234.56::numeric,'AC-FX-002 rate retained exactly')`. Use `throws_ok` SQL inserts for 0, -1, NaN, 999, 100001 and unsupported base/quote/source (23514); duplicate key must throw 23505. Keep each early `throws_ok` as the canonical constraint assertion so newly added schema cannot make a malformed fixture falsely GREEN. Verify RED: `D supabase/tests/0288_fx_rates_write.test.sql`.

### 02 — Create constrained reference schema (4 min; AC-FX-002)

Create `supabase/migrations/0288_fx_rates_jisdor.sql` with this first section. No alterations to document tables:

```sql
create table public.fx_rates (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null default public.auth_org_id() references public.organizations(id),
 rate_date date not null,
 base_currency text not null default 'USD' check (base_currency = 'USD'),
 quote_currency text not null default 'IDR' check (quote_currency = 'IDR'),
 rate numeric(18,6) not null check (rate > 0 and rate between 1000 and 100000),
 source text not null default 'JISDOR' check (source = 'JISDOR'),
 created_by uuid references public.profiles(id),
 updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (org_id, source, base_currency, quote_currency, rate_date)
);
create index fx_rates_org_date_idx on public.fx_rates(org_id, rate_date desc);
create trigger fx_rates_stamp_org_id before insert on public.fx_rates
 for each row execute function public.stamp_org_id();
```

The org default is `auth_org_id()` instead of a seed-org literal; typegen still marks it optional and the shared org stamp remains attached. Table-owner test fixtures supply their synthetic org explicitly. Verify GREEN: `D supabase/tests/0288_fx_rates_write.test.sql`.

### 03 — Active-member/RLS fixtures (5 min; AC-FX-001)

Create `supabase/tests/0288_fx_rates_rls.test.sql`. Transaction with `no_plan()`. Generate two orgs and seven auth/profile actors using `gen_random_uuid()`; synthetic fixture labels only. Roles in org A: Admin, Finance, Executive, PM, Engineer, disabled Finance; org B: Admin. Seed one rate per org as owner. Store fixture IDs in transaction-local `fx.*` settings. Set `role authenticated` and `request.jwt.claims` with only synthetic subject and `role:authenticated`, as in `0245_management_pack.test.sql`. RED case matrix: five active A actors read exactly A's rate; disabled actor reads zero; B actor reads B only; anonymous select/write denied. Finance and Admin `lives_ok` inserts of distinct dates and rate-only updates; Executive/PM/Engineer/disabled insert `throws_ok` 42501 and update returning yields no rows. Own-org row's `org_id`, `created_by`, pair/source/date/stamps cannot be updated with authenticated grants (42501); reading foreign IDs returns zero. Revoke/examine `has_table_privilege` and `has_column_privilege` for delete and audit-column mutation; these assertions supplement real DML, never replace it. Verify RED: `D supabase/tests/0288_fx_rates_rls.test.sql`.

### 04 — RLS and explicit grants (3 min; AC-FX-001)

Append to 0288:

```sql
alter table public.fx_rates enable row level security;
alter table public.fx_rates force row level security;
create policy fx_rates_select on public.fx_rates for select to authenticated
 using (org_id = public.auth_org_id() and public.is_active_member());
create policy fx_rates_insert on public.fx_rates for insert to authenticated
 with check (org_id = public.auth_org_id() and public.is_active_member()
             and public.auth_role() in ('Finance','Admin'));
create policy fx_rates_update on public.fx_rates for update to authenticated
 using (org_id = public.auth_org_id() and public.is_active_member()
        and public.auth_role() in ('Finance','Admin'))
 with check (org_id = public.auth_org_id() and public.is_active_member()
             and public.auth_role() in ('Finance','Admin'));
revoke all on public.fx_rates from public, anon, authenticated;
grant select on public.fx_rates to authenticated;
grant insert (rate_date,rate) on public.fx_rates to authenticated;
grant update (rate) on public.fx_rates to authenticated;
```

No table-level mutation grant; no DELETE policy. Verify GREEN: `D supabase/tests/0288_fx_rates_rls.test.sql supabase/tests/0288_fx_rates_write.test.sql`.

### 05 — Stamp and audit behavior tests (4 min; AC-FX-002)

Extend `0288_fx_rates_write.test.sql` using a generated active Finance actor. RED: inserting with only rate_date/rate stamps the actor's org, created/updated actor and nonnull times; a same-rate update preserves stamps and audit event count; a changed rate updates witness and increments `audit_events` for `fx_rate.change`, whose `detail` contains rate_date, old_rate and new_rate. Test rate_date later than org-local today raises 23514. Assert stamp fields cannot be supplied by authenticated insert. Use owner reads of audit_events after resetting role; assert database outcome, not function source. Verify RED: `D supabase/tests/0288_fx_rates_write.test.sql`.

### 06 — Server-owned witnesses and audit (5 min; AC-FX-002)

Append these triggers/functions to 0288:

```sql
create function public.stamp_fx_rate() returns trigger language plpgsql
 set search_path = public as $$
declare today date;
begin
 select (now() at time zone coalesce(default_timezone,'UTC'))::date into today
 from public.organizations where id=new.org_id;
 if new.rate_date > today then
   raise exception 'publication date cannot be in the future' using errcode='23514';
 end if;
 if tg_op='INSERT' then
   new.created_by:=auth.uid(); new.created_at:=now();
   new.updated_by:=auth.uid(); new.updated_at:=now();
 elsif new.rate is distinct from old.rate then
   new.updated_by:=auth.uid(); new.updated_at:=now();
 end if;
 return new;
end $$;
revoke all on function public.stamp_fx_rate() from public,anon,authenticated;
create trigger fx_rates_zz_stamp before insert or update on public.fx_rates
 for each row execute function public.stamp_fx_rate();
create function public.audit_fx_rate() returns trigger language plpgsql security definer
 set search_path = public as $$
begin
 if tg_op='UPDATE' and new.rate is not distinct from old.rate then return null; end if;
 perform public.log_audit('fx_rate.change',new.org_id,auth.uid(),new.id,
   jsonb_build_object('rate_date',new.rate_date,'source',new.source,
     'old_rate',case when tg_op='UPDATE' then old.rate else null end,'new_rate',new.rate));
 return null;
end $$;
revoke all on function public.audit_fx_rate() from public,anon,authenticated;
create trigger fx_rates_audit after insert or update on public.fx_rates
 for each row execute function public.audit_fx_rate();
```

Stamp sorts after org stamp; audit uses the existing revocation/pinned-definer trigger pattern from 0243. Verify GREEN: `D supabase/tests/0288_fx_rates_write.test.sql supabase/tests/0288_fx_rates_rls.test.sql`.

### 07 — Date selector tests (4 min; AC-FX-003)

Create `supabase/tests/0288_fx_rate_on.test.sql`, generated two-org actors, rates Friday `2026-10-09=16234.56`, Monday `2026-10-12=16300`, other-org Friday `18000`. RED assertions use `results_eq` on `select rate,rate_date from fx_rate_on('USD','IDR','2026-10-10')` versus `values(16234.56::numeric,'2026-10-09'::date)`; exact Friday and Monday select themselves; Thursday, null on_date, inverse pair and unsupported pair return zero rows. Other-org actor never receives A's rate. Verify `pg_proc.provolatile='s'` and `prosecdef=false`, then actual DML/lookup behavior. Verify RED: `D supabase/tests/0288_fx_rate_on.test.sql`.

### 08 — One stable invoker lookup (2 min; AC-FX-003)

Append to 0288:

```sql
create function public.fx_rate_on(base text, quote text, on_date date)
 returns table(rate numeric, rate_date date)
 language sql stable security invoker set search_path = public as $$
 select f.rate,f.rate_date from public.fx_rates f
 where f.org_id=public.auth_org_id() and f.source='JISDOR'
   and f.base_currency=base and f.quote_currency=quote and f.rate_date<=on_date
 order by f.rate_date desc limit 1
$$;
revoke all on function public.fx_rate_on(text,text,date) from public,anon;
grant execute on function public.fx_rate_on(text,text,date) to authenticated;
```

Zero rows means no match (not a manufactured row with zero). Verify GREEN: `D supabase/tests/0288_fx_rate_on.test.sql`.

### 09 — Atomic writer contract tests (4 min; AC-FX-001/002)

Extend `0288_fx_rates_write.test.sql` and `0288_fx_rates_rls.test.sql`. RED: active Finance/Admin call `upsert_fx_rates('[{"rate_date":"2026-10-09","rate":16234.56}]')`, repeat, change: expect `{new:1,changed:0,unchanged:0}`, then `{0,0,1}`, then `{0,1,0}` and unchanged audit count on repeat. A payload with one good and one invalid row leaves **neither** written. Reject empty/501 rows, duplicate dates, null/unknown keys, noncanonical dates and >6 decimal precision. Disabled/wrong roles calling the function throw 42501. Verify RED: `D supabase/tests/0288_fx_rates_write.test.sql supabase/tests/0288_fx_rates_rls.test.sql`.

### 10 — Atomic invoker upsert (5 min; AC-FX-001/002)

Append the exact writer below. It validates the entire payload before DML; uses the column grant for the one mutable field; preserves unchanged witnesses. No org/source/pair/actor input:

```sql
create function public.upsert_fx_rates(p_rows jsonb) returns jsonb
 language plpgsql security invoker set search_path = public as $$
declare x jsonb; d date; r numeric; affected integer;
 n integer:=0; c integer:=0; u integer:=0;
begin
 if not public.is_active_member() or public.auth_role() not in ('Finance','Admin') then
   raise exception 'Finance or Admin required' using errcode='42501';
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then
   raise exception 'rate rows must be an array' using errcode='23514';
 end if;
 if jsonb_array_length(p_rows) not between 1 and 500 then
   raise exception 'import requires 1 to 500 rows' using errcode='23514';
 end if;
 for x in select value from jsonb_array_elements(p_rows) loop
   if jsonb_typeof(x)<>'object' or not (x ? 'rate_date' and x ? 'rate')
      or (x-'rate_date'-'rate')<>'{}'::jsonb
      or jsonb_typeof(x->'rate_date') is distinct from 'string'
      or jsonb_typeof(x->'rate') is distinct from 'number' then
     raise exception 'invalid rate row' using errcode='23514';
   end if;
   d:=(x->>'rate_date')::date; r:=(x->>'rate')::numeric;
   if to_char(d,'YYYY-MM-DD')<>(x->>'rate_date')
      or not (r between 1000 and 100000) or scale(r)>6 then
     raise exception 'invalid publication date or rate' using errcode='23514';
   end if;
 end loop;
 if (select count(*)<>count(distinct value->>'rate_date') from jsonb_array_elements(p_rows)) then
   raise exception 'duplicate publication date' using errcode='23514';
 end if;
 for x in select value from jsonb_array_elements(p_rows) order by value->>'rate_date' loop
   d:=(x->>'rate_date')::date; r:=(x->>'rate')::numeric;
   insert into public.fx_rates(rate_date,rate) values(d,r)
     on conflict(org_id,source,base_currency,quote_currency,rate_date) do nothing;
   get diagnostics affected=row_count;
   if affected=1 then n:=n+1;
   else
     update public.fx_rates set rate=r where org_id=public.auth_org_id()
       and source='JISDOR' and base_currency='USD' and quote_currency='IDR'
       and rate_date=d and rate is distinct from r;
     get diagnostics affected=row_count;
     if affected=1 then c:=c+1; else u:=u+1; end if;
   end if;
 end loop;
 return jsonb_build_object('new',n,'changed',c,'unchanged',u);
end $$;
revoke all on function public.upsert_fx_rates(jsonb) from public,anon;
grant execute on function public.upsert_fx_rates(jsonb) to authenticated;
```

Invalid date casts propagate as a classified validation failure; add the exact 22007/22008 error expectation to the noncanonical/impossible-date tests rather than pretending every cast emits 23514. All DML remains inside one function transaction. Verify GREEN: `D supabase/tests/0288_fx_rates_write.test.sql supabase/tests/0288_fx_rates_rls.test.sql`.

### 11 — Reversal, generated types and probe catalog (4 min; AC-FX-001/002/003)

Create `supabase/migrations/rollback/0288_fx_rates_jisdor_down.sql`:

```sql
begin;
drop function if exists public.upsert_fx_rates(jsonb);
drop function if exists public.fx_rate_on(text,text,date);
drop table if exists public.fx_rates;
drop function if exists public.audit_fx_rate();
drop function if exists public.stamp_fx_rate();
commit;
```

The rollback destroys only reference rows/audit trigger attachment; existing immutable audit events remain. Back up the rate rows before a deliberate reversal; no automated production reversal here. First create `scripts/fx-rates-rollback.test.sql` (outside the full pgTAP directory so its intentional teardown cannot affect sibling tests): create pgTAP, `select plan(3);`, `\ir ../supabase/migrations/rollback/0288_fx_rates_jisdor_down.sql`, then `hasnt_table('public','fx_rates','AC-FX-002 rollback removes table')`, `ok(to_regprocedure('public.fx_rate_on(text,text,date)') is null,'AC-FX-003 rollback removes selector')`, `ok(to_regprocedure('public.upsert_fx_rates(jsonb)') is null,'AC-FX-002 rollback removes writer')`, `select * from finish();`. Missing rollback file is RED; actual file teardown followed by the three absence assertions is GREEN. Regenerate `src/lib/supabase/database.types.ts` and `scripts/isolation-probe-denominator.json` after restoring schema **in the same reset lock**:

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db scripts/fx-rates-rollback.test.sql && supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && node scripts/check-isolation-denominator.mjs --write && supabase test db supabase/tests/0288_fx_rates_rls.test.sql supabase/tests/0288_fx_rates_write.test.sql supabase/tests/0288_fx_rate_on.test.sql'
```

Review the manifest's `fx_rates` entry: org-scoped, primary key id, own-org-only read. Trigger-only functions are not new callable definer probes. Verify migrations/ADR collisions: `cd pmo-portal && npm run check:migrations && npm run check:adrs && npm run check:shadow-types`.

### 12 — Typed DAL and repository (5 min; AC-FX-007/008, supporting AC-FX-003)

First create `src/lib/db/__tests__/fxRates.test.ts` with mocked Supabase fluent queries. Assert page `.order('rate_date',{ascending:false}).limit(51)`, cursor `.lt`, pair/source filters, preview `.in('rate_date',dates)`, RPC zero-row→null, error propagation, upsert payload contains only date/rate, and no client `org_id`. Add the shared contract above to `src/lib/repositories/types.ts` and `fxRates: FxRatesRepository` to `Repositories`.

Implement `src/lib/db/fxRates.ts` exporting `listFxRates`, `existingFxRates`, `fxRateOn`, `upsertFxRates`, `fxContext`. Use `supabase` from `src/lib/supabase/client`; throw `error` on every failed response. Existing reads `.select('rate_date,rate').in('rate_date',dates)` return [] immediately for zero dates. `fxContext` reads the own-visible organization's `default_currency,default_timezone` with `.single()` and defaults null timezone to UTC, never defaults missing currency. Page truncates to first50, `nextCursor=data.length>50 ? rows.at(-1)!.rate_date : null`. Map rate match from the RPC's first row or null; writer counts are parsed from its JSON result with a zod object of three nonnegative integers (zod already installed).

Create `src/lib/repositories/fxRates.ts` as the thin adapter using `toAppError`, export `fxRatesRepository`, register it in `src/lib/repositories/index.ts` (each method catches and throws `toAppError`). Repository tests in `src/lib/repositories/fxRates.test.ts` assert the wrapper preserves Postgres code. Verify RED/GREEN: `V src/lib/db/__tests__/fxRates.test.ts src/lib/repositories/fxRates.test.ts`.

### 13 — Query keys and mutation invalidation (4 min; AC-FX-007/008)

First `src/hooks/useFxRates.test.tsx`: test queries are disabled without org, page cursor forms the key, equal lookup dates share one call despite distinct amounts, different org/date never share, failed writes do not invalidate, success invalidates list and equivalents. Implement `src/hooks/useFxRates.ts`:

```ts
export const fxKeys = {
  root: (org: string) => ['fx-rates', org] as const,
  page: (org: string, before?: string) => ['fx-rates', org, 'page', before ?? null] as const,
  onDate: (org: string, base: string, quote: string, day: string) => ['fx-rates', org, 'on', base, quote, day] as const,
};
```

`useFxRates(before?:string)` consumes currentUser org and calls repository.list; `useFxRate(base:string,quote:string,day:string|null,enabled=true)` uses org and nonnull day as enable conditions, 30_000 staleTime and repository.onDate; no `amount` parameter/key. `useFxRateMutations()` returns `upsert=useMutation({mutationFn:repositories.fxRates.upsert,onSuccess:()=>qc.invalidateQueries({queryKey:fxKeys.root(org)})})`. Management page handles result/close, not DAL callbacks. Verify RED/GREEN: `V src/hooks/useFxRates.test.tsx`.

### 14 — Organization day, not viewer day (4 min; AC-FX-004)

First `src/lib/fxEquivalent.test.ts` plus `src/hooks/useFxOrgDay.test.tsx`: at `2026-10-09T17:30:00Z`, Jakarta yields 2026-10-10 while UTC yields 2026-10-09; profile zone cannot change the org day. Midnight tick advances latest query date; historical date does not advance. Implement `orgDay` in `src/lib/fxEquivalent.ts` using `Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant)` and join year-month-day; never parse a localized formatted date string.

Create `src/hooks/useFxOrgDay.ts`. `useFxOrgDay(enabled:boolean)` shares `useQuery` key `['fx-context',org]`, queryFn repository.context, staleTime Infinity. A second query `['fx-org-day',org,context.data?.timezone]` returns `orgDay(new Date(),timezone)`, enabled only when requested and context resolved; staleTime30_000, refetchInterval60_000. This ticker reads cached context, not the DB every minute. Return `{day:string|null,isPending,isError,retry}` combining the context/day query states; context failure never becomes UTC success. Verify RED/GREEN: `V src/lib/fxEquivalent.test.ts src/hooks/useFxOrgDay.test.tsx`.

### 15 — Raw workbook grid extraction with compatibility proof (5 min; AC-FX-005)

First extend `src/lib/import/__tests__/parseWorkbook.test.ts` with golden tests for existing first-row header parsing, trimmed cell.text, blank-row behavior, empty/invalid/over-limit errors. Create `src/lib/import/readWorkbookGrid.ts`:

```ts
export type WorkbookCell = { text: string; value: string | number | Date | null; formula: boolean };
export type WorkbookGrid = { rows: WorkbookCell[][]; date1904: boolean };
export async function readWorkbookGrid(buf: ArrayBuffer, limits?: { maxRows: number; maxColumns: number }): Promise<WorkbookGrid>;
```

Move the lazy ExcelJS import/workbook load/first-worksheet validation from `parseWorkbook.ts` into this function. Read physical rows and populated columns; accept an optional `{maxRows:number;maxColumns:number}` reader argument so FX requests520 nonblank rows/50 populated columns (retain blank grid slots for physical row numbering) while existing `parseWorkbook` retains its current limits/output behavior. Formula/formula-result cells keep `formula:true` and **no evaluated value**. Preserve Date objects and numeric cell values; rich text/hyperlink cells expose only `cell.text`, never HTML. `date1904=Boolean(wb.properties.date1904)`. `parseWorkbook.ts` now uses grid row1 texts and rows2..N text arrays with exactly its old blank/header/error contracts; the FX-only raw-grid cap is an early resource guard, not a relaxed 500-data-row rule or a new bound on existing descriptors. Verify RED/GREEN: `V src/lib/import/__tests__/parseWorkbook.test.ts`.

### 16 — CSV grid decoder (4 min; AC-FX-006)

First add CSV cases to `src/lib/import/__tests__/fxRateParser.invalid.test.ts`: BOM, CRLF, quoted comma `"16,234.56"`, escaped double quote, malformed unclosed quote and wrong column count. Create `src/lib/import/readCsvGrid.ts` exporting `readCsvGrid(text:string):WorkbookGrid`; finite-state loop with `quoted`, `field`, `row`, `rows`: quote opens only at empty field, doubled quote inside quoted field appends one quote; comma/newline terminates only outside quotes; CR preceding LF is consumed; closed-quote followed by anything other than delimiter/newline is rejected; EOF quoted throws `ImportParseError`; trim first BOM, preserve physical blank lines and row numbering. Cells return `{text:field.trim(),value:field.trim(),formula:false}`, date1904 false. Reject malformed CSV with a stable parser reason, not a best-effort split. Verify RED/GREEN: `V src/lib/import/__tests__/fxRateParser.invalid.test.ts`.

### 17 — Locale-independent rate grammar (5 min; AC-FX-005/006)

First `src/lib/import/__tests__/fxRateParser.test.ts` table: numeric16234.56; strings `16234`, `16234.56`, `16.234,56`, `16,234.56`, `16.234,00`, `16,234.00`, `16.234`, `16,234`, all expected16234 or16234.56. Invalid file: `16,23,4`, `16.234.56`, `NaN`, `Infinity`, `0`, `-1`, `16.2340000`, `16234560`, currency labels and exponent strings reject. Include `16234.1234567` rejection, and both bound endpoints accepted.

Implement `parseFxRate(value:string|number):number|null` in `src/lib/import/fxRateParser.ts`. Numbers require finite, band and scale≤6. String candidate grammars: ungrouped integer; ungrouped digits with a single decimal `.`/`,` and1..6 fraction digits; grouped integer `\d{1,3}([.,]\d{3})+` with one consistent separator; grouped decimal with the *other* separator after the grouped integer and1..6 fraction digits. Normalize each matched grammar independently, deduplicate numeric candidates, filter band/precision; return only when exactly one remains. Do not use replacement on strings that have not matched a full grammar; do not use viewer locale. Verify RED/GREEN: `V src/lib/import/__tests__/fxRateParser.test.ts src/lib/import/__tests__/fxRateParser.invalid.test.ts`.

### 18 — Calendar dates and Excel epochs (5 min; AC-FX-005/006)

First parser tests: ISO/day-first; `9 Oktober 2026`, `09 Oct 2026`, `9 October 2026`, `9 Okt 2026`; leap valid `29 Februari 2024`, invalid `29 February 2026`; no-year/malformed date, future date reject; same calendar output in browser UTC/Jakarta/New York. Excel serials for 1900 and1904 must produce equal dates; serial60 in1900 (fictional1900-02-29) rejects, fractional serial/time rejects.

Implement `parseFxDate(value:string|number|Date,date1904:boolean,today:string):string|null`. For Date use UTC year/month/day only and reject nonmidnight; ExcelJS XLSX dates are UTC calendar values. Numeric serial: safe integer,1900 serial1 maps1900-01-01, subtract one day for serial>60;1904 serial0 maps1904-01-01; build with UTC arithmetic. String pattern order ISO then day-first numeric then day+month+four-digit-year. Month map includes `januari/january/jan`, `februari/february/feb`, `maret/march/mar`, `april/apr`, `mei/may`, `juni/june/jun`, `juli/july/jul`, `agustus/august/agu/ags/aug`, `september/sep/sept`, `oktober/october/okt/oct`, `november/nov`, `desember/december/des/dec`. Validate UTC constructor round trip and `iso<=today`, never `Date.parse` on localized text. Verify RED/GREEN: `V src/lib/import/__tests__/fxRateParser.test.ts src/lib/import/__tests__/fxRateParser.invalid.test.ts`.

### 19 — Header detection, validation and duplicates (5 min; AC-FX-005/006)

First canonical parser tests with three BI title rows, a `Tanggal`/`Kurs JISDOR` header, a blank row, valid rows and rejected footer; assert physical row numbers. Reject multiple date/rate columns, multiple plausible headers and formula cells. Equal normalized duplicate collapses with duplicates1; conflict flags **both** physical rows and excludes the date.

Implement `parseFxRows` in `fxRateParser.ts`: scan up to20 physical rows for header pairs; normalize case/trim/collapse whitespace; recognize exact `date/tanggal`, `rate/kurs/jisdor/kurs jisdor`; require exactly one unique header candidate, date column and rate column. For CSV validate precisely two headers `date,rate` in the wrapper. Ignore wholly empty data rows, increment physical row number otherwise. Apply date/rate parsers, attach `invalidDate`, `futureDate`, `invalidRate`, `formula`, `duplicateDate`, `ambiguousHeader` codes. Hold `Map<date,{rate,rowNumbers}>`; conflicts reject all contributors, equal values collapse and count duplicates. Enforce ≤500 nonblank data rows including rejected rows (not merely accepted rows). Verify RED/GREEN: `V src/lib/import/__tests__/fxRateParser.test.ts src/lib/import/__tests__/fxRateParser.invalid.test.ts`.

### 20 — File dispatch and resource states (3 min; AC-FX-006)

First invalid-file tests for >5MiB, empty, unsupported binary, case-insensitive extension and non-XLSX content under xlsx extension. Implement `parseFxFile`: reject file.size>5*1024*1024 before read; `.csv`→text→readCsvGrid with exact date/rate header; `.xlsx`→arrayBuffer→readWorkbookGrid(buffer,{maxRows:520,maxColumns:50})→parseFxRows. Catch ImportParseError without flattening reason codes; unsupported extension gets explicit `unsupportedFile` message. Never advertise legacy `.xls` support without the real sample. Release buffer references after returning only normalized rows/reasons; never retain File/ArrayBuffer in result state. Verify RED/GREEN: `V src/lib/import/__tests__/fxRateParser.invalid.test.ts`.

### 21 — Real BI compatibility gate (5 min after file supplied; AC-FX-014)

Create `src/lib/import/__tests__/fixtures/bi-jisdor-original.xlsx` **only if that is the actual downloaded encoding**, and `src/lib/import/__tests__/fxRateParser.bi.test.ts`; synthetic initial fixture goes at `fixtures/jisdor-synthetic.xlsx` and is never the AC-FX-014 oracle. Director supplies the public BI file and independent date/rate transcription; do not manufacture an original file. Before merge replace the synthetic-only compatibility proof with the unmodified real export, pin its checksum/source-download date and independently checked expected rows in the test comment. Test calls the shipped file decoder and parser and compares all supplied oracle values, header row and row count, not merely “rows >0”. Actual unsupported format = RED and STOP to Director under the no-new-dependency constraint; do not rename BIFF bytes `.xlsx`. No Client data in fixture. Verify: `V src/lib/import/__tests__/fxRateParser.bi.test.ts`. This task cannot be marked complete without the real file.

### 22 — Preview classification (3 min; AC-FX-007)

First `src/lib/import/__tests__/fxRatePreview.test.ts`: existing dates `09=16234.56`, `12=16300`; incoming09 same,12=16400,13=16500 → new1 changed1 unchanged1. Rejected rows and duplicate count retained; no mutation of inputs. Implement `src/lib/import/fxRatePreview.ts`: `Map(existing.map(r=>[r.rate_date,r.rate]))`, reduce normalized parsed rows; absent→new, same numeric→unchanged, else changed; return `{...parsed,new,changed,unchanged}`. Preview never chooses historical fallback and never mutates database. Verify RED/GREEN: `V src/lib/import/__tests__/fxRatePreview.test.ts`.

### 23 — FX UX authorization predicates (3 min; AC-FX-009/010)

First extend `src/auth/policy.test.ts`: all roles plus null and viewOnly, Admin/Finance can view maintenance/upload, only Admin create/edit manually, others denied; impersonation fence denies all writes. Add `'fxRate'` to Entity and `'upload'` to Action in `src/auth/policy.ts`:

```ts
fxRate: {
 view: allow(REVENUE_WRITE),
 upload: (role,ctx) => has(REVENUE_WRITE,role) && ctx.record?.viewOnly !== true,
 create: (role,ctx) => has(ADMIN,role) && ctx.record?.viewOnly !== true,
 edit: (role,ctx) => has(ADMIN,role) && ctx.record?.viewOnly !== true,
},
```

Page computes `viewOnly=effectiveRole!==realRole` from `useEffectiveRole()` and passes it to each mutation predicate. Display read components do not use maintenance `view`; RLS active-member read is independent. Verify RED/GREEN: `V src/auth/policy.test.ts`.

### 24 — Localized labels and navigation metadata (3 min; AC-FX-010/013)

First add FX breadcrumb assertion to `src/components/shell/__tests__/breadcrumb-nav.test.ts` and Bahasa assertion to `breadcrumb.locale.test.tsx`. In `src/components/shell/routeMatch.ts` add `'exchange-rates':'Exchange rates'` to `ADMINISTRATION_SECTION_LABELS`, matching `'exchange-rates':'admin.nav.exchangeRates'` in keys. Add static `t('admin.nav.exchangeRates','Exchange rates')` call in Administration label builder. Add en/id catalogue entries to `public/locales/{en,id}/common.json` for the literal FX keys used in tasks26–34; exact bilingual copy table below. No unrelated catalogue rewrite. Verify RED/GREEN: `V src/components/shell/__tests__/breadcrumb-nav.test.ts src/components/shell/__tests__/breadcrumb.locale.test.tsx`; `node scripts/check-i18n-completeness.mjs --id` after all static calls land.

### 25 — Finance discovery without broad setup access (5 min; AC-FX-010)

First `pages/__tests__/Administration.fxAccess.test.tsx`: Finance direct FX mounts only FX; Finance users/accounting URL denies without those panels/queries; Admin FX link visible; Executive and Engineer/Operator-only FX direct URL denies and link hidden; Operator pending/error must not block settled Finance FX; existing Operator routes retain checks. Add corresponding Finance rail/palette target assertions to `src/components/shell/__tests__/Rail.test.tsx` and `routeMatch.rbac.test.ts`.

Modify `pages/Administration.tsx`: extend union and organization list with `'exchange-rates'`; navigation accepts `sections:AdministrationSection[]`; derive it as existing org sections filtered to remove FX unless `may('view','fxRate')`, and **Finance gets only `['exchange-rates']`**. `fxRoute=section==='exchange-rates'`, `canFx=may('view','fxRate')`; for FX routes bypass Operator check, allow only canFx. For all non-FX sections preserve existing Admin/Executive/Operator check. Add SelectedAdministrationPanel FX case wrapping `<AdministrationExchangeRates />` with matching data-testid. Unknown-route behavior stays existing users fallback except Finance fallback goes FX. Adjust `/administration` compatibility redirect in `App.tsx` and shell to Finance FX except legacy budget-account-map hash (that target still denies Finance). Add canonical explicit FX route alongside existing AdministrationPage routes.

`Rail.tsx`: include Finance in footer visibility but target its footer to `/administration/exchange-rates`; other targets unchanged. `routeMatch.ts` MODULES administration roles includes Finance; make `modulesForRole` return a Finance-specific copy with path `/administration/exchange-rates` so App palette follows the same target. For the FX breadcrumb's parent href use `/administration/exchange-rates` (not inaccessible Finance/users); non-FX breadcrumbs unchanged. Verify RED/GREEN: `V pages/__tests__/Administration.fxAccess.test.tsx pages/AdministrationShell.test.tsx src/components/shell/__tests__/Rail.test.tsx src/components/shell/__tests__/routeMatch.rbac.test.ts App.routes.test.tsx`.

### 26 — Paginated rate list (5 min; AC-FX-008)

First `pages/__tests__/AdministrationExchangeRates.test.tsx`: prepare51 fixture entries and mock repository page1 as `{rows:fixtures.slice(0,50),nextCursor:fixtures[49].rate_date}`, page2 as `{rows:fixtures.slice(50),nextCursor:null}`; list shows first50 descending (the DAL's51-row sentinel trimming is separately proved in12); Next requests last shown date, Previous uses stack, disabled bounds; pending/error/empty differ and retry invokes refetch. Create `pages/AdministrationExchangeRates.tsx`: call `useFxOrgDay(true)` for upload/manual validation; disable these actions until day resolves, and state org-context pending/error with retry rather than guessing UTC. SectionHeader localized FX title; paragraph “USD → IDR · JISDOR · display equivalents only”; Upload primary action for `may('upload','fxRate',viewOnlyCtx)`, New rate outline action for Admin. `cursorStack:string[]`, first cursor undefined; Next push data.nextCursor, Previous pop; current query `useFxRates(cursorStack.at(-1))`. `DataTable<FxRateRow>` columns Date (formatDateOnly), Rate (`formatNumberExact` + tabular), Source (`JISDOR`); Admin-only row menu Edit, no delete. `ListState` pending/error/empty with retry and localized remedy; never render empty when pending. DataTable responds at390 without adding a second DOM branch. Verify RED/GREEN: `V pages/__tests__/AdministrationExchangeRates.test.tsx`.

### 27 — Manual form validation (4 min; AC-FX-009)

First `src/components/fx/FxRateForm.test.tsx`: blank untouched no eager error; bad/future date, bad grouping, out-of-band and excess precision block submit; blur error doesn't trap focus; failed save persists entries. Create `src/components/fx/FxRateForm.tsx` props `{row?:FxRateRow;draft?:FxRateInput;today:string;loading:boolean;submitError:SubmitError|null;onClose:()=>void;onSubmit:(row:FxRateInput)=>void}`. `useEntityForm<{date:string;rate:string}>` initial date/rate from draft then row then empty strings; format normalized draft/row rate with the existing `formatMoneyInputValue` before entering viewer-locale text. Validate blur/submit, required fields both. Shared `TextField` date type=date, max=today, date disabled on edit; rate string parses with `parseMoneyInputAtScale(value,6)` in **viewer locale**, then validates same band. Download parser remains locale-independent. Shared `EntityFormModal` receives `open`, `loading`, `submitError`, `dirty={form.isDirty}`, `errorSummary` built from fieldProps IDs/errors, and `onSubmit={(e)=>{e.preventDefault();void form.handleSubmit(values=>onSubmit(normalize(values)));}}`; it has **no `form` prop**. Title and submit New rate/Edit rate, fields use `form.fieldProps`. Callback submits normalized date/number only. Verify RED/GREEN: `V src/components/fx/FxRateForm.test.tsx`.

### 28 — Manual create/overwrite and failure persistence (4 min; AC-FX-009)

Extend canonical form/page tests: Admin click New rate; entering an existing date calls repository.existing before mutation; confirmation shows date + old/new formatted rates; Cancel writes zero, Confirm one row; identical value closes with unchanged message and no fabricated change; changed value remains after rejection. Wire AdministrationExchangeRates: `formTarget:{row?:FxRateRow;draft?:FxRateInput}|null`, `pendingManual:FxRateInput|null`, `manualError:SubmitError|null`. On form submit read existing([date]); if existing different, close the form into a ConfirmDialog with authoritative old/new/date summary; Cancel reopens preserved draft. If new/same, commit `[input]`. On failure classifyMutationError and restore `formTarget` with `draft:pendingManual` (retain its original row for edit mode) + persistent SubmitError; do not rely only on toast. Successful actual counts toast, reset cursor to newest, close. Gate callback as well as affordance with manual permission/viewOnly. Verify RED/GREEN: `V src/components/fx/FxRateForm.test.tsx pages/__tests__/AdministrationExchangeRates.test.tsx`.

### 29 — Upload selection and preview (5 min; AC-FX-007)

First `src/components/fx/FxRateUpload.test.tsx`: file selection with header variants yields normalized preview/counts and zero writes, parse errors show physical rows; existing-fetch failure is retryable and never classifies every row as new; rejected preview disables commit; new-file selection clears old preview; out-of-order parse result cannot replace newer selection.

Create `src/components/fx/FxRateUpload.tsx` props `{today:string;onClose:()=>void;onCommitted:(counts:FxCommitCounts)=>void;canUpload:boolean}`. EntityFormModal for file/preview shell and labeled native file input accept `.xlsx,.csv`; selection first size-checks, then `parseFxFile`, then `repositories.fxRates.existing(parsed.rows.map(r=>r.rate_date))`, then `buildFxPreview`. Keep generation ref incremented on each selection/close and discard async results with old generation. State discriminants `choose|parsing|preview|error|committing|done`; input disabled in commit. Show new/changed/unchanged/duplicate counts and normalized DataTable date/rate preview; rejected row/reason list role=alert, bounded scroll with accessible label/focus. Disable Continue unless canUpload, no rejected rows, rows.length>0 and preview lookup succeeded. Verify RED/GREEN: `V src/components/fx/FxRateUpload.test.tsx`.

### 30 — Upload confirmation, commit and cache freshness (4 min; AC-FX-007)

Extend same upload test: preview Continue opens ConfirmDialog; no write until confirm; Cancel restores preview, double Confirm makes one request; mock commit counts differing from preview and assert result uses committed counts; writer failure closes confirmation and restores preview with persistent SubmitError and entries intact; blocked viewOnly cannot call writer. Wire `useFxRateMutations().upsert.mutateAsync(preview.rows)`, one call for file. Unmount the preview EntityFormModal while ConfirmDialog is open, retaining normalized preview state; Cancel remounts it. Never run two independent focus traps simultaneously. Shared ConfirmDialog names source/pair and counts; on rejection use `classifyMutationError`, persistent in-dialog SubmitError, keep all entries. On success onCommitted(actualCounts), clear input/File refs, invalidate handled by hook, parent resets to first page and closes. Reuse actual counts for localized success text. Open it from AdministrationExchangeRates Upload action; no ImportWizard descriptor side effects. Verify RED/GREEN: `V src/components/fx/FxRateUpload.test.tsx src/hooks/useFxRates.test.tsx`.

### 31 — Shared equivalent formatter (3 min; AC-FX-004)

First `src/lib/fxEquivalent.test.ts`:100×16234.56 → exact displayed1623456;1.01×16234.56 rounds16397;0 gives0 with real match; no mutation; invalid/nonfinite amount/rate rejects rather than formats NaN/Infinity; en/id number grouping differs but Rp/source/ISO date do not. Implement formatter using existing locale resolver:

```ts
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
export function formatFxEquivalent(amount: number, match: FxRateMatch): string {
  const converted = amount * match.rate;
  if (!Number.isFinite(amount) || !Number.isFinite(match.rate) || match.rate <= 0 || !Number.isFinite(converted)) {
    throw new RangeError('Equivalent is unavailable');
  }
  const money = new Intl.NumberFormat(getNumberLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(converted);
  return `≈ Rp ${money} (JISDOR ${match.rate_date})`;
}
```

Helper accepts a known match, never fabricates absence. Component handles no-rate messages. Verify RED/GREEN: `V src/lib/fxEquivalent.test.ts`.

### 32 — Component states and one query seam (5 min; AC-FX-004)

First canonical `src/components/fx/FxEquivalent.test.tsx` with mocked hooks: same currency null render/no lookup; org placeholder does not decide eligibility; USD/IDR valid; USD/USD null; EUR/IDR unsupported; USD/EUR unsupported; date null missing; dated absent includes requested date; latest absent includes orgDay; pending/error distinct with retry; original zero valid; null amount no lookup and no numeric equivalent. Snapshot amount unchanged.

Implement `src/components/fx/FxEquivalent.tsx`: useOrgCurrencyState and useAuth; `useFxOrgDay(date==='latest' && eligible)`; `requestedDay=date==='latest'?orgDay.day:date`. All hooks unconditional; lookup enabled only resolved foreign USD/IDR, finite nonnull amount and valid requestedDay. Return null for null amount or resolved same currency. For unresolved org currency show loading/error state, never guess. For supported foreign missing document date state missingDate; unsupported currency state unsupportedPair. Then latest org-day pending/error, rate pending/error/no match/success. Render subordinate `<span className="block min-w-0 break-words text-xs font-normal tabular text-muted-foreground">`; Retry Button outline size sm only on failures. No duplicate original in this component: caller's original stays first. Use static bilingual `fx.*` t calls. Verify RED/GREEN: `V src/components/fx/FxEquivalent.test.tsx`.

### 33 — Contract header and relocated overview (4 min; AC-FX-011)

First `pages/project-detail/__tests__/ProjectFxEquivalent.test.tsx`: import real ProjectDetailHeader and OverviewTab; mocked repository/hooks with USD contract100, contract_date2026-10-10 and IDR org, Friday rate; prove publication date vs contract date distinction; Engineer overview gets same equivalent; null date states missing; IDR no equivalent; no `FxEquivalent` call for margin/committed/actual; original tax basis and contract editing buttons still work.

Add `<FxEquivalent amount={project.contract_value} currency={project.currency} date={project.contract_date} />` immediately **after** the existing original contract amount in ProjectDetailHeader contract tile's value subtree, as its own full-width row (`basis-full`) so Edit stays on original baseline. In OverviewTab financeTiles contract value replace string with `<><span>{formatCurrency(contract,project.currency)}</span><FxEquivalent amount={project.contract_value} currency={project.currency} date={project.contract_date} /></>` when showFinanceSummary; preserve TaxBasisLabel in sub. Do not add a second equivalent to its lock-explanation row or invoicing aggregate card; do not add one to PipelineLens estimate without contract date. Verify RED/GREEN: `V pages/project-detail/__tests__/ProjectFxEquivalent.test.tsx pages/project-detail/__tests__/OverviewTab.test.tsx`.

### 34 — Invoice list and routable detail (5 min; AC-FX-012)

First `pages/__tests__/SalesInvoices.fx.test.tsx`: actual page compositions with USD/IDR/EUR fixtures, two invoice dates and outstanding latest; amount100, gross111, outstanding25; assert calls/strings correspond to same original values, not contract/gross swapped into net; null amount/outstanding do not become0; route `/sales-invoices/:invoiceId` shows equivalent and date; export still original columns only. Use no all-USD-only fixtures (#530's lesson).

In SalesInvoices amount cell, insert FxEquivalent after original span (amount, invoice_date); gross line, after its original total-due sentence (invoiceGross(inv), invoice_date); outstanding cell after original outstanding span (erp_outstanding_amount, `'latest'`). No equivalent for paid-to-date/opening annotation or exports. In `pages/approvals/SalesInvoiceApprovalRow.tsx`, extend Preview prop to `{inv:SalesInvoiceRow;showFx?:boolean}` default false. With showFx, append equivalents inside original amount and total-due dd, and append a labelled Outstanding row containing original outstanding then latest equivalent. Only SalesInvoices detail passes `<SalesInvoiceApprovalPreview inv={viewTarget} showFx />`; approval inbox behavior is unchanged. No conversions for line rates/tax or margins. Verify RED/GREEN: `V pages/__tests__/SalesInvoices.fx.test.tsx pages/__tests__/SalesInvoices.deepLink.test.tsx pages/approvals/SalesInvoiceApprovalSection.test.tsx`.

### 35 — Layer-1 composed a11y and Bahasa (5 min; AC-FX-013)

Extend `pages/__tests__/Administration.a11y.test.tsx` before component fixes: mock fxRates repository, settle FX DataTable, include FX route1280/390 and Finance/Admin cases. Canonical `AC-FX-013` case scans list + manual dialog + upload preview + rejected/save-error state via shipped `axeViolations` helper, requires `blocking=[]`; test focus restores to opener on Cancel/Escape and input/date/rate/retry names exist in id locale. Add id catalogue render assertions to FxRateUpload/FxRateForm tests. Fix names/semantic markup inside new components (label native file input, SectionHeader heading levels, bounded scroll group, FieldError association, persistent error region); no axe rule suppression or weakening. Verify RED/GREEN: `V pages/__tests__/Administration.a11y.test.tsx src/components/fx/FxRateUpload.test.tsx src/components/fx/FxRateForm.test.tsx`; `node scripts/check-i18n-completeness.mjs && node scripts/check-i18n-completeness.mjs --id`.

### 36a — Disposable cross-stack fixtures (5 min; supporting AC-FX-015)

First create the AC-FX-015 e2e file with a fixture-only RED step: import `createFxFixture` from `./fx-rates.fixtures`, assert returned orgId/projectId/invoiceId and assert the new org starts with zero rates. Implement `e2e/fx-rates.fixtures.ts`; use the test-only administrative Supabase client construction from `e2e/AC-NAR-003-no-erp-billing.spec.ts`, and the per-org provisioning shape from `e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts` **without** its external integrations. Export `createFxFixture(admin:SupabaseClient)` returning `{orgId,financeId,email,password,companyId,projectId,invoiceId}`. Generate IDs/email suffix/password entirely at runtime; synthetic address domain `example.invalid`, random disposable password retained only in memory. Insert own organization (default_currency IDR, default_timezone Asia/Jakarta), `auth.admin.createUser` with email confirmation, then profile upsert (Finance, active, own org). Insert own Client company; own Ongoing Project with currency USD, contract_value100, contract_date2026-10-10, subject_to_vat false; own **read-only invoice fixture** with project/customer/own org, currencyUSD, amount100, tax_amount0, tax_treatment exclusive, invoice_date2026-10-12, statusUnpaid, erp_docstatus1, erp_outstanding_amount25, pmo_native false. This mirror fixture does not require an ERP connection or perform a money transition. Throw every setup error and retain each allocated ID immediately so partial cleanup works. No external ownership rows, shared actors or shared rates. Verify RED/GREEN fixture binding: `scripts/e2e-local.sh AC-FX-015`.

### 36b — Real fixture login and mandatory cleanup (4 min; supporting AC-FX-015)

First extend the same e2e test with a real-login RED assertion that authenticated Administration opens the FX page and a cleanup assertion that owned business rows are removed. Do **not** call `helpers.signIn` for the disposable user: it replays seed-only captured sessions. Drive `/login` using `getByLabel(/email/i)`, `getByLabel(/password/i)` and `getByRole('button',{name:/sign in/i})` from `e2e/auth.setup.ts`; fill this fixture's in-memory credentials and assert root redirect, then FX heading. Export `removeFxFixture(admin,fixture)` from the fixture module: delete own sales_invoice_authors if present by the fixture invoice ID, own sales_invoices, own fx_rates, project and company; delete profile then auth user, then organization. Check every response; afterEach failures must throw, not silently warn. Durable audit events are not deleted merely to erase test evidence; they have no org/actor FK in migration0076. Call cleanup in setup catch as well as afterEach, tolerate unset partial IDs only, and clear retained credentials after disposal. Verify RED/GREEN: `scripts/e2e-local.sh AC-FX-015`; `scripts/check-e2e-isolation.sh`.

### 36 — Real cross-stack user journey (5 min; AC-FX-015)

Complete `e2e/AC-FX-015-jisdor-upload-equivalents.spec.ts`, line1 `// @e2e-isolation: self-isolated — owns a synthetic org and its FX history/documents`. Use the disposable fixtures and real login from36a/36b; no shared seed-org rates or shared document mutations. As real Finance; upload CSV with Friday=16234.56 and Monday=16300 (relative past dates if run clock precedes fixed fixture dates); preview must show2new and no writes yet; confirm, reload,2 rows persist. Open the own USD project with Saturday contract date and read-only invoice fixture with Monday invoice date/outstanding25 from36a; open contract and invoice routes, assert originals plus Friday/Monday publication label and latest outstanding rate. Repeat upload, preview unchanged2, confirm, assert unchanged2 and still2 rows. Cleanup in afterEach/catch through36b's checked fixture helper, including partial failures. This is real UI→repository→DB→UI, not mocked RPC acceptance.

No gate on CI or live external ERP; these read-only invoice fixtures need no edge-function dependency. Use the fixed already-past publication week2026-10-09/12 and intervening contract day2026-10-10 consistently with36a's documents; do not replace the actual rate-date oracle with a presence assertion. Verify RED/GREEN: `scripts/e2e-local.sh AC-FX-015`; `scripts/check-e2e-isolation.sh`. Fixture provisioning and login/cleanup are separate tasks36a/36b, not hidden setup work.

### 37 — Query-plan and regression audit (3 min; supporting AC-FX-003/008/012)

Extend DAL/hook tests to assert at most one onDate request per unique org/pair/date and one shared latest request for twenty outstanding cells. Preserve compatibility tests for shared workbook parser. In pgTAP lookup test add a large synthetic rate series and `EXPLAIN (ANALYZE,BUFFERS)` evidence in builder report for org/pair/date selector and keyset list; small fixtures can legitimately seq-scan, so do not assert the planner's node name in pgTAP. Expected predicates align with the two indexes; no unbounded rate fetches. Verify `V src/lib/db/__tests__/fxRates.test.ts src/hooks/useFxRates.test.tsx src/lib/import/__tests__/parseWorkbook.test.ts`; `D supabase/tests/0288_fx_rate_on.test.sql`.

### 38 — Write-policy mutation proof (4 min; AC-FX-001)

Keep mutation only local, never commit a weakened policy. Direct Executive/PM/Engineer denial assertions must become `not ok`; checking function source or only invoker-denial tests cannot prove the policy. Use this exact command; it weakens only the RLS section (all three role clauses, then the four org clauses), captures output bodies, restores and resets/tests GREEN before releasing the lock. An EXIT trap restores source/schema even on an unexpected failure:

```bash
scripts/with-db-lock.sh bash <<'FX_MUTATION'
set -eu
migration=supabase/migrations/0288_fx_rates_jisdor.sql
saved=$(mktemp)
report=$(mktemp)
cp "$migration" "$saved"
restore() { cp "$saved" "$migration"; supabase db reset; rm -f "$saved" "$report"; }
trap restore EXIT
for kind in role org; do
  cp "$saved" "$migration"
  python3 - "$migration" "$kind" <<'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1]); text=p.read_text()
a=text.index('alter table public.fx_rates enable row level security;')
b=text.index('revoke all on public.fx_rates',a)
section=text[a:b]
old="public.auth_role() in ('Finance','Admin')" if sys.argv[2]=='role' else 'org_id = public.auth_org_id()'
assert section.count(old)==(3 if sys.argv[2]=='role' else 4)
p.write_text(text[:a]+section.replace(old,'true')+text[b:])
PY
  supabase db reset
  supabase test db supabase/tests/0288_fx_rates_rls.test.sql >"$report" 2>&1 || true
  python3 - "$report" <<'PY'
import pathlib,re,sys
body=pathlib.Path(sys.argv[1]).read_text(); print(body)
assert re.search(r'not ok[^\n]*AC-FX-001',body), 'mutation survived or did not exercise its AC'
PY
  cp "$saved" "$migration"
  supabase db reset && supabase test db supabase/tests/0288_fx_rates_rls.test.sql
 done
trap - EXIT
rm -f "$saved" "$report"
FX_MUTATION
```

Review **which direct DML assertion** became RED for each mutant, not merely the existence of a failing assertion. If either mutation survives, strengthen shipped-DML tests; never claim completion with a surviving mutant. Verify final `git diff -- supabase/migrations/0288_fx_rates_jisdor.sql` contains no weakened clause.

### 39 — Portfolio denominator and rendered Discover (4 min coordination; AC-FX-010/011/012/013)

Update `docs/qa-portfolio.md` canonical route list with `/administration/exchange-rates` in the code PR. Add affected cells for FX, `/projects/:id/overview`, `/projects/:id`, `/sales-invoices`, `/sales-invoices/:invoiceId`: action-completeness, state, data-correctness, cross-screen, a11y, mobile390, job-fit. Preserve existing denominator rather than rewrite remembered route counts. Render rich **synthetic** USD/IDR data, en/id × light/dark ×390/1440. Check originals first; labels wrap without hiding Edit/⋯; normalized preview shows separator interpretation; errors/retry reachable; Finance doorway and Admin correction work. Run one open-ended Discover review; each finding must graduate to a test + cell + DESIGN/decision note, then re-render clean. Record evidence in `docs/reviews/2026-10-14-fx-rates-jisdor.md` (no client screenshots/data). Verify new entries: `rg -n 'exchange-rates|AC-FX' docs/qa-portfolio.md docs/reviews/2026-10-14-fx-rates-jisdor.md`. Three code reviews (spec, quality including indexes, security) still required.

### 40 — Final local gate and acceptance evidence (4 min setup; all AC-FX-001..015)

Run from worktree root, capture full output bodies. No suite duplicates on shared Mac, no source/test changes just to turn a red gate green:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'
# Only existing/new touched TS/TSX/JS files, paths relative to app:
git diff --name-only --diff-filter=ACMR origin/dev -- pmo-portal | grep -E '\.(ts|tsx|js|mjs)$' | while IFS= read -r f; do printf '%s\0' "${f#pmo-portal/}"; done | (cd pmo-portal && xargs -0 npx eslint --max-warnings=0)
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev'
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0288_fx_rates_rls.test.sql supabase/tests/0288_fx_rates_write.test.sql supabase/tests/0288_fx_rate_on.test.sql'
scripts/e2e-local.sh AC-FX-015
scripts/check-e2e-isolation.sh
node scripts/check-i18n-completeness.mjs --id
```

Require ≥80% lines on changed code in coverage evidence; targeted coverage command: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev --coverage'`. Include composed axe outcomes (task35), real BI checksum/golden evidence (task21), policy mutation RED/restored GREEN (task38), and complete per-AC matrix. CI verify+pgtap on dev PR and verify+integration on main PR decide merge; local green isn't full-suite proof. Owner retains production/irreversible actions. This planning dispatch may commit docs only, never push/PR; no build is authorized by the existence of this document.

## Bilingual copy contract

Use the following exact key suffixes under `fx` in both `common.json` files; static `t('fx.key','English default')` calls bind each key. Header key `admin.nav.exchangeRates`: Exchange rates / Kurs mata uang.

| fx key | English | Bahasa |
|---|---|---|
| description | USD → IDR · JISDOR · display equivalents only | USD → IDR · JISDOR · hanya perkiraan tampilan |
| upload | Upload rates | Unggah kurs |
| newRate | New rate | Kurs baru |
| editRate | Edit rate | Edit kurs |
| date | Publication date | Tanggal publikasi |
| rate | IDR per USD | IDR per USD |
| source | Source | Sumber |
| chooseFile | Choose BI Excel or date,rate CSV | Pilih Excel BI atau CSV date,rate |
| parsing | Reading rates… | Membaca kurs… |
| newCount | {{count}} new | {{count}} baru |
| changedCount | {{count}} changed | {{count}} berubah |
| unchangedCount | {{count}} unchanged | {{count}} tidak berubah |
| duplicates | {{count}} identical duplicates ignored | {{count}} duplikat identik diabaikan |
| rejected | Row {{row}}: {{reason}} | Baris {{row}}: {{reason}} |
| confirmUpload | Save these JISDOR rates? | Simpan kurs JISDOR ini? |
| saveRates | Save rates | Simpan kurs |
| overwrite | Replace the rate for {{date}}? | Ganti kurs untuk {{date}}? |
| overwriteValues | {{old}} → {{new}} IDR per USD | {{old}} → {{new}} IDR per USD |
| saved | Rates saved: {{new}} new, {{changed}} changed, {{unchanged}} unchanged. | Kurs disimpan: {{new}} baru, {{changed}} berubah, {{unchanged}} tidak berubah. |
| empty | No JISDOR rates yet | Belum ada kurs JISDOR |
| emptyBody | Upload BI's JISDOR history to show rupiah equivalents. | Unggah riwayat JISDOR BI untuk menampilkan perkiraan rupiah. |
| loadError | Could not load exchange rates | Tidak dapat memuat kurs |
| retry | Retry | Coba lagi |
| previous | Previous | Sebelumnya |
| next | Next | Berikutnya |
| loading | Loading equivalent… | Memuat perkiraan… |
| noRate | no rate for {{date}} | tidak ada kurs untuk {{date}} |
| missingDate | No equivalent: document date is missing. | Tidak ada perkiraan: tanggal dokumen belum tersedia. |
| unsupportedPair | No equivalent: {{base}}/{{quote}} is not supported. | Tidak ada perkiraan: {{base}}/{{quote}} belum didukung. |
| lookupError | Could not load the equivalent. | Tidak dapat memuat perkiraan. |
| orgCurrencyError | Could not resolve the organization currency. | Tidak dapat menentukan mata uang organisasi. |
| invalidDate | Enter a valid publication date. | Masukkan tanggal publikasi yang valid. |
| futureDate | Publication date cannot be in the future. | Tanggal publikasi tidak boleh di masa depan. |
| invalidRate | Enter a rate from 1,000 to 100,000 with at most six decimal places; check separators. | Masukkan kurs 1.000–100.000 dengan maksimal enam desimal; periksa pemisah angka. |
| duplicateDate | Different rates occur for this date; correct the file. | Ada kurs berbeda untuk tanggal ini; perbaiki berkas. |
| ambiguousHeader | Could not identify one date column and one rate column. | Tidak dapat menentukan satu kolom tanggal dan satu kolom kurs. |
| formula | Formula cells are not accepted. | Sel rumus tidak diterima. |
| unsupportedFile | Choose a supported BI workbook or date,rate CSV. | Pilih buku kerja BI yang didukung atau CSV date,rate. |
| fileTooLarge | File exceeds 5 MiB. | Berkas melebihi 5 MiB. |
| tooManyRows | Import at most 500 rows at a time. | Impor maksimal 500 baris sekaligus. |
| emptyFile | The file contains no rate rows. | Berkas tidak berisi baris kurs. |
| invalidCsv | CSV quoting or columns are invalid. | Kutipan atau kolom CSV tidak valid. |
| fixRejected | Correct rejected rows and upload again; nothing has been saved. | Perbaiki baris yang ditolak dan unggah kembali; belum ada yang disimpan. |
| denied | Exchange rates are available to Finance and Admin. | Kurs mata uang tersedia untuk Finance dan Admin. |

Map shared ImportParseError `not_xlsx`, `empty`, `too_many_rows` to `unsupportedFile`, `emptyFile`, `tooManyRows`; CSV decoder to invalidCsv. Do not render machine reason keys. Reuse existing dialog Cancel/Continue/error-classifier copy where appropriate; no new duplicate global key.

## Canonical ownership and task coverage

The spec's traceability table is authoritative. This table binds every behavior task to it:

| Task | AC-FX coverage |
|---|---|
| 01,02,05,06 | 002 |
| 03,04 | 001 |
| 07,08 | 003 |
| 09,10 | 001,002 |
| 11 | 001,002,003 (reversal/types support) |
| 12 | 007,008; 003 supporting DAL |
| 13 | 007,008 |
| 14 | 004 |
| 15 | 005 |
| 16 | 006 |
| 17,18,19 | 005,006 |
| 20 | 006 |
| 21 | 014 |
| 22 | 007 |
| 23 | 009,010 |
| 24 | 010,013 |
| 25 | 010 |
| 26 | 008 |
| 27,28 | 009 |
| 29,30 | 007 |
| 31,32 | 004 |
| 33 | 011 |
| 34 | 012 |
| 35 | 013 |
| 36a,36b | 015 (fixture/auth support) |
| 36 | 015 |
| 37 | 003,008,012 (performance support) |
| 38 | 001 (mutation proof) |
| 39 | 010,011,012,013 (rendered portfolio support) |
| 40 | 001–015 (gate evidence) |

## Director handoff / remaining dependency

No product ruling is open. The **real public BI export** is the one external prerequisite; AC-FX-014 stays unproven until it arrives. Review engineering bounds (1,000–100,000; 5 MiB), and preserve Admin-only manual correction while Finance/Admin upload/database write. A legacy-format decoder conflict is an escalation, never permission to change packages. The Director decides build executor before any implementation; this plan does not dispatch a builder, push, open a PR or deploy.
