-- fix/walk-people item 1 (AC-PPL-LEFT-001..003): person_mark_left moves a person to former staff and ends their crew memberships.
begin;
select plan(6);
select has_function('public', 'person_mark_left', array['uuid', 'date'], 'AC-PPL-LEFT-001 the function exists');
select is((select prosecdef from pg_proc where proname = 'person_mark_left'), true, 'AC-PPL-LEFT-001 it is security definer');
select ok((select prosrc from pg_proc where proname = 'person_mark_left') like '%perform public.assert_is_active_member();%', 'AC-PPL-LEFT-001 it keeps the literal active-member assertion');
select ok((select prosrc from pg_proc where proname = 'person_mark_left') like '%perform public.assert_not_light();%', 'AC-PPL-LEFT-001 it keeps the light-account assertion');
select ok(not has_function_privilege('anon', 'public.person_mark_left(uuid, date)', 'execute'), 'AC-PPL-LEFT-002 anon cannot call it');
select ok(has_function_privilege('authenticated', 'public.person_mark_left(uuid, date)', 'execute'), 'AC-PPL-LEFT-002 an authenticated user can call it (the body is Admin-only)');
select * from finish();
rollback;
