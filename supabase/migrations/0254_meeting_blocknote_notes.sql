-- 0254_meeting_blocknote_notes.sql — #805: meetings.notes becomes a BlockNote document (v2).
-- v1 notes were `[{"type":"p","text":…}]` (the line editor, #526); v2 is BlockNote's Block[] verbatim
-- (FR-MTG-002: the schema still asserts only "array"). Existing v1 rows are upgraded ONE-WAY by the
-- client on load and written back as v2 on the next save — no data migration, nothing is rewritten here.
--
-- This replaces project_meeting_notes() (0205) in two respects, both server-owned (FR-MTG-005/007):
--   1. notes_schema_version is DERIVED from the document's shape, never client-supplied: 2 when the
--      array is empty or any top-level element carries `children` (every BlockNote block does, no v1
--      line does), else 1. A raw PATCH of the column still cannot move it.
--   2. notes_text collects every text run EXACTLY ONCE (FR-MTG-008) from both shapes — the v1 `text`
--      key and BlockNote's nested `content`/`children`/table-cell runs. `strict $.**.text` (spec §7:
--      the lax form emits every run twice); the `string` filter keeps a non-string `text` out.
-- notes_search keeps the 'simple' config and the 900k-char bound (INFO-7); task names are NOT part of
-- the projection (AC-MTG-013) — an action-item block holds only a task id.
-- Reversal: supabase/migrations/rollback/0254_meeting_blocknote_notes_down.sql
-- Proven by supabase/tests/0254_meeting_blocknote.test.sql.

create or replace function public.project_meeting_notes()
  returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_doc  jsonb := case when jsonb_typeof(new.notes) = 'array' then new.notes else '[]'::jsonb end;
  v_text text;
begin
  select coalesce(string_agg(r, E'\n'), '') into v_text
    from jsonb_array_elements_text(
           jsonb_path_query_array(v_doc, 'strict $.**.text ? (@.type() == "string")')) as r;
  new.notes_text   := v_text;
  new.notes_search := to_tsvector('simple', left(new.title || ' ' || v_text, 900000));
  new.notes_schema_version :=
    case when jsonb_array_length(v_doc) = 0
           or jsonb_path_exists(v_doc, 'strict $[*] ? (exists(@.children))')
         then 2 else 1 end;
  return new;
end; $$;
