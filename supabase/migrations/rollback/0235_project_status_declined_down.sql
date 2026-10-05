-- Rollback for 0235. Postgres cannot DROP an enum value; the value is left in place (inert once
-- 0236's rollback has removed it from the transition map). Re-point any rows first if you must:
--   update public.projects set status = 'Loss Tender' where status::text = 'Declined';
select 1;
