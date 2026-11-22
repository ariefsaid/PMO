drop trigger if exists survey_record_documents_immutable on public.survey_record_documents;
drop trigger if exists survey_participants_immutable on public.survey_participants;
drop trigger if exists survey_records_immutable on public.survey_records;
drop function if exists public.guard_survey_child_immutable();
drop function if exists public.guard_survey_record_immutable();
