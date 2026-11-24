-- Procurement Manager: organisation-wide purchase-case inspection, independent of ordering/approval.
-- Existing Project Manager SELECT policies already provide the underlying same-organisation rows;
-- this actor-scoped answer lets the product expose them without granting an action or bypassing price views.
-- No table grants, write policies, transition functions or price functions change.
begin;
create function public.actor_may_read_purchase_cases() returns boolean
 language sql stable security definer set search_path = pg_catalog, public as $$
 select not public.actor_is_light() and public.actor_holds_job_role('procurement_manager')
$$;
revoke all on function public.actor_may_read_purchase_cases() from public, anon;
grant execute on function public.actor_may_read_purchase_cases() to authenticated, service_role;
commit;
