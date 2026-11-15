# Plan — purchase capture B2: split one ERP supplier invoice across several projects (#2195)

Spec: `docs/specs/capture-split-invoices.spec.md` · Base: B1 (migration 0882) merged to `dev` first · Tier: **money
path** — ships alone, Director-dispatched, three reviewers (security-auditor at full depth on the RPCs and grants).

**Migration number: `NNNN`.** The coordinator assigns it at build start (`scripts/renumber-migration.sh` if it
collides). Every `NNNN` below — file names, `-- NNNN` line markers, the rollback harness — takes that number.

## Design

B2 reuses B1's whole path and adds one decision kind. Nothing new on the ERP side.

```
pmo purchases assign file.json ──► purchase-capture (action: assign) ──► assign_capture_invoices(rows, revision, dry_run, ledger_scale)
                                     │ reads ERP precision once, read only,                │ fence → actor → binding → revision → feed
                                     │ only when a row is a split                          ▼
                                                                                  capture_assignment_row (per row, source order)
                                                                                    claim (B1, digest now covers splits)
                                                                                    validate (B1 checks + split checks)
                                                                                    split: decision + lines
                                                                                    project / set_aside: B1, unchanged
reads: cost_attribution_allocations ─ union ─ capture_assigned_gl ─ union ─ capture_split_gl (MR-3 over live eligible ledger rows)
       cost_attribution_engine ledger CTE: B1's voucher anti-join, now for decision in ('project','split')
```

Decisions (each answers a spec owner question at its default):

1. **Shares are worked out on every read, never stored.** The ledger mirror deletes and re-creates a voucher's rows
   when the ERP reposts it (`0382_ledger_voucher_replace.sql`) and upserts amounts in place, so stored per-row pieces
   would either block the mirror writer (a foreign key) or go stale. MR-3 is written as one plain-SQL function
   (`capture_split_gl`) — floors, a leftover rank and one residual per line, all window functions — so it stays inlinable
   (NFR-002) and always reflects the current ledger.
2. **The split owns the whole voucher**, like B1: the engine's existing voucher anti-join is widened to
   `decision in ('project','split')`; a row that becomes eligible later is shared by the stated proportions (Q6), and
   the report flags `split_basis_changed`.
3. **No wrapper purchase** (Q1): `procurement_erp_links` allows one purchase per document, and a lead-project
   purchase would misstate that project. Undo is its own RPC, `undo_capture_invoice_split`.
4. **Scale from the ERP** (Q5): the route already holds `adapter.precision`; it passes `p_ledger_scale`. A direct RPC
   call without a scale is refused for split rows (`ledger_scale_required`). A scale too small fails MR-1 on the ledger
   rows themselves; a scale too large only makes shares finer, sums stay exact.

Why MR-3 is exact: per row, floors plus the leftover units sum to the row by construction; each line's residual
`t_i − Σ shares` is added to one row (the largest), and the residuals sum to `Σ t_i − T = 0`, so that row still sums
exactly and every line now sums to `t_i`. A 200 000-case randomized check (rows to 6000 units, credits included, 2–6
lines) found no inexact result; with MR-3a's `n²` floor a further 300 000 cases found no negative share on a debit row.
Task 7 keeps a pgTAP version of the property.

## Files

| Path | Change |
|---|---|
| `supabase/migrations/NNNN_capture_invoice_split.sql` | new |
| `supabase/migrations/rollback/NNNN_capture_invoice_split_down.sql` | new |
| `supabase/tests/2195_b2_split_assignment.test.sql` | new — validation, record, replay, immutability, roles |
| `supabase/tests/2195_b2_split_ledger.test.sql` | new — apportionment, no double count, ERP precedence, basis change, repost |
| `supabase/tests/2195_b2_split_undo.test.sql` | new |
| `supabase/tests/2195_b2_split_performance.test.sql` | new |
| `scripts/2195-b2-rollback.test.sql`, `scripts/test-2195-b2-rollback.sh` | new (copy of the B1 harness) |
| `.github/workflows/ci.yml` | one step, after the B1 rollback step |
| `supabase/tests/0137_service_role_grants.test.sql`, `supabase/tests/api_client_request_guard.test.sql`, `supabase/tests/postgrest_embed_ambiguity_guard.test.sql` | new tables / RPC added to the lists |
| `scripts/isolation-probe.sh`, `scripts/isolation-probe-denominator.json` | the new table |
| `supabase/functions/purchase-capture/index.ts`, `index.test.ts` | split rows: precision read + `p_ledger_scale` |
| `scripts/lib/pmo-capture.mjs`, `scripts/pmo-capture.test.mjs`, `scripts/pmo.mjs`, `scripts/pmo.test.mjs` | CLI |
| `docs/runbooks/pmo-cli.md`, `docs/glossary.md`, `docs/money-path-primer.md` | docs |

