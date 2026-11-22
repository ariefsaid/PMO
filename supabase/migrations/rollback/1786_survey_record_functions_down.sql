drop function if exists public.confirm_survey(uuid);
drop function if exists public.archive_survey_draft(uuid);
drop function if exists public.attach_survey_document(uuid, uuid);
drop function if exists public.survey_lock_draft(uuid);
drop function if exists public.record_survey(uuid, uuid, date, numeric, numeric, jsonb, uuid, text);
drop function if exists public.survey_lock_work_order(uuid);
