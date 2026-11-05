-- 0650_budget_version_read_aggregate.sql — one bounded invoker read for a project budget.
-- Reversal: rollback/0650_budget_version_read_aggregate_down.sql.
--
-- Replaces four PostgREST requests (versions, then lines ∥ editors ∥ totals) with ONE caller-scoped
-- statement per page. It is additive and read-only: no table, policy, grant, helper or money-write path
-- is touched, and the four legacy reads remain available (the client falls back to them when a page is
-- too large to aggregate safely).
--
-- Security: `security invoker` + empty `search_path` + ordinary EXECUTE grant. `org_id` is never taken
-- from the client; RLS on the three base tables remains the only scope authority.
--
-- Scope semantics are the LEGACY ones, deliberately:
--   • lines and editors: their own visibility AND an independently visible parent version whose
--     project is the argument — no org-equality condition is added to the output;
--   • total: the 0400 rule (`li.org_id = v.org_id`) applied to the page's versions, so the number
--     cannot drift from `budget_version_read_totals`.
--
-- Bounding (Terra review, binding): the page is materialised BEFORE any child work, so `p_offset`/
-- `p_limit` bound the VERSION rows aggregated, not merely the rows returned. A page whose response would
-- exceed a documented budget returns ONE `overflow = true` marker and aggregates nothing; the caller then
-- runs the legacy paged reads for the complete project. Nothing is ever truncated.
--
-- What the budget measures is the ACTUAL JSON TEXT each row will occupy on the wire
-- (`octet_length(to_json(row)::text)`), not the physical tuple size: `pg_column_size` of a TOASTed or
-- compressed value reports the in-line pointer, so a 200 KB compressible description would pass a physical
-- budget while emitting a 200 KB body, and JSON escaping (quotes, backslashes, newlines, non-ASCII) makes
-- the wire text larger than the stored text. Version rows are budgeted too, so metadata cannot bypass it.
-- The census necessarily READS every child of the page to measure it; the gate therefore bounds the
-- RESPONSE and the aggregation memory, not the number of rows scanned.

create function public.budget_version_read(
  p_project_id uuid,
  p_offset integer default 0,
  p_limit integer default 1000
)
returns table (
  version_no integer,
  version_id uuid,
  version_row json,
  line_items json,
  editor_ids uuid[],
  total numeric,
  overflow boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  if p_project_id is null then
    raise exception 'budget_version_read: project is required' using errcode = '22004';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'budget_version_read: offset must be >= 0' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'budget_version_read: limit must be between 1 and 1000' using errcode = '22023';
  end if;

  return query
  with page as materialized (
    select v as row_data, v.id, v.org_id, v.version
    from public.budget_versions v
    where v.project_id = p_project_id
    order by v.version, v.id
    offset p_offset
    limit p_limit
  ),
  -- Child census runs BEFORE any JSON is built, so an oversized page never materialises its arrays.
  line_stats as materialized (
    select li.budget_version_id as version_ref,
           count(*) as n,
           sum(octet_length(to_json(li)::text)) as json_bytes,
           max(octet_length(to_json(li)::text)) as max_json_bytes
    from public.budget_line_items li
    join page p on p.id = li.budget_version_id
    group by li.budget_version_id
  ),
  editor_stats as materialized (
    select e.budget_version_id as version_ref,
           count(*) as n,
           sum(octet_length(e.user_id::text) + 3) as json_bytes,   -- "uuid" plus the array comma
           max(octet_length(e.user_id::text) + 3) as max_json_bytes
    from public.budget_version_editors e
    join page p on p.id = e.budget_version_id
    group by e.budget_version_id
  ),
  version_stats as materialized (
    select count(*) as n,
           coalesce(sum(octet_length(to_json(p.row_data)::text)), 0) as json_bytes,
           coalesce(max(octet_length(to_json(p.row_data)::text)), 0) as max_json_bytes
    from page p
  ),
  stats as materialized (
    select
      coalesce((select sum(n) from line_stats), 0)
        + coalesce((select sum(n) from editor_stats), 0) as child_rows,
      -- Row JSON plus child separators; 256 bytes per version covers the response object,
      -- UUID, integer, total and array delimiters. numeric(14,2) times at most 4000
      -- children fits in 20 bytes including sign and decimal point; NaN is shorter.
      -- The 1024 bytes cover the outer array and serializer whitespace.
      coalesce((select sum(json_bytes) from line_stats), 0)
        + coalesce((select sum(json_bytes) from editor_stats), 0)
        + coalesce((select json_bytes from version_stats), 0)
        + 2 * coalesce((select sum(n) from line_stats), 0)
        + coalesce((select sum(n) from editor_stats), 0)
        + 256 * coalesce((select n from version_stats), 0)
        + 1024 as page_json_bytes,
      greatest(coalesce((select max(max_json_bytes) from line_stats), 0),
               coalesce((select max(max_json_bytes) from editor_stats), 0),
               coalesce((select max_json_bytes from version_stats), 0)) as max_row_json_bytes
  ),
  -- Documented conservative page budget: <=4000 child rows, <=8 MiB of exact JSON row text on the
  -- wire, and no single row (version metadata included) above 64 KiB. A real budget page
  -- (58 versions / 232 lines) is far below every bound.
  gate as materialized (
    select s.child_rows <= 4000
       and s.page_json_bytes <= 8388608
       and s.max_row_json_bytes <= 65536 as ok
    from stats s
  ),
  page_lines as (
    select li.budget_version_id as version_ref, json_agg(to_json(li) order by li.id) as items
    from public.budget_line_items li
    join page p on p.id = li.budget_version_id
    where (select ok from gate)
    group by li.budget_version_id
  ),
  page_editors as (
    select e.budget_version_id as version_ref, array_agg(e.user_id order by e.user_id) as ids
    from public.budget_version_editors e
    join page p on p.id = e.budget_version_id
    where (select ok from gate)
    group by e.budget_version_id
  ),
  page_totals as (
    select p.id as version_ref, coalesce(sum(li.budgeted_amount), 0)::numeric as total
    from page p
    left join public.budget_line_items li
      on li.budget_version_id = p.id and li.org_id = p.org_id
    where (select ok from gate)   -- an oversized page aggregates nothing, totals included
    group by p.id
  )
  select out.version_no, out.version_id, out.version_row, out.line_items, out.editor_ids, out.total, out.overflow
  from (
    select p.version as version_no,
           p.id as version_id,
           to_json(p.row_data) as version_row,
           coalesce(pl.items, '[]'::json) as line_items,
           coalesce(pe.ids, '{}'::uuid[]) as editor_ids,
           pt.total,
           false as overflow
    from page p
    left join page_lines pl on pl.version_ref = p.id
    left join page_editors pe on pe.version_ref = p.id
    left join page_totals pt on pt.version_ref = p.id
    where (select ok from gate)
    union all
    select null::integer, null::uuid, null::json, null::json, null::uuid[], null::numeric, true
    where not (select ok from gate)
  ) out
  order by out.version_no nulls last, out.version_id nulls last;
end;
$fn$;

revoke all on function public.budget_version_read(uuid, integer, integer) from public, anon;
grant execute on function public.budget_version_read(uuid, integer, integer) to authenticated;
