-- 1651_end_rental_term_client_grant.sql — the equipment manager may end a rental period (AC-EQM-001).
-- end_equipment_rental_term (1032) had no client grant because no screen called it. The rule is stated as an acceptance
-- criterion (a Project Manager ends a rental period) and 1600 widened its role check, so it is now granted to signed-in
-- members. The body is 1032's, plus the field-account guard every office definer carries (1530); the role check
-- (equipment_can_edit_terms) and the organisation check (the period must belong to the caller's organisation) are unchanged.
-- Granted to authenticated only; never to public or anon.
-- Reversal: supabase/migrations/rollback/1651_end_rental_term_client_grant_down.sql
create or replace function public.end_equipment_rental_term(p_id uuid, p_to date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_t public.equipment_rental_terms;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  if not public.equipment_can_edit_terms(public.auth_role()) then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_t from public.equipment_rental_terms t where t.id = p_id and t.org_id = v_org for update;
  if not found then raise exception 'rental period not found' using errcode = 'P0002'; end if;
  if p_to is null or p_to < v_t.rented_from then raise exception 'the end precedes the start' using errcode = '22023'; end if;
  update public.equipment_rental_terms set rented_to = p_to where id = p_id;
  perform public.log_audit('equipment_rental.end', v_org, auth.uid(), p_id, jsonb_build_object('before', v_t.rented_to, 'after', p_to));
end $$;
revoke all on function public.end_equipment_rental_term(uuid, date) from public, anon, authenticated;
grant execute on function public.end_equipment_rental_term(uuid, date) to authenticated;
