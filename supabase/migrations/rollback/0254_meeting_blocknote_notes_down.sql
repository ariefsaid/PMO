-- Reverses 0254: restores 0205's project_meeting_notes() verbatim (v1 flat-text projection, version pinned to 1).
-- ⚑ Do NOT roll back while v2 (BlockNote) notes exist: the v1 app reads only top-level `text`, shows v2
-- minutes as blank lines, and the author's next save overwrites them. Export or convert v2 rows first.
create or replace function public.project_meeting_notes()
  returns trigger language plpgsql security invoker set search_path = public as $$
declare v_text text;
begin
  select coalesce(string_agg(x.t, E'\n'), '') into v_text
    from (select jsonb_array_elements(case when jsonb_typeof(new.notes) = 'array'
                                           then new.notes else '[]'::jsonb end) ->> 'text' as t) x
   where x.t is not null;
  new.notes_text   := v_text;
  new.notes_search := to_tsvector('simple', left(new.title || ' ' || v_text, 900000));
  new.notes_schema_version := 1;
  return new;
end; $$;
