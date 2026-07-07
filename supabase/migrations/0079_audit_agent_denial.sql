-- 0079_audit_agent_denial.sql — durable audit trail for agent AUTHORIZATION REFUSALS
-- (audit Observability-High #1). Proven by pgTAP 0136_audit_agent_denial.test.sql.
--
-- Problem. 0076 shipped `audit_events` + `log_audit()`, but `log_audit` is the SOLE writer and is
-- granted to NO client role (only postgres-owned security-definer RPCs/triggers call it). The
-- agent-chat edge function runs on the CALLER/deputy JWT (`authenticated`), so it CANNOT call
-- `log_audit` directly — yet an agent authorization REFUSAL (the handler denying a tool/action for
-- SoD/permission reasons) is a security signal (misconfigured automation, prompt-injection
-- escalation attempt) that must NOT vanish with the SSE stream.
--
-- Solution. A thin SECURITY DEFINER wrapper, `audit_agent_denial`, that IS grantable to
-- `authenticated` and stamps the identity SERVER-SIDE (non-forgeable) before calling `log_audit`:
--   • action  = 'agent.permission_denied'   (fixed literal — caller cannot choose it)
--   • org_id  = auth_org_id()               (from the live JWT profiles lookup — not a param)
--   • actor_id= auth.uid()                  (from the live JWT — not a param)
--   • entity_id = null
--   • detail  = coalesce(p_detail,'{}') || {'reason': p_reason}
-- Only `p_reason` + `p_detail` (annotation: the attempted tool/action, thread/run id) come from the
-- caller; identity + action are non-forgeable. The caller also CANNOT forge org/actor by stuffing
-- them into p_detail — log_audit ignores p_detail for those columns.
--
-- Ownership chain (why the INSERT succeeds). `audit_agent_denial` is SECURITY DEFINER owned by the
-- migration runner (postgres, BYPASSRLS), so it may call `log_audit` (also postgres-owned; postgres
-- retains implicit EXECUTE despite the `revoke from public`). `log_audit`'s own definer INSERT then
-- bypasses audit_events' FORCE RLS + absent INSERT policy — exactly the chain 0076 established for
-- operator_grant_credits / the AFTER-DELETE triggers. No new audit_events policy is created: the row
-- is readable by 0076's existing SELECT policy (own-org Admin/Operator).
--
-- Guard. `is_active_member()` entry guard (mirrors operator_grant_credits 0067): a disabled member's
-- cached JWT still drives auth.uid(), so we re-assert active membership → 42501. (Also blocks anon,
-- whose auth.uid() is null.)
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Forward-only/additive (a new
-- function; no table, no policy, no data). Manual rollback: `drop function if exists
-- public.audit_agent_denial(text, jsonb);`.

create or replace function public.audit_agent_denial(p_reason text, p_detail jsonb default '{}')
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_member() then
    raise exception 'inactive' using errcode = '42501';
  end if;
  -- action / org / actor are stamped SERVER-SIDE from the auth context → the caller cannot forge
  -- them. Only p_reason + p_detail (annotation: attempted tool/action, thread/run id) are caller-
  -- supplied, and they land ONLY in `detail`.
  perform public.log_audit(
    'agent.permission_denied',
    public.auth_org_id(),
    auth.uid(),
    null,
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
  );
end; $$;

revoke all on function public.audit_agent_denial(text, jsonb) from public;
grant execute on function public.audit_agent_denial(text, jsonb) to authenticated;
