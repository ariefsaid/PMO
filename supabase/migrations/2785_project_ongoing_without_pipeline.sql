-- 2785_project_ongoing_without_pipeline.sql — #3023 (AC-3023).
--
-- An organisation whose sales-pipeline module is off could create a project but could never run
-- delivery on it: a new project starts at Leads, every route out of Leads was either a pipeline
-- stage (refused by 0534's feature assert), a lost outcome, or the terminal Internal Project — so
-- Won, Pending KoM and Ongoing Project were unreachable without the feature.
--
-- The change is exactly one branch, reached only with the feature off:
--   • transition_project accepts Leads → Won, Pending KoM when sales_pipeline is OFF for the
--     project's organisation (then the ordinary Won, Pending KoM → Ongoing Project leg applies).
--     With the feature ON the transition map is byte-for-byte what it was.
--   • project_win_eligibility (the screen's win preflight) offers the win on a Lead on the same
--     condition, so the affordance and the enforcement agree.
-- NOTHING ELSE LOOSENS: the tenant re-assertion, the active-membership check, the coarse role
-- gate (Admin/Executive/Project Manager/Finance) and the win-value witness SoD (0177/0178/0181/
-- 0183) all run unchanged; entering a pipeline stage still asserts the feature. The feature-off
-- condition reads the SAME resolver as assert_feature_on (resolve_feature_internal, entitlement
-- not display), fail-closed on a missing entitlement (0273's coalesce pattern).
--
-- WHY A GUARDED TEXT PATCH, NOT A FULL RESTATE: 0591 already amended this function by patching
-- its stored definition, so the source of truth is the definition at head, not any single
-- migration file. Replacing only the two anchored lines keeps every later body byte intact.
--
-- Proof: supabase/tests/project_ongoing_without_pipeline.test.sql (AC-3023). The feature-on map
-- stays pinned by project_transition_map.test.sql (AC-1000) and project_transition_map_parity.test.sql
-- (AC-2379-1), both of which run against a feature-ON organisation.
-- Rollback: supabase/migrations/rollback/2785_project_ongoing_without_pipeline_down.sql

do $$
declare
  v_tp text := pg_get_functiondef(
    'public.transition_project(uuid, public.project_status, text, date, text, text)'::regprocedure
  );
  v_elig text := pg_get_functiondef('public.project_win_eligibility(uuid)'::regprocedure);
  v_tp_old  constant text := 'if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then';
  v_tp_new  constant text := 'if p_to = v_from
     or ( not (v_legal -> v_from::text) ? p_to::text
          and not ( v_from = ''Leads'' and p_to = ''Won, Pending KoM''
                    and not coalesce((select f.enabled from public.resolve_feature_internal(v_org, ''sales_pipeline'') f), false) ) ) then';
  v_elig_old constant text := 'if v_project.status not in (''Quotation Submitted'',''Tender Submitted'',''Negotiation'') then return ''unavailable''; end if;';
  v_elig_new constant text := 'if v_project.status not in (''Quotation Submitted'',''Tender Submitted'',''Negotiation'')
     and not ( v_project.status = ''Leads''
               and not coalesce((select f.enabled from public.resolve_feature_internal(v_project.org_id, ''sales_pipeline'') f), false) ) then
    return ''unavailable'';
  end if;';
begin
  if position(v_tp_old in v_tp) = 0 then
    raise exception '2785 transition_project source anchor not found';
  end if;
  execute replace(v_tp, v_tp_old, v_tp_new);
  if position(v_elig_old in v_elig) = 0 then
    raise exception '2785 project_win_eligibility source anchor not found';
  end if;
  execute replace(v_elig, v_elig_old, v_elig_new);
end;
$$;

notify pgrst, 'reload schema';
