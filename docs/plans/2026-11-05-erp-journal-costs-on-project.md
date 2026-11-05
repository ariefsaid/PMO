# Plan — ERP journal-entry costs on the project (#1919)

- **Spec:** `docs/specs/erp-journal-costs-on-project.spec.md` (FR-JEC / AC-JEC)
- **Author:** eng-planner, 2026-11-05
- **Migrations:** `0683`, `0684`, `0685` — the next free numbers on `origin/dev` at 306564b8e (head file `0682`).
  If another branch lands one of these first, run `scripts/renumber-migration.sh <old> <new>`; never hand-rename.
- **No ADR.** This reuses ADR-0093's link-only model and the 0361 count-once rule (ledger-held lowers open
  commitment; actuals come only from the ledger). Nothing here is irreversible or cross-cutting.

## Design in five lines

1. **No new mirror.** Journal cost lines are *derived at read time* from `erp_gl_entry_mirror` — the same rows the
   actuals snapshot sums — grouped by line key `(erp_doctype, voucher_no, project_id, account)`. So the list and
   the actual cannot disagree, and a repost (new GL row names) keeps the key.
2. **One new column** on the ledger mirror: `remarks` (the vendor/invoice reference), fed by the ERPNext ledger
   fetch and backfilled by one full ledger replay.
3. **One link table** `erp_journal_line_links` (one line → at most one purchase), written only by two definer RPCs
   with the same roles as ERP purchase link/unlink.
4. **Count once:** `procurement_ledger_held` and `procurement_ledger_held_many` gain one term — the current amount
   of the purchase's attached journal lines. Open commitment and committed spend pick it up unchanged. Actuals are
   never touched.
5. **PMO-posted journals** (expense postings, imprest transfers) are excluded by their posting mirrors' `erp_name`.

## Slices

