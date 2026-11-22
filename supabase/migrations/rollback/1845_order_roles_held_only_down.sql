-- Reverses 1845: the 1842 body of actor_may_order_purchases (taken from the live definition).
CREATE OR REPLACE FUNCTION public.actor_may_order_purchases()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce((
    select bool_or(public.holds_job_role(auth.uid(), k))
      from public.purchase_order_settings s cross join lateral unnest(s.order_job_roles) k
     where s.org_id = public.auth_org_id()), false)
$function$;

