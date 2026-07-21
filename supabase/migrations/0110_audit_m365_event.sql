-- 0108_audit_m365_event.sql — service-role-callable audit wrapper for the m365-token-custody edge fn
-- (FR-M365-170, NFR-M365-108). log_audit (0076) is revoked from public and callable only by
-- postgres-owned SECURITY DEFINER fns; the edge fn is service_role and its OAuth callback path has no
-- caller JWT, so it passes org/actor explicitly through this wrapper (cf. audit_agent_denial 0079,
-- which is authenticated-only and stamps from auth context).
-- Reversibility (ADR-0006): supabase db reset. Manual reverse:
--   drop function if exists public.audit_m365_event(text, uuid, uuid, uuid, jsonb);

create or replace function public.audit_m365_event(
  p_action    text,
  p_org_id    uuid,
  p_actor_id  uuid,
  p_entity_id uuid,
  p_detail    jsonb default '{}'::jsonb
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  -- Allowlist: this service_role-granted wrapper may ONLY write m365.* audit actions.
  if p_action is null or p_action not like 'm365.%' then
    raise exception 'audit_m365_event: action must be m365.*' using errcode = '22023';
  end if;
  perform public.log_audit(p_action, p_org_id, p_actor_id, p_entity_id, coalesce(p_detail, '{}'::jsonb));
end $$;

revoke all on function public.audit_m365_event(text, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.audit_m365_event(text, uuid, uuid, uuid, jsonb) to service_role;