| # | Slice | Migration | Money path? | Ships |
|---|---|---|---|---|
| S1 | Ledger mirror carries the GL remark | 0683 | No (read-model column) | Batch with S3–S5 |
| S2 | Journal lines read, attach/detach, count once | 0684 | **Yes** — changes open commitment | **Alone** |
| S3 | Project page: journal list + attach | — | No | Batch |
| S4 | Purchase detail: attached lines + detach | — | No | Batch |
| S5 | CLI `purchases journals` / `attach-journals` + API-client tier | 0685 | No (calls S2's RPCs) | Batch |
| S6 | e2e journey + runbook | — | No | Batch |

Order: S1 → S2 (ship alone, merge to dev) → S3, S4, S5, S6 on top of dev, one batch PR.

Every builder's local gate (CLAUDE.md): `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0
<touched files>`, the touched test files only; DB work as
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` (one hold).

---

## S1 — the ledger mirror carries the GL remark (FR-JEC-002, AC-JEC-013)

**Files:** `supabase/migrations/0683_gl_mirror_remarks.sql`, `supabase/migrations/rollback/0683_gl_mirror_remarks_down.sql`,
`supabase/tests/0683_gl_mirror_remarks.test.sql`, `pmo-portal/src/lib/adapterSeam/erpnext/ledgerFetch.ts`,
`pmo-portal/src/lib/adapterSeam/erpnext/ledgerMirrorFeed.ts`, `pmo-portal/src/lib/adapterSeam/erpnext/ledgerFetch.test.ts`,
the existing feed test beside `ledgerMirrorFeed.ts`, `pmo-portal/src/lib/supabase/database.types.ts`.

**T1.1 (red, pgTAP).** Create `supabase/tests/0683_gl_mirror_remarks.test.sql`: copy the org/binding fixture of
`supabase/tests/0382_ledger_voucher_replace.test.sql`, call `replace_erp_gl_voucher_rows` as `service_role` with one row
carrying `"remarks":"Vendor X inv 12"`, and assert
`select remarks from erp_gl_entry_mirror where erp_name = …` is `'Vendor X inv 12'`. Second assertion: a second call
with the same `erp_modified` and `"remarks":"changed"` updates it (the guard is `<=`). Run it; it fails (no column).

**T1.2 (green).** `0683_gl_mirror_remarks.sql`:

```sql
-- 0683 the ledger mirror carries the GL Entry remark (#1919 FR-JEC-002): the vendor / invoice reference of a journal.
-- Rollback: supabase/migrations/rollback/0683_gl_mirror_remarks_down.sql
alter table public.erp_gl_entry_mirror add column remarks text;

-- 0382 body; the lines marked 0683 are new.
create or replace function public.replace_erp_gl_voucher_rows(
  p_org_id uuid, p_company text, p_voucher_type text, p_voucher_no text, p_rows jsonb, p_current_names text[]
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare upserted_count integer; deleted_count integer;
begin
  if not public.erp_ledger_voucher_replace_check(p_org_id, p_company, p_voucher_type, p_voucher_no, p_rows, p_current_names) then
    return jsonb_build_object('upserted', 0, 'deleted', 0, 'stale_binding', true);
  end if;
  insert into public.erp_gl_entry_mirror as m (
    org_id, erp_name, company, is_opening, finance_book, account, cost_center, fiscal_year, project,
    party_type, party, voucher_type, voucher_no, posting_date, debit, credit, is_cancelled, erp_docstatus, erp_modified,
    remarks)                                                                                             -- 0683
  select p_org_id, r.erp_name, p_company, r.is_opening, r.finance_book, r.account, r.cost_center, r.fiscal_year, r.project,
         r.party_type, r.party, r.voucher_type, r.voucher_no, r.posting_date, r.debit, r.credit,
         coalesce(r.is_cancelled, false), r.erp_docstatus, r.erp_modified,
         r.remarks                                                                                       -- 0683
    from jsonb_populate_recordset(null::public.erp_gl_entry_mirror, p_rows) r
  on conflict (org_id, erp_name) do update set
    company = excluded.company, is_opening = excluded.is_opening, finance_book = excluded.finance_book,
    account = excluded.account, cost_center = excluded.cost_center, fiscal_year = excluded.fiscal_year,
    project = excluded.project, party_type = excluded.party_type, party = excluded.party,
    voucher_type = excluded.voucher_type, voucher_no = excluded.voucher_no, posting_date = excluded.posting_date,
    debit = excluded.debit, credit = excluded.credit, is_cancelled = excluded.is_cancelled,
    erp_docstatus = excluded.erp_docstatus, erp_modified = excluded.erp_modified,
    remarks = excluded.remarks                                                                           -- 0683
  where m.erp_modified <= excluded.erp_modified;
  get diagnostics upserted_count = row_count;
  -- copy lines 89–100 of 0382 (the delete-absent and the return) verbatim here.
end $$;
revoke execute on function public.replace_erp_gl_voucher_rows(uuid, text, text, text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.replace_erp_gl_voucher_rows(uuid, text, text, text, jsonb, text[]) to service_role;

-- One full ledger replay per ERPNext org so historical rows gain their remark (the sweep's existing full-replay path,
-- 0294/0312). Statements are not marked delayed: the replay re-writes the same amounts.
update public.external_org_bindings set statement_full_ledger_replay_needed = true
 where external_tier = 'erpnext' and activated_at is not null;
```

Before writing, read `pg_get_functiondef('public.replace_erp_gl_voucher_rows'::regprocedure)` on a reset local DB
and confirm the head body is still 0382's; if a later migration changed it, start from that body instead.
Rollback file: `alter table public.erp_gl_entry_mirror drop column remarks;` then the 0382 function body verbatim.
Run T1.1: green.

**T1.3 (red, Vitest).** In `ledgerFetch.test.ts`, assert the GL list request's `fields` includes `remarks` and a
fetched row's `remarks: 'Vendor X inv 12'` survives normalization; in the feed test, assert `glRowToMirror` output
carries `remarks`. Run `npx vitest run src/lib/adapterSeam/erpnext/ledgerFetch.test.ts <feed test>`: red.

**T1.4 (green).** `ledgerFetch.ts`: add `'remarks'` to `GL_FIELDS`; add `remarks?: string | null` to `GlEntryRow`;
set `remarks: str(r.remarks)` where the row is normalized. `ledgerMirrorFeed.ts` `glRowToMirror`: add
`remarks: r.remarks ?? null`. Confirm the full-replay branch (line ~129) uses `glRowToMirror` too — it does at
306564b8e. Regenerate types: `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`
(repo root). Rerun T1.3: green.

**T1.5.** `supabase/functions/erpnext-sweep/` deno tests that snapshot GL rows (`ledgerVoucherReplace.test.ts`,
`statementLegacyCompatibility.test.ts`): run `deno test` for that function; update a fixture only if it asserts the
exact GL field list.

---

## S2 — journal lines, attach/detach, count once (MONEY PATH — ships alone)

**Files:** `supabase/migrations/0684_erp_journal_cost_lines.sql`,
`supabase/migrations/rollback/0684_erp_journal_cost_lines_down.sql`, `supabase/tests/0684_erp_journal_cost_lines.test.sql`,
`pmo-portal/src/lib/supabase/database.types.ts`.

**Fixture (T2.1).** Start `0684_erp_journal_cost_lines.test.sql` from the header of
`supabase/tests/procurement_erp_links.test.sql` (orgs A and B, Finance/PM/Engineer/Admin profiles, an ERPNext
binding with `site_url` and `project_map` `{A1:"ERP-A1", A2:"ERP-A2"}`, `activated_at` set). Use the id prefix
`06840000-…`. Add:
- `budget_category_account_map` rows: `Project Subcontractors - X` → one category, `Cost of Goods - X` → another.
- GL rows (`erp_gl_entry_mirror`, inserted as superuser before `set local role`):
  - `JV-1` split: debit 60 on `Project Subcontractors - X` project `ERP-A1`; debit 120 same account project
    `ERP-A2`; credit 180 on a bank account (unmapped, no project). Remarks `'Vendor Lab inv 7'`.
  - `JV-2`: debit 40 on `Project Subcontractors - X` project `ERP-A1`, and a second row debit 10 same account,
    same project (two rows → one line of 50).
  - `JV-3`: debit −5 net (debit 0, credit 5) on a mapped account project `ERP-A1` (non-positive line).
  - `JV-PMO`: debit 20 project `ERP-A1`; insert `expense_posting_erp_mirror` with `erp_name = 'JV-PMO'` (copy
    its required columns from `supabase/tests/` expense-posting fixtures: `grep -l expense_posting_erp_mirror supabase/tests`).
  - Org B: `JV-B` debit 30 on its own project.
- Purchases on A1: `P1` (status Ordered, IDR, total 100), `P2` (IDR, total 70), `PX` (Cancelled), `PU` (USD); on A2: `Q1`.
- Org A `default_currency = 'IDR'`.

**T2.2 (red).** Write the assertions (each title leads with its AC id):
- AC-JEC-001: as Finance, `select count(*), sum(amount) from project_erp_journal_lines(A1)` → lines JV-1, JV-2, JV-3;
  JV-2 amount 50; JV-1 remark `'Vendor Lab inv 7'`; `erp_url` ends with `/app/journal-entry/JV-1`.
- AC-JEC-002: A1's JV-1 line is 60, A2's is 120; neither list shows the other's line.
- AC-JEC-003: JV-PMO absent; attach JV-PMO → outcome `refused`, reason `journal_posted_by_pmo`.
- AC-JEC-004: record `a0 := actuals_to_date` sum from `project_mapped_actuals(A1)` and
  `c0 := procurement_open_commitment(P1)`; attach JV-1/A1 to P1; assert actuals sum = `a0` and open commitment =
  `greatest(0, c0 − 60)`; assert `project_committed_spend(A1)` dropped by exactly 60.
- AC-JEC-005: detach it; open commitment = `c0`, actuals = `a0`.
- AC-JEC-006: attach JV-2 to P1; attach JV-2 to P2 → `line_attached_to_another_purchase`; attach JV-2 to P1 again →
  `skip` / `already_attached`; exactly one link row.
- AC-JEC-007: attach JV-1/A1 to P1 again; `project_committed_spend(A2)` and A2 actuals unchanged; attach JV-1/A1 to
  Q1 → `project_mismatch`.
- AC-JEC-008: `update erp_gl_entry_mirror set is_cancelled = true where voucher_no = 'JV-1'` (superuser); P1's
  `procurement_ledger_held` drops by 60; link row still exists.
- AC-JEC-009: attach to PX → `purchase_closed`; to PU → `currency_mismatch`; JV-3 → `line_not_positive`; no rows
  written.
- AC-JEC-010: dry run of `[JV-2→P1 fresh, JV-1→P2 (attached to P1), JV-404]` (after detaching JV-2) → outcomes
  `attach`, `refused`, `refused`; link count unchanged afterwards.
- AC-JEC-011: as Engineer, list returns 0 rows and attach raises 42501 (`throws_ok`); as PM, attach succeeds and
  `detach_erp_journal_line` raises 42501; as Admin, detach succeeds.
- AC-JEC-012: as org B Finance, A1's list → 0 rows; attach `{voucher JV-1, project A1, account …, procurement P1}` →
  `line_not_found`; with org B's own line and P1 → `purchase_not_found`; `select count(*) from erp_journal_line_links`
  as org B = 0.
- RLS: `erp_journal_line_links` has no insert/update/delete grant for `authenticated`
  (`table_privs_are` / `has_table_privilege` false); policy predicate checked via `policies_are`.

Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0684_erp_journal_cost_lines.test.sql'` → red.

**T2.3 (green — lines).** `0684_erp_journal_cost_lines.sql` §1:

```sql
-- 0684 ERP journal cost lines on the project: list, attach to a purchase (link only), count once (#1919).
-- Spec docs/specs/erp-journal-costs-on-project.spec.md. Rollback: supabase/migrations/rollback/0684_erp_journal_cost_lines_down.sql
-- Read-side only towards the ERP: nothing here writes to ERPNext or to the ledger mirror.

create index if not exists erp_gl_entry_mirror_org_project_voucher_type_idx
  on public.erp_gl_entry_mirror (org_id, project, voucher_type);

-- A journal cost line = one journal × one PMO project × one mapped cost account (spec §3). Same project map as the
-- actuals snapshot (invertProjectMap: an ERP project name mapped by two PMO projects maps to none) and the same
-- non-cancelled rows, so the list and the actuals cannot disagree. Internal: callers below carry the role checks.
create function public.erp_journal_cost_lines(p_org_id uuid, p_project_id uuid, p_voucher_no text default null)
returns table (erp_doctype text, voucher_no text, project_id uuid, account text, category public.budget_category,
               posting_date date, amount numeric, remarks text, party text, is_cancelled boolean)
language sql stable security definer set search_path = public, pg_catalog as $$
  with map as (
    select m.value as erp_name, min(m.key)::uuid as project_id
      from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map', '{}'::jsonb)) m
     where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null
       and m.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and m.value <> ''
     group by m.value having count(*) = 1
  ), pmo_posted as (
    select e.erp_name from public.expense_posting_erp_mirror e where e.org_id = p_org_id and e.erp_name is not null
    union
    select i.erp_name from public.imprest_posting_erp_mirror i where i.org_id = p_org_id and i.erp_name is not null
  )
  select g.voucher_type, g.voucher_no, map.project_id, g.account, cm.category,
         min(g.posting_date),
         coalesce(sum(coalesce(g.debit, 0) - coalesce(g.credit, 0)) filter (where not g.is_cancelled), 0),
         string_agg(distinct nullif(btrim(g.remarks), ''), ' · '),
         string_agg(distinct g.party, ', '),
         bool_and(g.is_cancelled)
    from public.erp_gl_entry_mirror g
    join map on map.erp_name = g.project and map.project_id = p_project_id
    join public.projects p on p.id = map.project_id and p.org_id = p_org_id
    join public.budget_category_account_map cm on cm.org_id = g.org_id and cm.erp_account = g.account
   where g.org_id = p_org_id and g.voucher_type = 'Journal Entry'
     and (p_voucher_no is null or g.voucher_no = p_voucher_no)
     and not exists (select 1 from pmo_posted x where x.erp_name = g.voucher_no)
   group by g.voucher_type, g.voucher_no, map.project_id, g.account, cm.category
$$;
revoke all on function public.erp_journal_cost_lines(uuid, uuid, text) from public, anon, authenticated;
```

Check before relying on it: `budget_category_account_map` still has `unique (org_id, erp_account)` at head
(`select indexdef from pg_indexes where tablename = 'budget_category_account_map'`) — the join must not fan out; and
`imprest_posting_erp_mirror` / `expense_posting_erp_mirror` are the only `Journal Entry` producers
(`grep -n "doctype: 'Journal Entry'" pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts` → `expense-journal`,
`imprest-transfer`). A third producer added later must join `pmo_posted`.

**T2.4 (green — table + list RPC).** §2–§3:

```sql
create table public.erp_journal_line_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  procurement_id uuid not null references public.procurements(id) on delete cascade,
  erp_doctype    text not null,
  voucher_no     text not null,
  project_id     uuid not null references public.projects(id) on delete restrict,
  account        text not null,
  linked_by      uuid references public.profiles(id),
  linked_at      timestamptz not null default now(),
  constraint erp_journal_line_links_one_purchase unique (org_id, erp_doctype, voucher_no, project_id, account)
);
create index erp_journal_line_links_procurement_idx on public.erp_journal_line_links (procurement_id);
alter table public.erp_journal_line_links enable row level security;
alter table public.erp_journal_line_links force row level security;
create policy erp_journal_line_links_select on public.erp_journal_line_links for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.erp_journal_line_links from anon, authenticated;
grant select on public.erp_journal_line_links to authenticated;

-- Defence in depth (the RPC checks first): purchase, project and link are one org, and the purchase is on the line's project.
create function public.guard_erp_journal_line_link() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.procurements p
                  where p.id = new.procurement_id and p.org_id = new.org_id and p.project_id = new.project_id) then
    raise exception 'A journal line can be attached only to a purchase of its own organization and project.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_erp_journal_line_link() from public, anon, authenticated;
create trigger erp_journal_line_links_guard before insert or update on public.erp_journal_line_links
  for each row execute function public.guard_erp_journal_line_link();

-- FR-JEC-001/030: the project's journal lines with their attachment. ERP-purchase audience; others get no rows.
create function public.project_erp_journal_lines(p_project_id uuid)
returns table (erp_doctype text, voucher_no text, project_id uuid, account text, category public.budget_category,
               posting_date date, amount numeric, currency text, remarks text, party text, is_cancelled boolean,
               erp_url text, link_id uuid, procurement_id uuid, procurement_title text)
language sql stable security definer set search_path = public, pg_catalog as $$
  select l.erp_doctype, l.voucher_no, l.project_id, l.account, l.category, l.posting_date, l.amount,
         o.default_currency, l.remarks, l.party, l.is_cancelled,
         case when b.site_url is not null
              then rtrim(b.site_url, '/') || '/app/journal-entry/' || l.voucher_no end,
         k.id, k.procurement_id, pr.title
    from public.erp_journal_cost_lines(public.auth_org_id(), p_project_id) l
    join public.organizations o on o.id = public.auth_org_id()
    left join public.external_org_bindings b
      on b.org_id = o.id and b.external_tier = 'erpnext' and b.activated_at is not null
    left join public.erp_journal_line_links k
      on k.org_id = o.id and k.erp_doctype = l.erp_doctype and k.voucher_no = l.voucher_no
     and k.project_id = l.project_id and k.account = l.account
    left join public.procurements pr on pr.id = k.procurement_id
   where public.is_active_member()
     and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
     and public.org_reads_erp_ledger()
   order by l.posting_date desc, l.voucher_no, l.account
$$;
revoke all on function public.project_erp_journal_lines(uuid) from public, anon;
grant execute on function public.project_erp_journal_lines(uuid) to authenticated;
```

The `erp_url` uses the ERPNext desk route; `erp_doctype` is fixed to `Journal Entry` today, so the path is fixed
too. When Odoo rows arrive (FR-JEC-041) this `case` gains a branch per tier.

**T2.5 (green — attach).** §4, modelled on `link_erp_purchase_documents` (0361 §5: one code path, per-row
refusal, dry run rolled back by an outer block):

```sql
create function public.attach_erp_journal_lines(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_currency text; v_results jsonb := '[]'::jsonb; v_row jsonb; v_n integer := 0;
  v_doctype text; v_voucher text; v_project uuid; v_account text; v_amount numeric;
  v_proc public.procurements%rowtype; v_existing uuid; v_outcome text; v_reason text;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Only Admin, Executive, Project Manager or Finance members can attach journal lines.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Send 1 to 500 rows per call.' using errcode = '22023';
  end if;
  select o.default_currency into v_currency from public.organizations o where o.id = v_org;

  begin  -- the batch; a dry run is rolled back at the end of this block (FR-JEC-013)
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_n := v_n + 1; v_outcome := 'attach'; v_reason := null; v_proc := null; v_amount := null;
      begin  -- one row: a refusal rolls back this row only
        if jsonb_typeof(v_row) <> 'object' then raise exception using errcode = 'JEC02', message = 'line_key_missing'; end if;
        v_doctype := coalesce(nullif(btrim(v_row->>'erp_doctype'), ''), 'Journal Entry');
        v_voucher := nullif(btrim(v_row->>'voucher_no'), '');
        v_account := nullif(btrim(v_row->>'account'), '');
        v_project := nullif(btrim(v_row->>'project_id'), '')::uuid;
        if v_voucher is null or v_account is null or v_project is null then
          raise exception using errcode = 'JEC02', message = 'line_key_missing';
        end if;
        if exists (select 1 from public.expense_posting_erp_mirror e where e.org_id = v_org and e.erp_name = v_voucher)
           or exists (select 1 from public.imprest_posting_erp_mirror i where i.org_id = v_org and i.erp_name = v_voucher) then
          raise exception using errcode = 'JEC02', message = 'journal_posted_by_pmo';
        end if;
        select l.amount into v_amount from public.erp_journal_cost_lines(v_org, v_project, v_voucher) l
         where l.erp_doctype = v_doctype and l.account = v_account;
        if not found then raise exception using errcode = 'JEC02', message = 'line_not_found'; end if;
        if v_amount <= 0 then raise exception using errcode = 'JEC02', message = 'line_not_positive'; end if;

        select * into v_proc from public.procurements
         where id = nullif(btrim(v_row->>'procurement_id'), '')::uuid for update;
        if not found or v_proc.org_id is distinct from v_org then
          v_proc := null; raise exception using errcode = 'JEC02', message = 'purchase_not_found';
        end if;
        if v_proc.status::text in ('Cancelled','Rejected') then raise exception using errcode = 'JEC02', message = 'purchase_closed'; end if;
        if v_proc.project_id is distinct from v_project then raise exception using errcode = 'JEC02', message = 'project_mismatch'; end if;
        if v_proc.currency is distinct from v_currency then raise exception using errcode = 'JEC02', message = 'currency_mismatch'; end if;

        select k.procurement_id into v_existing from public.erp_journal_line_links k
         where k.org_id = v_org and k.erp_doctype = v_doctype and k.voucher_no = v_voucher
           and k.project_id = v_project and k.account = v_account
         for update;
        if found then
          if v_existing = v_proc.id then
            v_reason := 'already_attached'; raise exception using errcode = 'JEC03', message = 'skip';
          end if;
          raise exception using errcode = 'JEC02', message = 'line_attached_to_another_purchase';
        end if;

        insert into public.erp_journal_line_links (org_id, procurement_id, erp_doctype, voucher_no, project_id, account, linked_by)
        values (v_org, v_proc.id, v_doctype, v_voucher, v_project, v_account, v_uid);
        perform public.log_audit('procurement.journal_attach', v_org, v_uid, v_proc.id,
          jsonb_build_object('erp_doctype', v_doctype, 'voucher_no', v_voucher, 'project_id', v_project,
                             'account', v_account, 'amount', v_amount));
      exception
        when sqlstate 'JEC02' then v_outcome := 'refused'; v_reason := sqlerrm;
        when sqlstate 'JEC03' then v_outcome := 'skip';
        when invalid_text_representation then v_outcome := 'refused'; v_reason := 'invalid_id';
        when unique_violation then v_outcome := 'refused'; v_reason := 'line_attached_to_another_purchase';
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_n, 'outcome', v_outcome, 'reason', v_reason, 'voucher_no', v_voucher,
        'procurement_id', v_proc.id, 'amount', v_amount));
    end loop;
    if p_dry_run then raise exception using errcode = 'JEC04', message = 'dry_run'; end if;
  exception when sqlstate 'JEC04' then null;
  end;
  return jsonb_build_object('dry_run', p_dry_run, 'results', v_results);
end $$;
revoke all on function public.attach_erp_journal_lines(jsonb, boolean) from public, anon;
grant execute on function public.attach_erp_journal_lines(jsonb, boolean) to authenticated;
```

**T2.6 (green — detach).** §5:

```sql
create function public.detach_erp_journal_line(p_link_id uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_link public.erp_journal_line_links%rowtype; v_proc uuid;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'Only an Admin or Finance member can detach a journal line.' using errcode = '42501';
  end if;
  select k.procurement_id into v_proc from public.erp_journal_line_links k
   where k.id = p_link_id and k.org_id = public.auth_org_id();
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  perform 1 from public.procurements where id = v_proc for update;  -- the lock attach takes (0372 order)
  delete from public.erp_journal_line_links
   where id = p_link_id and org_id = public.auth_org_id() returning * into v_link;
  if not found then raise exception 'link not found' using errcode = 'P0002'; end if;
  perform public.log_audit('procurement.journal_detach', v_link.org_id, auth.uid(), v_link.procurement_id,
    jsonb_build_object('erp_doctype', v_link.erp_doctype, 'voucher_no', v_link.voucher_no,
                       'project_id', v_link.project_id, 'account', v_link.account));
end $$;
revoke all on function public.detach_erp_journal_line(uuid) from public, anon;
grant execute on function public.detach_erp_journal_line(uuid) to authenticated;
```

**T2.7 (green — count once).** §6. Read the head bodies first:
`select pg_get_functiondef('public.procurement_ledger_held(uuid)'::regprocedure)` and the same for
`procurement_ledger_held_many(uuid[])` (expect 0372 and 0651). Recreate each with its head body plus one term,
added after the PMO-invoice term:

```sql
       + coalesce((select sum(l.amount)                                                     -- 0684 FR-JEC-021
                     from public.erp_journal_line_links k
                     cross join lateral public.erp_journal_cost_lines(k.org_id, k.project_id, k.voucher_no) l
                    where k.procurement_id = p.id
                      and l.erp_doctype = k.erp_doctype and l.account = k.account), 0)
```

Every caller (`procurement_open_commitment`, `project_committed_spend`, the dashboards through them) picks it up
with no change: `grep -n "procurement_ledger_held" supabase/migrations/*.sql` at head lists them; confirm none sums
journal amounts a second way. `procurement_payment_within_ceiling` and `procurement_evidenced_step` are deliberately
unchanged (spec §4 out of scope).

Run T2.2 → green. Then the neighbours this change could move:
`supabase test db supabase/tests/0651_committed_spend_equivalence.test.sql supabase/tests/procurement_erp_links.test.sql
supabase/tests/project_committed_spend_currency.test.sql supabase/tests/0682_erpnext_payment_inflight_per_bill.test.sql`
(one lock hold with the reset).

**T2.8 (mutation check — required, money path).** Temporarily replace the new term with `+ 0`, rerun 0684's
test: AC-JEC-004/005/008 must go red. Temporarily drop `and map.project_id = p_project_id` from
`erp_journal_cost_lines`: AC-JEC-002/007 must go red. Revert both; record both red runs in the PR body.

**T2.9 (rollback).** `rollback/0684_erp_journal_cost_lines_down.sql`: restore `procurement_ledger_held` (0372 body)
and `procurement_ledger_held_many` (0651 body) verbatim, then drop `detach_erp_journal_line`,
`attach_erp_journal_lines`, `project_erp_journal_lines`, the trigger and its function, `erp_journal_line_links`,
`erp_journal_cost_lines`, the index. Run `npm run check:migrations` (rollback pairing). Regenerate
`database.types.ts` (T1.4 command). Commit; push branch; this slice goes to dev in its own PR.

---

## S3 — project page: journal list + attach (FR-JEC-001/003/004/005/006/010, AC-JEC-014/016)

**Files:** `pmo-portal/src/lib/repositories/erpJournalLines.ts` (new),
`pmo-portal/src/lib/repositories/contracts/erpJournalLines.ts` (new), `pmo-portal/src/lib/repositories/index.ts`,
`pmo-portal/src/lib/repositories/types.ts`, `pmo-portal/src/hooks/useErpJournalLines.ts` (new),
`pmo-portal/pages/project-detail/ErpJournalLinesSection.tsx` (new) + `.test.tsx`,
`pmo-portal/pages/project-detail/AttachJournalLineDialog.tsx` (new),
`pmo-portal/pages/project-detail/tabs/ProcurementTab.tsx`, `pmo-portal/public/locales/{en,id}/finance.json`.

**T3.1.** Repository (pattern: `src/lib/repositories/erpPurchases.ts`):
`listProjectLines(projectId)` → `supabase.rpc('project_erp_journal_lines', { p_project_id })`, mapped to camelCase
`ErpJournalLine { erpDoctype, voucherNo, projectId, account, category, postingDate, amount, currency, remarks, party,
isCancelled, erpUrl, linkId, procurementId, procurementTitle }`; `attach(rows, dryRun)` →
`rpc('attach_erp_journal_lines', { p_rows, p_dry_run })`; `detach(linkId)` → `rpc('detach_erp_journal_line', …)`;
`listForPurchase(procurementId)` → `supabase.from('erp_journal_line_links').select('id,erp_doctype,voucher_no,project_id,account,linked_at').eq('procurement_id', id)`
then `listProjectLines(projectId)` filtered by `linkId` (one RPC; no second ledger read). Register in `index.ts` /
`types.ts` as `erpJournalLines`.

**T3.2.** Hooks `useProjectJournalLines(projectId, { enabled })`, `useAttachJournalLines()`, `useDetachJournalLine()`;
query key root `'erp-journal-lines'`; on success invalidate `'erp-journal-lines'`, `'project-committed-spend'`,
`'procurement'` and `procurementKeys.all(orgId)` (copy `useInvalidateLinks` from `src/hooks/useErpPurchaseLinks.ts`).

**T3.3 (red).** `ErpJournalLinesSection.test.tsx` with a mocked repository: renders rows (date, number, account,
category, amount, remark); an unattached row shows the FR-JEC-003 note and, for `create erpPurchaseLink`, an
"Attach to purchase" button; an attached row shows the purchase title as a link to `/procurement/<id>`; a cancelled
row shows "Cancelled in the accounting system"; no total is rendered; renders nothing when the list is empty
(AC-JEC-016 is covered by the RPC returning no rows for a non-ledger org, plus `canView` false → nothing).

**T3.4 (green).** `ErpJournalLinesSection.tsx`: a `DataTable` (as `LinkedErpDocuments.tsx`) titled
`t('erpJournal.title', 'Journal entries from the accounting system')`, subtitle the same "Already in spending"
tooltip pattern as `ProcurementTab.tsx` lines 29–39, columns per FR-JEC-001, the document number linking to
`erpUrl` when present (`target="_blank" rel="noopener noreferrer"`). Gate: `may('view','procurement')`; attach:
`may('create','erpPurchaseLink')` (same entity as ERP purchase linking — the RPC is the authority).

**T3.5.** `AttachJournalLineDialog.tsx`: `EntityFormModal` with one `Combobox` of the project's purchases
(existing purchases hook used by `ProcurementBlock`, filtered to status not Cancelled/Rejected), a dry run on select
showing the outcome (`erpJournal.reason.<code>` copy for each refusal code of T2.5), Confirm runs the real attach;
errors through `classifyMutationError`.

**T3.6.** Mount in `ProcurementTab.tsx` below the ERP purchase section, inside the same `canSeeMoney` guard. Add
en/id strings; `npm run check:i18n`.

## S4 — purchase detail: attached lines + detach (FR-JEC-014/016, AC-JEC-014)

**Files:** `pmo-portal/pages/procurement/AttachedJournalLines.tsx` (new) + `.test.tsx`,
`pmo-portal/pages/ProcurementDetails.tsx` (line ~1268), `pmo-portal/public/locales/{en,id}/finance.json`.

**T4.1 (red).** Test: rows render (number, date, account, amount); Detach shows only for
`delete erpPurchaseLink`; Detach opens `ConfirmDialog` and calls `detach(linkId)`; empty → renders nothing.

**T4.2 (green).** Component modelled on `LinkedErpDocuments.tsx`; mount next to it:
`{!isEngineer && <AttachedJournalLines procurementId={p.id} projectId={p.project_id} />}`.

## S5 — CLI and API-client tier (AC-JEC-017)

**Files:** `supabase/migrations/0685_api_client_journal_rpcs.sql` + rollback, `scripts/lib/pmo-purchases.mjs`,
`scripts/pmo.mjs`, `scripts/pmo-purchases.test.mjs`, `docs/runbooks/pmo-cli.md`.

**T5.1.** 0685: rebuild `api_client_request_guard()` from its head body
(`pg_get_functiondef`; 0588 at 306564b8e), adding `'attach_erp_journal_lines'` to `purchase_rpcs` and
`'project_erp_journal_lines'` to the same tier's allowed RPCs (mark the lines `-- 0685`). Rollback = the head body
verbatim. `detach_erp_journal_line` is not exposed to the CLI (no CLI command deletes records, runbook line 325).

**T5.2 (red → green).** `scripts/pmo-purchases.test.mjs`: `validateJournalRows` rejects a row without
`voucher_no`/`account`/`project_id`/`procurement_id`; `runAttachJournals(ctx, rows, { dryRun: true })` calls
`attach_erp_journal_lines` with `p_dry_run: true` and prints one line per result. Implement in
`scripts/lib/pmo-purchases.mjs` beside `runLink`; wire `pmo purchases journals --project <id>` (prints
`project_erp_journal_lines`) and `pmo purchases attach-journals <file.json|-> [--dry-run]` in `scripts/pmo.mjs`
(`purchases()` switch, line ~1105, and the help text at line ~789). Run `node --test scripts/pmo-purchases.test.mjs`.

**T5.3.** Runbook: add both commands under the `purchases link` block of `docs/runbooks/pmo-cli.md` with a JSON row
example `{"voucher_no":"…","project_id":"…","account":"…","procurement_id":"…"}`, roles, and "link only; nothing is
sent to the ERP".

## S6 — journey (AC-JEC-015)

**Files:** `pmo-portal/e2e/AC-JEC-015-journal-attach.spec.ts`, seed rows in `supabase/seed.sql` (local only) if the
rich seed has no project-tagged journal; read `docs/e2e-parallel-conventions.md` first (isolation tag; this spec
writes a link, so it uses its own purchase and detaches in teardown via the RPC as Admin).

**T6.1.** Journey: sign in as Finance → open a project's Procurement tab → note the spent figure → Attach the
journal line to the seeded purchase → open the purchase → the line is listed → back on the project the spent figure
is unchanged. Run `scripts/e2e-local.sh AC-JEC-015` and `node scripts/affected-e2e.mjs`; `scripts/ux-proof.sh` on
the project and purchase routes.

## Traceability

| AC | Owning test |
|---|---|
| AC-JEC-001…012 | `supabase/tests/0684_erp_journal_cost_lines.test.sql` |
| AC-JEC-013 | `supabase/tests/0683_gl_mirror_remarks.test.sql` + `ledgerFetch.test.ts` |
| AC-JEC-014 | `ErpJournalLinesSection.test.tsx`, `AttachedJournalLines.test.tsx` |
| AC-JEC-015 | `e2e/AC-JEC-015-journal-attach.spec.ts` |
| AC-JEC-016 | `ErpJournalLinesSection.test.tsx` |
| AC-JEC-017 | `scripts/pmo-purchases.test.mjs` |

## Follow-ups (file as issues when S2 ships)

- Odoo journal items: when #1507 feeds Odoo ledger rows into the ledger mirror, add the Odoo journal doctype to
  `erp_journal_cost_lines`' `voucher_type` filter and an `erp_url` branch (FR-JEC-041).
- Owner answers to the questions below may add: create-a-purchase-from-journal-lines; listing rule-attributed
  journal lines.

## Owner questions

1. **Rule-attributed journals.** Some journal cost reaches a project by a cost-attribution rule, not a project tag.
   List those too? Recommended: not now; tagged lines cover the reported case.
2. **Create a purchase from journal lines.** For 2025 history with no PMO purchase behind a journal, should a line
   be able to *create* a purchase (as ERP invoices can), or only attach to an existing one? Recommended: attach only
   in v1; the procurement list stays "purchases raised in PMO".
