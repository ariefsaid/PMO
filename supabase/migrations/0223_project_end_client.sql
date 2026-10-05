-- 0223_project_end_client.sql — record the project's END CUSTOMER alongside the client.
--
-- When the firm works as a subcontractor, the CLIENT is the main contractor we invoice (it issues
-- the PO and receives the invoice) while the END CUSTOMER owns the asset or site the work is
-- ultimately for. `projects` already carried `client_id`; this migration adds a nullable
-- `end_client_id` FK to `companies`, scoped to the stamped `org_id`, so work can be reported by
-- who it is ultimately for without changing who is invoiced.
--
-- The database is the enforcement authority: a SECURITY DEFINER, search-path-pinned
-- `BEFORE INSERT OR UPDATE OF end_client_id, org_id` trigger requires any non-null value to
-- reference a company of the row's OWN org. A mismatch raises a uniform `42501` (never `23503`,
-- so the error does not leak whether the referenced id exists).
--
-- MANUAL REVERSAL (forward-only repo convention; pre-production rollback is `supabase db reset`):
--   drop trigger if exists projects_zz_end_client_same_org on public.projects;
--   drop function if exists public.check_project_end_client_same_org();
--   drop index if exists public.projects_end_client_idx;
--   alter table public.projects drop column end_client_id;
--   -- restore migration 0208's get_sales_pipeline() body (no `pl.end_client_id` CTE row, no
--   -- `end_client_id`/`end_client_name` JSON keys, no `left join companies ec`) and re-run the
--   -- three ACL statements from 0208.

-- ── Schema: nullable FK, same on-delete behaviour as client_id (no action). ────────────────
alter table public.projects
  add column end_client_id uuid references public.companies(id);
create index projects_end_client_idx on public.projects (end_client_id);

-- ── Same-org guard. SECURITY DEFINER, pinned search_path, no EXECUTE grant to the client roles. ──
create or replace function public.check_project_end_client_same_org()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.end_client_id is not null
     and not exists (
       select 1 from public.companies c
       where c.id = new.end_client_id and c.org_id = new.org_id)
  then
    raise exception 'end customer not in this organization' using errcode = '42501';
  end if;
  return new;
end $$;

-- Trigger functions need no EXECUTE grant; revoke broadly so the direct-call surface stays closed.
revoke all on function public.check_project_end_client_same_org() from public, anon, authenticated;

-- Attach as a `zz_` slot so it fires AFTER `projects_stamp_org_id` (triggers fire alphabetically;
-- the org stamp must run first). `OF end_client_id, org_id` scopes it to writes that can change
-- either side of the invariant.
create trigger projects_zz_end_client_same_org
  before insert or update of end_client_id, org_id
  on public.projects
  for each row execute function public.check_project_end_client_same_org();

-- ── Grants. `projects` uses EXPLICIT COLUMN GRANTS (0008/0075/0173/0197): a NEW column is silently
--    unwritable until granted. `select` is table-level already; grant only insert+update, and not
--    to anon.
grant insert (end_client_id), update (end_client_id) on public.projects to authenticated;

-- ── Pipeline projection: forward the end customer through get_sales_pipeline(). ────────────────
-- 0208's body VERBATIM except `pl.end_client_id`, the `left join companies ec`, and the two JSON
-- keys. Comment updated to point at THIS definition.
drop function if exists public.get_sales_pipeline();

create or replace function public.get_sales_pipeline()
  returns json
  language sql
  stable
  security invoker
  set search_path = public
as $$
  with pl as (
    select
      p.id,
      p.name,
      p.client_id,
      p.end_client_id,
      p.status,
      p.contract_value,
      p.currency,
      p.tax_treatment,
      p.last_update,
      p.project_manager_id,
      coalesce(c.win_probability, 0) as win_prob
    from projects p
    left join pipeline_stage_config c on c.status = p.status
    where p.status::text = any(pipeline_project_statuses())
  )
  select json_build_object(
    'stages', coalesce((
      select json_agg(
        json_build_object(
          'status',        s.status,
          'count',         s.cnt,
          'total_value',   s.total_value,
          'win_probability', s.win_prob,
          'weighted_value',  s.total_value * s.win_prob
        )
        order by s.status
      )
      from (
        select
          status,
          count(*)::int           as cnt,
          sum(contract_value)     as total_value,
          max(win_prob)           as win_prob
        from pl
        group by status
      ) s
    ), '[]'::json),
    'projects', coalesce((
      select json_agg(
        json_build_object(
          'id',              pl.id,
          'name',            pl.name,
          'client_name',     co.name,
          'end_client_id',   pl.end_client_id,
          'end_client_name', ec.name,
          'status',          pl.status,
          'contract_value',  pl.contract_value,
          'currency',        pl.currency,
          'tax_treatment',   pl.tax_treatment,
          'win_probability', pl.win_prob,
          'last_update',     pl.last_update,
          'pm_name',         pm.full_name
        )
        order by pl.contract_value desc
      )
      from pl
      left join companies co on co.id = pl.client_id
      left join companies ec on ec.id = pl.end_client_id
      left join profiles  pm on pm.id = pl.project_manager_id
    ), '[]'::json)
  );
$$;

comment on function public.get_sales_pipeline() is
  'Latest definition: 0223. To add a projection column: copy THIS body verbatim, add the column, reapply the three ACL statements, and extend AC-TAX-305''s key list in supabase/tests/0208_sales_pipeline_tax_treatment.test.sql.';

-- Reapply the ACLs alongside the LATEST definition (0223) — a dropped function takes its grants.
revoke all     on function public.get_sales_pipeline() from public;
grant  execute on function public.get_sales_pipeline() to authenticated;
revoke execute on function public.get_sales_pipeline() from anon;