## Tasks (each 2–5 minutes; red → green → commit)

Run every DB command from the repo root under the lock, reset and test in **one** hold:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`.

### T1 — red: the split tables exist and are immutable (AC-014)
Create `supabase/tests/2195_b2_split_assignment.test.sql` with B1's fixture header (copy lines 1–40 of
`supabase/tests/2195_b1_assignment.test.sql`, ids prefixed `21952001-`) and:
```sql
select has_table('public','erp_capture_invoice_split_lines','AC-014 split lines table');
select col_not_null('public','erp_capture_invoice_split_lines','amount_minor','AC-014 a line has an amount');
```
Verify red: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_b2_split_assignment.test.sql'` → fails on `has_table`.

### T2 — green: table, guard, RLS
`supabase/migrations/NNNN_capture_invoice_split.sql` §1:
```sql
-- NNNN #2195 B2: one ERP supplier invoice split across several PMO projects. Nothing here writes to the ERP.
-- Rollback: supabase/migrations/rollback/NNNN_capture_invoice_split_down.sql
alter table public.erp_capture_invoice_assignments drop constraint erp_capture_invoice_assignments_decision_check;
alter table public.erp_capture_invoice_assignments add constraint erp_capture_invoice_assignments_decision_check
  check (decision in ('project','set_aside','split'));
alter table public.erp_capture_invoice_assignments add column ledger_scale smallint
  check (ledger_scale between 0 and 4);
alter table public.erp_capture_invoice_assignments add constraint erp_capture_invoice_assignments_split_shape
  check ((decision = 'split') = (ledger_scale is not null));

create table public.erp_capture_invoice_split_lines (
  decision_id uuid not null references public.erp_capture_invoice_assignments(id),
  org_id uuid not null references public.organizations(id),
  ordinal smallint not null check (ordinal between 1 and 20),
  project_id uuid not null references public.projects(id),
  amount_minor bigint not null check (amount_minor > 0),
  primary key (decision_id, ordinal),
  unique (decision_id, project_id)
);
create index erp_capture_split_lines_project_idx on public.erp_capture_invoice_split_lines (org_id, project_id);

create function public.guard_capture_split_rows() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  raise exception 'assignment_decision_immutable' using errcode = '55000';
end $$;
create trigger erp_capture_invoice_split_lines_immutable before update or delete on public.erp_capture_invoice_split_lines
  for each row execute function public.guard_capture_split_rows();
create trigger capture_census_fence before insert or update or delete on public.erp_capture_invoice_split_lines
  for each row execute function public.fence_capture_source_change();

alter table public.erp_capture_invoice_split_lines enable row level security;
alter table public.erp_capture_invoice_split_lines force row level security;
create policy erp_capture_invoice_split_lines_select on public.erp_capture_invoice_split_lines for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.erp_capture_invoice_split_lines from public, anon, authenticated, service_role;
grant select on public.erp_capture_invoice_split_lines to authenticated;
```
Check the real name of the 0882 decision check first: `grep -n "decision text not null check" supabase/migrations/0882_capture_invoice_assignment.sql`
(an inline check is auto-named `erp_capture_invoice_assignments_decision_check`; confirm with
`psql "$PMO_DB_URL" -Atc "select conname from pg_constraint where conrelid='public.erp_capture_invoice_assignments'::regclass"`).
Add to the T1 test: an update and a delete of a seeded line each `throws_ok(..., '55000', 'assignment_decision_immutable', 'AC-014 …')`.
Verify green: same command as T1. Commit `Add the split decision lines (#2195)`.

### T3 — red: row shape refusals (AC-010)
Append to `2195_b2_split_assignment.test.sql`, each as `throws_ok($$ select assign_capture_invoices(<rows>, 'r', true, 2) $$, '22023', 'invalid_assignment_row', 'AC-010 <case>')`:
one line; two lines with the same project; 21 lines; amount `"0"`; amount `-1`; amount as a JSON number; `project_id`
on a split row; `allow_capital_as_overhead` on a split row; an unknown key inside a line. Plus a project of another
organization → result row `outcome = 'not_found'`. Verify red.

