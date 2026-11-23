-- Reverse of 1751 (reverse 1752 first).
drop function if exists public.medical_releases_visible();
drop function if exists public.medical_release_holds(date);
drop function if exists public.medical_release_blocks(uuid, date);
drop function if exists public.medical_release_decide(uuid, text, text);
drop function if exists public.medical_release_create(uuid, date, text);
drop table if exists public.medical_releases;
drop function if exists public.medical_release_can_enter();
