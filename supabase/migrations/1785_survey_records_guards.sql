-- 1785_survey_records_guards.sql — survey-cap-record: a confirmed record is history. Its figures, participants and documents never change
-- and nothing is deleted; the only later change to a confirmed record is being superseded by its correction (stamped by confirm_survey).
-- Reversal: rollback/1785_survey_records_guards_down.sql.
create function public.guard_survey_record_immutable() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SVY_FROZEN: a survey record cannot be deleted; discard a draft or record a correction' using errcode = '42501';
  end if;
  if old.status = 'confirmed'
     and (to_jsonb(new) - 'superseded_at') is distinct from (to_jsonb(old) - 'superseded_at') then
    raise exception 'SVY_FROZEN: a confirmed survey record cannot be changed; record a correction instead' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_survey_record_immutable() from public, anon, authenticated;
create trigger survey_records_immutable before update or delete on public.survey_records
  for each row execute function public.guard_survey_record_immutable();

create function public.guard_survey_child_immutable() returns trigger
  language plpgsql set search_path = public as $$
declare v_status text; v_rec uuid := coalesce(new.record_id, old.record_id);
begin
  select r.status into v_status from public.survey_records r where r.id = v_rec;
  if v_status is distinct from 'draft' then
    raise exception 'SVY_FROZEN: a confirmed survey record cannot be changed; record a correction instead' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function public.guard_survey_child_immutable() from public, anon, authenticated;
create trigger survey_participants_immutable before insert or update or delete on public.survey_participants
  for each row execute function public.guard_survey_child_immutable();
create trigger survey_record_documents_immutable before insert or update or delete on public.survey_record_documents
  for each row execute function public.guard_survey_child_immutable();
