begin;
select plan(2);

select ok(position('get diagnostics v_locked_count = row_count' in lower(pg_get_functiondef(
  'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)'::regprocedure))) > 0,
  'AC-MONEY-004 pricing captures the number of locked BoQ rows');
select ok(position('v_locked_count <> jsonb_array_length(p_lines)' in lower(pg_get_functiondef(
  'public.create_progress_claim(uuid,text,uuid,jsonb,numeric,numeric,boolean)'::regprocedure))) > 0,
  'AC-MONEY-004 pricing refuses an incomplete BoQ lock set');

select * from finish();
rollback;
