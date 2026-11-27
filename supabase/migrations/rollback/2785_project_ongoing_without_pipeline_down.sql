-- Rollback 2785_project_ongoing_without_pipeline.sql — restores the pre-2785 bodies.
-- Replaces 2785's branch back to the anchored originals (0534's legality gate; 0394's
-- preflight). Raises if the 2785 shape is not what is stored.
do $$
declare
  v_tp text := pg_get_functiondef(
    'public.transition_project(uuid, public.project_status, text, date, text, text)'::regprocedure
  );
  v_elig text := pg_get_functiondef('public.project_win_eligibility(uuid)'::regprocedure);
  v_tp_new  constant text := 'if p_to = v_from
     or ( not (v_legal -> v_from::text) ? p_to::text
          and not ( v_from = ''Leads'' and p_to = ''Won, Pending KoM''
                    and not coalesce((select f.enabled from public.resolve_feature_internal(v_org, ''sales_pipeline'') f), false) ) ) then';
  v_tp_old  constant text := 'if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then';
  v_elig_new constant text := 'if v_project.status not in (''Quotation Submitted'',''Tender Submitted'',''Negotiation'')
     and not ( v_project.status = ''Leads''
               and not coalesce((select f.enabled from public.resolve_feature_internal(v_project.org_id, ''sales_pipeline'') f), false) ) then
    return ''unavailable'';
  end if;';
  v_elig_old constant text := 'if v_project.status not in (''Quotation Submitted'',''Tender Submitted'',''Negotiation'') then return ''unavailable''; end if;';
begin
  if position(v_tp_new in v_tp) = 0 then
    raise exception '2785 rollback transition_project source anchor not found';
  end if;
  execute replace(v_tp, v_tp_new, v_tp_old);
  if position(v_elig_new in v_elig) = 0 then
    raise exception '2785 rollback project_win_eligibility source anchor not found';
  end if;
  execute replace(v_elig, v_elig_new, v_elig_old);
end;
$$;

notify pgrst, 'reload schema';
