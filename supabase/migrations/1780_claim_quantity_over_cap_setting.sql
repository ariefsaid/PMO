-- 1780_claim_quantity_over_cap_setting.sql — survey-cap-stop (part B): the organisation setting that decides whether the database
-- refuses a claim line above what can still be claimed. 'warn' (default) = today's behaviour for everyone; 'block' = refuse.
-- Admin-only, audited before and after (the quantity_change_limit pattern, 1176 §1). Reversal: rollback/1780_claim_quantity_over_cap_setting_down.sql.
alter table public.organizations add column claim_quantity_over_cap text not null default 'warn'
  constraint organizations_claim_quantity_over_cap_check check (claim_quantity_over_cap in ('warn', 'block'));
comment on column public.organizations.claim_quantity_over_cap is
  'survey-cap-stop / OD-SCOPE-6: warn (default) lets a claim line pass the claimable quantity; block makes the database refuse it. Admin-only, audited.';
create policy organizations_update_claim_quantity_over_cap on public.organizations for update
  using (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin')
  with check (id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) = 'Admin');
grant update (claim_quantity_over_cap) on public.organizations to authenticated;

create function public.audit_org_claim_quantity_over_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.claim_quantity_over_cap is distinct from old.claim_quantity_over_cap then
    perform public.log_audit('org.claim_quantity_over_cap.change', new.id, auth.uid(), new.id,
      jsonb_build_object('from', old.claim_quantity_over_cap, 'to', new.claim_quantity_over_cap));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_claim_quantity_over_cap() from public, anon, authenticated;
create trigger organizations_audit_claim_quantity_over_cap after update on public.organizations
  for each row execute function public.audit_org_claim_quantity_over_cap();
