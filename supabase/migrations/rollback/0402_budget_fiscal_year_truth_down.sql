-- Restore the preceding fiscal-year list definition.
CREATE OR REPLACE FUNCTION public.list_budget_fiscal_years(p_project_id uuid)
 RETURNS TABLE(fiscal_year text, is_active_push boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with on_record_fy as (
    -- ⚑ BYTE-FOR-BYTE §3a's `budget_year.on_record`, split into its two facts. Keep these two EXISTS
    -- clauses and §3a's identical: a divergence would let the selector offer a year it then refuses to
    -- explain (or flag one whose budget the grid withholds).
    select o.fiscal_year
      from (
        select li.fiscal_year                                                        -- F-C
          from public.budget_versions v
          join public.budget_line_items li on li.budget_version_id = v.id
         where v.project_id = p_project_id and v.status = 'Active'
           and li.fiscal_year is not null
        union
        select em.fiscal_year                                                        -- F-A
          from public.budget_push_mirror_rows em
          join public.budget_versions v on v.id = em.budget_version_id
         where v.project_id = p_project_id and v.status = 'Active'
           and em.push_state = 'pushed'
      ) o
  ),
  observed as (
    select em.fiscal_year                                                            -- F-B (offer only)
      from public.budget_push_mirror_rows em
      join public.budget_versions v on v.id = em.budget_version_id
     where v.project_id = p_project_id
    union
    select s.fiscal_year from public.erp_actuals_snapshot s where s.project_id = p_project_id
    union
    select bp.fiscal_year from public.budget_projections bp where bp.project_id = p_project_id
    union
    -- NEW (F-C): PMO's own phased years, on ANY version. Without this a phased-but-never-pushed
    -- project could not be navigated to AT ALL — the very projects FR-BUD-152 exists to unblock.
    select li.fiscal_year
      from public.budget_versions v
      join public.budget_line_items li on li.budget_version_id = v.id
     where v.project_id = p_project_id and li.fiscal_year is not null
  )
  select o.fiscal_year,
         exists (select 1 from on_record_fy r where r.fiscal_year = o.fiscal_year) as is_active_push
    from observed o
   -- `erp_actuals_snapshot.fiscal_year` is nullable (0101): a GL row whose fiscal year ERPNext never
   -- stated cannot be selected by an equality match anyway, so offering it would be an option that
   -- returns nothing. The empty string is the "no year selected" sentinel and is never an offer.
   where o.fiscal_year is not null and o.fiscal_year <> ''
   order by o.fiscal_year desc;
$function$;