### T4 — green: `assign_capture_invoices` accepts split rows
In the migration, `drop function public.assign_capture_invoices(jsonb,text,boolean);` and recreate it from 0882's body
with these changes, each line marked `-- NNNN`: new parameter `p_ledger_scale integer default null`; `'splits'` added
to the allowed keys; `'split'` to the decisions; and this extra clause in the row check:
```sql
       or (v_row->>'decision' = 'split' and (v_row ? 'project_id' or v_row ? 'allow_capital_as_overhead'
            or jsonb_typeof(v_row->'splits') is distinct from 'array' or jsonb_array_length(v_row->'splits') not between 2 and 20
            or exists (select 1 from jsonb_array_elements(v_row->'splits') s
                        where jsonb_typeof(s) <> 'object'
                           or exists (select 1 from jsonb_object_keys(s) k where k not in ('project_id','amount'))
                           or coalesce(s->>'project_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           or jsonb_typeof(s->'amount') is distinct from 'string'
                           or s->>'amount' !~ '^[0-9]+(\.[0-9]+)?$' or (s->>'amount')::numeric <= 0)
            or (select count(distinct lower(s->>'project_id')) from jsonb_array_elements(v_row->'splits') s) <> jsonb_array_length(v_row->'splits')))  -- NNNN
       or (v_row ? 'splits' and v_row->>'decision' <> 'split')                                                                                     -- NNNN
```
The normalised row carries `'splits', (select jsonb_agg(jsonb_build_object('project_id',lower(s->>'project_id'),'amount',s->>'amount') order by o) from jsonb_array_elements(v_row->'splits') with ordinality x(s,o))`
(so line order is the ordinal) and `'ledger_scale', p_ledger_scale`. Before the row loop:
```sql
  if exists (select 1 from jsonb_array_elements(v_norm) r where r->>'decision' = 'split')
     and (p_ledger_scale is null or p_ledger_scale not between 0 and 4) then                       -- NNNN
    return jsonb_build_object('complete',false,'reason','ledger_scale_required','results','[]'::jsonb,'erp_write',false);
  end if;
```
Grant: `revoke all on function public.assign_capture_invoices(jsonb,text,boolean,integer) from public, anon; grant execute … to authenticated;`.
Verify green.

