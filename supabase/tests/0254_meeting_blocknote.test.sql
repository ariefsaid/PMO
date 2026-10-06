-- 0254_meeting_blocknote.test.sql — #805: meetings.notes is a BlockNote document (v2).
-- Migration under test: 0254_meeting_blocknote_notes.sql (trigger: derived version + once-only projection).
-- Spec ACs owned here: AC-MTG-001/004/009/011/012/013 + the v1-compat and version-pin oracles (AC-MTG-2xx).
begin;
select plan(11);

insert into organizations (id, name) values ('00d54000-0000-0000-0000-000000000001','BN Org');
insert into auth.users (id, email) values ('00d54000-0000-0000-0000-0000000000e1','bn-author@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('00d54000-0000-0000-0000-0000000000e1','00d54000-0000-0000-0000-000000000001','BN Author','bn-author@example.com','Engineer','active');
insert into projects (id, org_id, code, name, status) values
  ('00d54000-0000-0000-0000-000000000010','00d54000-0000-0000-0000-000000000001','BN-P','BN Project','Ongoing Project');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00d54000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- A BlockNote v2 document: heading with a nested child, a styled two-run paragraph, an action-item
-- block (props.taskId only, no content) and a table cell.
insert into meetings (id, org_id, project_id, title, notes) values (
  '00d54000-0000-0000-0000-000000000101','00d54000-0000-0000-0000-000000000001',
  '00d54000-0000-0000-0000-000000000010','BN kickoff',
  '[{"id":"a","type":"heading","props":{"level":1},"content":[{"type":"text","text":"Kickoff agenda","styles":{}}],
     "children":[{"id":"b","type":"paragraph","props":{},"content":[{"type":"text","text":"pipeline ","styles":{}},{"type":"text","text":"pressure","styles":{"bold":true}}],"children":[]}]},
    {"id":"c","type":"actionItem","props":{"taskId":"00d54000-0000-0000-0000-000000000201"},"children":[]},
    {"id":"d","type":"table","props":{},"content":{"type":"tableContent","rows":[{"cells":[[{"type":"text","text":"gantt","styles":{}}]]}]},"children":[]}]'::jsonb);

select is((select jsonb_array_length(notes) from meetings where id='00d54000-0000-0000-0000-000000000101'), 3,
  'AC-MTG-001 a BlockNote document is stored verbatim as one jsonb array on the meeting row (no per-block rows)');

select is((select notes -> 1 from meetings where id='00d54000-0000-0000-0000-000000000101'),
  '{"id":"c","type":"actionItem","props":{"taskId":"00d54000-0000-0000-0000-000000000201"},"children":[]}'::jsonb,
  'AC-MTG-002 the stored actionItem block carries props.taskId only and has no content key (DD-MTG-2)');

select is((select notes_schema_version from meetings where id='00d54000-0000-0000-0000-000000000101'), 2::smallint,
  'AC-MTG-009 a BlockNote document is stamped notes_schema_version = 2 by the trigger');

select is((select notes_text from meetings where id='00d54000-0000-0000-0000-000000000101'),
  E'Kickoff agenda\npipeline \npressure\ngantt',
  'AC-MTG-011 notes_text holds each text run EXACTLY once — nested children and table cells included, document order');

select is((select count(*)::int from meetings where notes_search @@ websearch_to_tsquery('simple','gantt')), 1,
  'AC-MTG-010 a term inside a nested table cell is findable via notes_search');

-- AC-MTG-012: editing the paragraph re-indexes — the old term stops matching, the new one matches.
update meetings set notes = jsonb_set(notes, '{0,children,0,content,0,text}', '"budget "') where id='00d54000-0000-0000-0000-000000000101';
select is((select count(*)::int from meetings where notes_search @@ websearch_to_tsquery('simple','pipeline')), 0,
  'AC-MTG-012 after the paragraph is edited the OLD term no longer matches');
select is((select count(*)::int from meetings where notes_search @@ websearch_to_tsquery('simple','budget')), 1,
  'AC-MTG-012 …and the NEW term matches');

-- AC-MTG-013: the referenced task's name is not meeting text — the block holds only an id.
reset role;
insert into tasks (id, org_id, project_id, name, status, meeting_id) values
  ('00d54000-0000-0000-0000-000000000201','00d54000-0000-0000-0000-000000000001',
   '00d54000-0000-0000-0000-000000000010','Zeppelin mooring check','To Do','00d54000-0000-0000-0000-000000000101');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00d54000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from meetings where notes_search @@ websearch_to_tsquery('simple','zeppelin')), 0,
  'AC-MTG-013 a term that exists only in a referenced task NAME does not return the meeting');

-- AC-MTG-004: removing the block from the note leaves the task row untouched.
update meetings set notes = notes - 1 where id='00d54000-0000-0000-0000-000000000101';
select is((select count(*)::int from tasks where id='00d54000-0000-0000-0000-000000000201'), 1,
  'AC-MTG-004 deleting the actionItem block and saving the note does not delete the task (FR-MTG-018)');

-- Version is derived from shape and server-pinned (FR-MTG-005): v1 lines stay 1, a client PATCH cannot move it.
update meetings set notes = '[{"type":"p","text":"legacy line"}]'::jsonb, notes_schema_version = 9
 where id='00d54000-0000-0000-0000-000000000101';
select is((select notes_schema_version from meetings where id='00d54000-0000-0000-0000-000000000101'), 1::smallint,
  'AC-MTG-202 a v1 line note is version 1 and a client-supplied version never sticks (FR-MTG-005)');
select is((select notes_text from meetings where id='00d54000-0000-0000-0000-000000000101'), 'legacy line',
  'AC-MTG-203 the v1 flat-text projection is unchanged by the v2 trigger');

select * from finish();
rollback;
