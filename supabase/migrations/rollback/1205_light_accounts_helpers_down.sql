-- reverse 1206..1209 first
drop function if exists public.light_can_see_work_order(uuid);
drop function if exists public.light_can_see_crew_member(uuid, uuid);
drop function if exists public.light_can_see_crew(uuid);
drop function if exists public.assert_not_light();
drop function if exists public.actor_is_light();
drop function if exists public.profile_seat_type(uuid);
drop function if exists public.is_light_role_key(text);
