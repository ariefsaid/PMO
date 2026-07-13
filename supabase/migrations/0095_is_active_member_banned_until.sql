-- 0095_is_active_member_banned_until.sql — close the raw-ban gap in the app-wide active-member gate.
--
-- Context (ADR-0057 Task 3): is_active_member() (0062) is conjoined into EVERY business-table RLS
-- policy (0063) and is the sole app-wide "is this caller still allowed to act" gate. It previously
-- checked ONLY profiles.status='active'. It did NOT check auth.users.banned_until — so a caller
-- banned out-of-band via the Supabase dashboard / direct SQL (banned_until set, but profiles.status
-- left 'active') retained their FULL capability set until token expiry (≤ jwt_expiry). The app's own
-- offboarding control admin_set_user_status (0065) sets BOTH status='disabled' and banned_until, so
-- app-driven disables were already covered; this closes the manual-ban path too.
--
-- This matters most for the ADR-0057 Task-3 edge functions that dropped auth.getUser (compose-view,
-- adapter-dispatch, agent-chat): they now rely on this RLS as their active-member check, so pushing
-- the banned_until check DOWN into is_active_member() closes their residual raw-ban gap in ONE place,
-- for all ~30 is_active_member-gated policies at once — instead of a per-function getUser (which would
-- be inconsistent security theater, plugging one function while a raw-banned user still reads/writes
-- every other table).
--
-- Semantics: a user is BANNED while banned_until is in the FUTURE (GoTrue's rule). So "active" means
-- status='active' AND (banned_until IS NULL OR banned_until <= now()). Security DEFINER + pinned
-- search_path unchanged (bypasses RLS to avoid recursion when conjoined into profiles_select itself,
-- 0062/0063). The join is on PKs (profiles.id = auth.users.id), both indexed — negligible cost.
--
-- Reversibility (ADR-0006): supabase db reset. Manual reverse = restore the 0062 body:
--   create or replace function public.is_active_member() returns boolean
--     language sql stable security definer set search_path = public as $$
--     select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
--   $$;

create or replace function public.is_active_member() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and p.status = 'active'
      and (u.banned_until is null or u.banned_until <= now())
  )
$$;
