-- Down for 0898: restores assert_project_document_update() to its 0178 body, verbatim.
create or replace function public.assert_project_document_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority — including set_document_file_path (0025) and transition_document_status
  -- (0017), both SECURITY DEFINER owned by postgres. ADR-0069.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- TOTAL comparisons throughout (0176 §6). `old.status is distinct from 'Draft'` is TRUE for a NULL
  -- status too, which is the fail-closed direction.
  if old.status is distinct from 'Draft'
     and new.file_path is distinct from old.file_path
  then
    raise exception
      'project_documents."%" is % and its file cannot be replaced from the client: the approval in transition_document_status (nobody approves their own document) attests to the FILE THAT WAS APPROVED, so swapping it afterwards would defeat that rule on the goal rather than on the transition — raise a revision instead',
      old.title, old.status
      using errcode = '42501';
  end if;

  return new;
end; $$;