### T5 — red: claim digest and replay (AC-008, AC-009)
Tests: apply a split (seeded B1 fixture, placeable total 1000.00, scale 2), resend → `outcome = 'skip'`; resend with
one amount changed → `reason = 'request_conflict'`; a split for an invoice with an active B1 `project` decision →
`source_already_decided`. Verify red (the digest ignores splits; the claim's insert lacks `ledger_scale`).

### T6 — green: claim
Recreate `capture_assignment_claim` from 0882 with marked changes: the digest object gains
`'splits', p_row->'splits'`; the insert gains `ledger_scale` = `case when v_decision = 'split' then (p_row->>'ledger_scale')::smallint end`
and `project_id` stays null for split (the 0882 shape check `(decision = 'project') = (project_id is not null)` already
allows it); the supersede-set-aside update runs for `v_decision in ('project','split') and v_accept`. Verify green.

### T7 — red: apportionment exactness (AC-003, AC-004)
Create `supabase/tests/2195_b2_split_ledger.test.sql` (fixture from `2195_b1_ledger.test.sql` lines 1–55, prefix
`21952002-`). Seed decisions and lines directly as owner (as B1's `pg_temp.assign` does), then read the internal function:
```sql
-- INV-S1: Cost 700.00, Fuel 300.00, split A 500.00 / B 500.00 (scale 2)
select results_eq($$ select project_id, account, sum(amount) from public.capture_split_gl('21952002-0000-0000-0000-000000000001')
                      where gl_id in (select id from erp_gl_entry_mirror where voucher_no = 'INV-S1') group by 1,2 order by 1,2 $$,
  $$ values ('21952002-0000-0000-0000-00000000000a'::uuid,'Cost',350.00::numeric),('21952002-0000-0000-0000-00000000000a'::uuid,'Fuel',150.00),
            ('21952002-0000-0000-0000-00000000000b'::uuid,'Cost',350.00),('21952002-0000-0000-0000-00000000000b'::uuid,'Fuel',150.00) $$,
  'AC-003 each project gets the invoice''s mix of accounts');
```
INV-S2: three Cost rows of 0.01 split A 0.01 / B 0.02 → per-row sums 0.01, per-line sums 0.01 and 0.02, `min(amount) >= 0`
(AC-004; seeded directly, below MR-3a's floor, to pin the arithmetic). Property case: a `do` block with
`perform setseed(0.2195)` seeds 200 vouchers of 1–8 random rows (some credits) with 2–6 lines, then one
`is(…, 0::bigint, 'AC-004 every row and line is exact')` over the count of vouchers where a row's shares, a line's shares,
or the voucher's shares do not sum exactly. Verify red (`capture_split_gl` does not exist).

### T8 — green: `capture_split_gl` (MR-3, read time)
```sql
-- MR-3 on every read: shares of the current eligible ledger rows of each active split, by the stated proportions.
-- No SET clause, so it inlines into the reading query (every name schema-qualified). Internal: run as owner by the wrappers.
create function public.capture_split_gl(p_org_id uuid, p_project_id uuid default null)
returns table(gl_id uuid, project_id uuid, account text, fiscal_year text, posting_date date, party_type text, amount numeric, as_of timestamptz)
language sql stable as $$
  with split as materialized (
    select a.id, a.org_id, a.source_voucher_type as vt, a.source_voucher_no as vn, a.source_company as co, a.ledger_scale as sc
      from public.erp_capture_invoice_assignments a
     where a.org_id = p_org_id and a.undone_at is null and a.decision = 'split'
       and (p_project_id is null or exists (select 1 from public.erp_capture_invoice_split_lines l
                                             where l.decision_id = a.id and l.project_id = p_project_id))
       -- MR-5: an ERP project tag on any current row of the voucher wins; the split places nothing
       and not exists (select 1 from public.erp_gl_entry_mirror t where t.org_id = a.org_id and t.voucher_type = a.source_voucher_type
                        and t.voucher_no = a.source_voucher_no and t.company is not distinct from a.source_company
                        and not t.is_cancelled and coalesce(t.project, '') <> '')
  ), r as materialized (
    select s.id as decision_id, s.sc, g.id as gl_id, g.erp_name, g.account, g.fiscal_year, g.posting_date, g.party_type, g.as_of,
           round((coalesce(g.debit,0) - coalesce(g.credit,0)) * power(10::numeric, s.sc)) as a
      from split s
      join public.erp_gl_entry_mirror g on g.org_id = s.org_id and g.voucher_type = s.vt and g.voucher_no = s.vn and g.company is not distinct from s.co
     where coalesce(g.project, '') = '' and not g.is_cancelled
       and exists (select 1 from public.erp_account_mirror m where m.org_id = g.org_id and m.company = g.company and m.erp_name = g.account
                    and not m.is_group and m.root_type = 'Expense')
       and exists (select 1 from public.budget_category_account_map b where b.org_id = g.org_id and b.erp_account = g.account)
  ), tot as (
    select decision_id, sum(a) as t from r group by decision_id
  ), tg as (                                   -- line targets: the stated amounts, rescaled to the current total (exact when T = W)
    select l.decision_id, l.ordinal, l.project_id, tot.t,
           floor(tot.t * sum(l.amount_minor) over w / sum(l.amount_minor) over (partition by l.decision_id))
         - floor(tot.t * (sum(l.amount_minor) over w - l.amount_minor) / sum(l.amount_minor) over (partition by l.decision_id)) as target
      from public.erp_capture_invoice_split_lines l
      join tot on tot.decision_id = l.decision_id and tot.t > 0      -- a total at or below zero places nothing (flagged by the report)
    window w as (partition by l.decision_id order by l.ordinal)
  ), cell as (
    select r.*, tg.ordinal, tg.project_id, tg.target,
           floor(r.a * tg.target / tg.t) as fl,
           r.a * tg.target - floor(r.a * tg.target / tg.t) * tg.t as rem
      from r join tg on tg.decision_id = r.decision_id
  ), ranked as (
    select c.*,
           row_number() over (partition by c.decision_id, c.gl_id order by c.rem desc, c.ordinal) as rk,
           c.a - sum(c.fl) over (partition by c.decision_id, c.gl_id) as leftover,
           row_number() over (partition by c.decision_id, c.ordinal order by abs(c.a) desc, c.erp_name, c.gl_id) as size_rank
      from cell c
  ), base as (
    select x.*, x.fl + case when x.rk <= x.leftover then 1 else 0 end as share from ranked x
  ), fixed as (                                -- each line's residual lands on its share of the largest row
    select b.*, b.share + case when b.size_rank = 1 then b.target - sum(b.share) over (partition by b.decision_id, b.ordinal) else 0 end as minor
      from base b
  )
  select f.gl_id, f.project_id, f.account, f.fiscal_year, f.posting_date, f.party_type, f.minor / power(10::numeric, f.sc), f.as_of
    from fixed f
   where p_project_id is null or f.project_id = p_project_id
$$;
revoke execute on function public.capture_split_gl(uuid, uuid) from public, anon, authenticated, service_role;
```
The project filter is applied last on purpose: targets need every line of the decision. Verify green (T7 file).

### T9 — red: total and scale refusals (AC-002, AC-011)
In `2195_b2_split_assignment.test.sql`: lines 600.00 + 399.99 → `reason = 'split_total_mismatch'`,
`placeable_total = '1000.00'`, `stated_total = '999.99'`; amount `"600.001"` at scale 2 → `split_amount_scale`; a Cost
row of 100.005 → `ledger_amount_not_minor`; no `p_ledger_scale` → `complete = false, reason = 'ledger_scale_required'`;
capital-only invoice → `capital_spending_not_assignable`. Verify red.

### T10 — green: validate + row
`capture_assignment_validate` (recreated from 0882, marked lines; declare `v_scale integer; v_stated numeric; v_rows integer;`): `v_decision in ('project','split')` wherever 0882 tests
`v_decision = 'project'`; then, for split only, before the return:
```sql
  if v_decision = 'split' then                                                                                        -- NNNN
    v_scale := (p_row->>'ledger_scale')::integer;                                                                     -- NNNN
    if exists (select 1 from public.erp_gl_entry_mirror g
                where g.org_id = p_org and g.voucher_type = v_doc.erp_doctype and g.voucher_no = v_doc.erp_name and not g.is_cancelled
                  and ((coalesce(g.debit,0) - coalesce(g.credit,0)) * power(10::numeric, v_scale)) % 1 <> 0) then        -- NNNN
      return jsonb_build_object('ok',false,'reason','ledger_amount_not_minor');                                       -- NNNN
    end if;                                                                                                           -- NNNN
    if exists (select 1 from jsonb_array_elements(p_row->'splits') s where ((s->>'amount')::numeric * power(10::numeric, v_scale)) % 1 <> 0) then  -- NNNN
      return jsonb_build_object('ok',false,'reason','split_amount_scale');                                            -- NNNN
    end if;                                                                                                           -- NNNN
    select sum((s->>'amount')::numeric) into v_stated from jsonb_array_elements(p_row->'splits') s;                   -- NNNN
    select count(*) into v_rows from public.erp_gl_entry_mirror g                                                  -- NNNN: MR-3a
     where g.org_id = p_org and g.voucher_type = v_doc.erp_doctype and g.voucher_no = v_doc.erp_name and not g.is_cancelled
       and g.account in (select erp_account from public.budget_category_account_map where org_id = p_org);           -- NNNN
    if exists (select 1 from jsonb_array_elements(p_row->'splits') s
                where round((s->>'amount')::numeric * power(10::numeric, v_scale)) < v_rows * v_rows) then              -- NNNN
      return jsonb_build_object('ok',false,'reason','split_line_too_small');                                          -- NNNN
    end if;                                                                                                           -- NNNN
    if v_stated <> v_mapped then                                                                                      -- NNNN
      return jsonb_build_object('ok',false,'reason','split_total_mismatch',                                           -- NNNN
        'placeable_total',to_char(v_mapped,'FM999999999999990.' || repeat('0',v_scale)),                              -- NNNN
        'stated_total',to_char(v_stated,'FM999999999999990.' || repeat('0',v_scale)));                                -- NNNN
    end if;                                                                                                           -- NNNN
  end if;                                                                                                             -- NNNN
```
(For scale 0 use `'FM999999999999990'`; wrap the format in a `case`.) `capture_assignment_row`: a `split` branch that
inserts the lines from `p_row->'splits'` (`amount_minor = round(amount × 10^scale)`), writes `log_audit('procurement.erp_split', …)` with lines, `mapped_amount`, `excluded`,
`prior_placement`, `clears_mark`, `erp_write: false`, clears the set-aside mark exactly as the `project` branch's
linker path does when `accept_set_aside`, and returns per line `{project_id, amount, by_account}` read from `capture_split_gl` inside the same
(sub)transaction, so a preview shows exactly what an apply will place.
The `PFE02` refusal path also returns `placeable_total` / `stated_total` when present. Verify green (both test files).

### T11 — red: ledger placement and no double count (AC-001, AC-005, AC-006, AC-015)
In `2195_b2_split_ledger.test.sql`, through `project_mapped_actuals` and `cost_attribution_org_actuals` (as in B1's
ledger test, `pg_temp.act`): before/after a split of INV-L1 (Cost 1000 under a rule to C) A 600 / B 400 →
A +600, B +400, C −1000, org total unchanged (`AC-005`); A and B reads equal stated amounts (`AC-001`); tag one GL row
of the voucher with a project → A and B lose it, C and the tag path regain it, org total unchanged (`AC-006`); map a
new account and add an untagged row of 50 → A 630, B 420, org total +50, C unchanged (`AC-015`); replace the
voucher's rows through `replace_erp_gl_voucher_rows` (0382) with new names and the same amounts → A and B unchanged, no
error (`AC-019`).
Verify red.

### T12 — green: read path
Recreate `cost_attribution_allocations` from 0882 with one more marked branch:
```sql
  union all                          -- NNNN: invoices an Admin split across projects, shared from the live ledger (never a draft or preview)
  select g.gl_id, null::uuid, null::uuid, g.project_id, g.account, g.fiscal_year, g.posting_date, g.party_type, g.amount, g.as_of
    from public.capture_split_gl(p_org_id, p_project_id) g
   where p_draft is null and p_exclude_rule_key is null and p_equipment_draft is null
```
Recreate `cost_attribution_engine` from 0882 changing only its 0882 anti-join line
`where x.org_id = p_org_id and x.undone_at is null and x.decision = 'project'` to
`… and x.decision in ('project','split')   -- NNNN`. Recreate `cost_attribution_org_actuals` /
`cost_attribution_project_actuals`: the 0882 fast-exit `x.decision = 'project'` becomes `x.decision in ('project','split')`
(marked). Replace the partial index so the widened predicate is served:
```sql
create index erp_capture_assignment_active_placed_voucher_idx
  on public.erp_capture_invoice_assignments (org_id, source_voucher_type, source_voucher_no)
  where undone_at is null and decision in ('project','split');
drop index public.erp_capture_assignment_active_voucher_idx;
```
Verify green (T11 + B1's `2195_b1_ledger.test.sql` unchanged).

### T13 — red→green: revision (AC-012)
Test: preview → record a split in a second session-equivalent (direct insert as owner) → apply with the preview
revision → `reason = 'source_stale'`. Green: recreate `capture_revision` from 0882 with one marked section after the
assignments section: `coalesce((select string_agg(to_jsonb(l)::text, E'\n' order by l.decision_id, l.ordinal) from public.erp_capture_invoice_split_lines l where l.org_id = p_org), '')`.

### T14 — red→green: undo (AC-007)
Create `supabase/tests/2195_b2_split_undo.test.sql` (fixture from `2195_b1_undo.test.sql`): undo restores actuals to
`prior_placement`, restores the overhead mark, second call → `outcome = 'skip', reason = 'already_undone'`, a changed
mark → `assignment_mark_changed`, non-Admin → `42501`, empty reason → `reason_required`. Green:
`undo_capture_invoice_split(p_decision_id uuid, p_reason text, p_dry_run boolean default false)` — security definer;
active-Admin check and `assert_feature_on(v_org,'procurement')` as in `assign_capture_invoices`; capture fence
(exclusive) first, then `for update` on the decision and the mark; mark check and restore copied from 0882's
`undo_captured_purchase`; audit `procurement.erp_split_undo` with `placement_before` (sum of `capture_split_gl` per
project, read before the undo) and `placement_after` (`prior_placement`). Grant execute to authenticated only.

### T15 — red→green: report (FR-015)
In the ledger test: `purchase_capture_assignment_report()` lists the split with `lines: [{project_id, stated, placed}]`
and `split_basis_changed: false`; after cancelling one of its GL rows, `true`. Green: recreate the report from 0882;
add a marked `'lines'` key computed from `capture_split_gl` grouped by project, and
`'split_basis_changed', placed_total <> stated_total` for split rows.

### T16 — red→green: roles and grants (AC-013)
In `2195_b2_split_assignment.test.sql`: Finance / PM / Executive calling `assign_capture_invoices` with a split row and
`undo_capture_invoice_split` → `42501`; they can select their own org's split lines, not another org's. Update
`supabase/tests/0137_service_role_grants.test.sql` (the new table has no service-role grant),
`supabase/tests/api_client_request_guard.test.sql` and the guard itself: recreate `api_client_request_guard` from 0882
with `'undo_capture_invoice_split'` appended to `capture_assign_rpcs` (marked `-- NNNN`). Add the table to
`supabase/tests/postgrest_embed_ambiguity_guard.test.sql` and `scripts/isolation-probe.sh` +
`scripts/isolation-probe-denominator.json` (copy B1's entry). Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_b2_split_assignment.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/api_client_request_guard.test.sql supabase/tests/postgrest_embed_ambiguity_guard.test.sql'`.

### T17 — performance (NFR-001)
`supabase/tests/2195_b2_split_performance.test.sql` from `2195_b1_performance.test.sql`: 250 split rows + 250 project
rows in one preview call read `cost_attribution_allocations` once (B1's `pg_stat_user_functions` counter check), and
`explain (format json)` of `cost_attribution_project_actuals` shows no `capture_split_gl` function scan (inlined)
and an index scan on `erp_capture_assignment_active_placed_voucher_idx`.

### T18 — rollback (AC-018, NFR-003)
`supabase/migrations/rollback/NNNN_capture_invoice_split_down.sql`: restore the 0882 bodies of every replaced function
verbatim (`assign_capture_invoices` with its 0882 signature and grants, `capture_assignment_claim`,
`capture_assignment_validate`, `capture_assignment_row`, `capture_revision`, `cost_attribution_engine`,
`cost_attribution_allocations`, `cost_attribution_org_actuals`, `cost_attribution_project_actuals`,
`purchase_capture_assignment_report`, `api_client_request_guard`); drop `capture_split_gl`, `undo_capture_invoice_split`, `guard_capture_split_rows`, the lines table, the column and
constraints; recreate `erp_capture_assignment_active_voucher_idx` and drop the widened index; restore the 0882 decision check. Refuse the down (`raise exception 'active_split_decisions'`) while any
active split exists. Copy `scripts/test-2195-b1-rollback.sh` → `scripts/test-2195-b2-rollback.sh` and
`scripts/2195-b1-rollback.test.sql` → `scripts/2195-b2-rollback.test.sql`, replacing `0882` with `NNNN`, the source
migration of every body with `0882_capture_invoice_assignment.sql`, and the expected recorded-function count with 11.
Add to `.github/workflows/ci.yml` after the B1 step:
```yaml
      # Resets to the migration before NNNN to record the replaced function bodies, then back to head.
      - name: Split assignment rollback harness
        run: scripts/with-db-lock.sh scripts/test-2195-b2-rollback.sh
```
Verify: `scripts/with-db-lock.sh scripts/test-2195-b2-rollback.sh`.

### T19 — red→green: edge route (AC-017)
`supabase/functions/purchase-capture/index.test.ts` (import the shipped handler, mock `globalThis.fetch`, as B1's tests
do): an assign batch with a split row → one precision read for `supplier_invoice`, the RPC body carries
`p_ledger_scale: 2`; a batch without split rows → no ERP call and `p_ledger_scale` absent; a failed precision read →
409 `{ complete: false, missing: ['precision_unavailable'], erp_write: false }`. Green in `index.ts`:
```ts
  const hasSplit = body.action === 'assign' && (body.rows as Array<{ decision?: unknown }>).some(row => row?.decision === 'split');
  const adapter = await captureAdapterForOrg(binding.external_tier, service, profile.org_id, config, { erpCalls: body.action !== 'assign' || hasSplit });
  // …inside the assign branch, before the RPC:
  let ledgerScale: number | undefined;
  if (hasSplit) {
    const read = await adapter.precision.read(adapter.company, 'supplier_invoice');
    if (!read.ok) return json({ complete: false, missing: ['precision_unavailable'], erp_write: false }, 409);
    ledgerScale = read.scale;
  }
  const { data, error } = await caller.rpc('assign_capture_invoices', { p_rows: body.rows, p_expected_revision: body.expectedRevision,
    p_dry_run: body.dryRun, ...(ledgerScale === undefined ? {} : { p_ledger_scale: ledgerScale }) });
```
Verify: `cd supabase/functions/purchase-capture && deno test --allow-env --allow-net index.test.ts` and
`node scripts/check-edge-fn-test-binding.mjs`.

### T20 — red→green: CLI checks and output (AC-016)
`scripts/pmo-capture.test.mjs`: `assignmentProblems` refuses a split with one line, a repeated project, an amount that
is a number or `"1.2.3"`, `project_id` on the row; accepts a two-line split. `formatAssignmentResults` prints
`placement: { lines: [{ project_id, amount, by_account }], currency, … }` and `next` = the apply command. Green in
`scripts/lib/pmo-capture.mjs`: add `'splits'` to `ASSIGN_KEYS`, `'split'` to the decisions, and
```js
    if (row.decision === 'split') {
      const lines = Array.isArray(row.splits) ? row.splits : null;
      if (!lines || lines.length < 2 || lines.length > 20) problems.push(`${at}: a split needs 2 to 20 lines in splits`);
      else {
        const seen = new Set();
        lines.forEach((line, j) => {
          if (!UUID_RE.test(String(line?.project_id ?? ''))) problems.push(`${at} line ${j + 1}: project_id must be a UUID`);
          if (typeof line?.amount !== 'string' || !/^[0-9]+(\.[0-9]+)?$/.test(line.amount) || Number(line.amount) <= 0)
            problems.push(`${at} line ${j + 1}: amount must be a positive decimal string, e.g. "600.00"`);
          const key = String(line?.project_id ?? '').toLowerCase();
          if (seen.has(key)) problems.push(`${at} line ${j + 1}: project repeats an earlier line`);
          seen.add(key);
        });
      }
      if ('project_id' in row) problems.push(`${at}: a split takes its projects in splits, not project_id`);
    } else if ('splits' in row) problems.push(`${at}: splits goes only with decision "split"`);
```
and a `split_total_mismatch` `next` line that prints both totals. Verify: `node --test scripts/pmo-capture.test.mjs`.

### T21 — red→green: `pmo purchases undo-split`
`scripts/pmo.test.mjs`: usage error without a UUID or `--reason`; calls `POST /rest/v1/rpc/undo_capture_invoice_split`
with `{ p_decision_id, p_reason, p_dry_run }`; exit 2 on a refusal. Green in `scripts/pmo.mjs` beside `undo-record-only`
(same shape) plus the usage line
`pmo purchases undo-split <decision> --reason <text> [--dry-run]   (Admin: undo one split; nothing is written to the ERP)`.
Verify: `node --test scripts/pmo.test.mjs`.

### T22 — docs
`docs/runbooks/pmo-cli.md`: under `purchases assign`, a "Split one invoice across projects" subsection — the row shape,
`split_total_mismatch` (copy the printed `placeable_total`), proportional shares, `split_basis_changed`, undo-split.
`docs/glossary.md`: the four terms from the spec. `docs/money-path-primer.md` "Where things live": one row for
`capture_split_gl` (MR-3, shares worked out on every read). Push docs with the code branch (it is a money-path PR).

### T23 — local final gate
```bash
npm run check:guards && npm run typecheck   # in pmo-portal/
npx eslint --max-warnings=0 ../scripts/lib/pmo-capture.mjs ../scripts/pmo.mjs
node --test scripts/pmo-capture.test.mjs scripts/pmo.test.mjs
(cd supabase/functions/purchase-capture && deno test --allow-env --allow-net index.test.ts)
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_b2_split_assignment.test.sql supabase/tests/2195_b2_split_ledger.test.sql supabase/tests/2195_b2_split_undo.test.sql supabase/tests/2195_b2_split_performance.test.sql supabase/tests/2195_b1_assignment.test.sql supabase/tests/2195_b1_ledger.test.sql supabase/tests/2195_b1_undo.test.sql supabase/tests/2195_b1_performance.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/api_client_request_guard.test.sql supabase/tests/postgrest_embed_ambiguity_guard.test.sql'
scripts/with-db-lock.sh scripts/test-2195-b2-rollback.sh
```
Mutation check (money): drop the residual term in `capture_split_gl`'s `fixed` CTE → the AC-004 property must go red;
put the engine anti-join back to `decision = 'project'` → AC-005 must go red (the rule counts the split invoice again). Restore, re-run green.

## Traceability

| AC | Owning test (layer) | File |
|---|---|---|
| AC-001 | pgTAP | `supabase/tests/2195_b2_split_ledger.test.sql` |
| AC-002 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-003 | pgTAP | `supabase/tests/2195_b2_split_ledger.test.sql` |
| AC-004 | pgTAP (property block) | `supabase/tests/2195_b2_split_ledger.test.sql` |
| AC-005 | pgTAP | `supabase/tests/2195_b2_split_ledger.test.sql` |
| AC-006 | pgTAP | `supabase/tests/2195_b2_split_ledger.test.sql` |
| AC-007 | pgTAP | `supabase/tests/2195_b2_split_undo.test.sql` |
| AC-008 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-009 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-010 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-011 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-012 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-013 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-014 | pgTAP | `supabase/tests/2195_b2_split_assignment.test.sql` |
| AC-015 | pgTAP | `supabase/tests/2195_b2_split_ledger.test.sql` |
| AC-016 | Unit (node:test) | `scripts/pmo-capture.test.mjs` |
| AC-017 | Unit (Deno, shipped handler) | `supabase/functions/purchase-capture/index.test.ts` |
| AC-018 | Rollback harness (pgTAP, CI step) | `scripts/test-2195-b2-rollback.sh` |
| AC-019 | pgTAP | `supabase/tests/2195_b2_split_ledger.test.sql` |

No e2e: B2 has no screen; the CLI → route → RPC chain is covered by the Deno and node tests against the shipped
handler and the pgTAP contracts (ADR-0010 lowest sufficient layer).

## Risks

- **0882 not yet on `dev`.** B2 cannot start until B1 merges; every "recreate from 0882" assumes 0882's final bodies.
- **Signature change** of `assign_capture_invoices` (new parameter): the route and the request guard name the
  function, not its signature; T16 and T19 prove both still reach it.
- **Ledger rows not exact at the ERP precision** would refuse every split of that invoice; the refusal names it and
  B1's `project` decision remains available.
