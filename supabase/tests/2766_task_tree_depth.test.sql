begin;
select plan(4);

insert into public.organizations (id, name)
values ('27660000-0000-0000-0000-000000000001', 'Task Depth Org');
insert into public.projects (id, org_id, name, status, currency)
values ('27660000-0000-0000-0000-000000000002', '27660000-0000-0000-0000-000000000001',
        'Task Depth Project', 'Ongoing Project', 'USD');

do $$
declare
  parent_id uuid;
  task_id uuid;
begin
  for level in 1..32 loop
    insert into public.tasks (org_id, name, parent_task_id)
    values ('27660000-0000-0000-0000-000000000001', 'Depth ' || level, parent_id)
    returning id into task_id;
    parent_id := task_id;
  end loop;
end $$;

select ok(exists(select 1 from public.tasks
  where org_id = '27660000-0000-0000-0000-000000000001' and name = 'Depth 32'),
  'AC-TREE-110: depth 32 is accepted');

select throws_ok($$
  insert into public.tasks (org_id, name, parent_task_id)
  select org_id, 'Depth 33', id from public.tasks
  where org_id = '27660000-0000-0000-0000-000000000001' and name = 'Depth 32'
$$, '23514', 'TASK_TREE_DEPTH: A task can sit at most 32 levels down',
   'AC-TREE-111: adding a task at depth 33 is refused');

insert into public.tasks (org_id, name)
values ('27660000-0000-0000-0000-000000000001', 'Other root');

select throws_ok($$
  update public.tasks t set parent_task_id = p.id
  from public.tasks p
  where t.org_id = '27660000-0000-0000-0000-000000000001' and p.org_id = t.org_id
    and t.name = 'Depth 1' and p.name = 'Other root'
$$, '23514', 'TASK_TREE_DEPTH: A task can sit at most 32 levels down',
   'AC-TREE-112: reparenting a subtree cannot put its deepest task at depth 33');

update public.tasks set project_id = '27660000-0000-0000-0000-000000000002'
where org_id = '27660000-0000-0000-0000-000000000001' and name = 'Depth 1';
select is((select count(*) from public.tasks where project_id = '27660000-0000-0000-0000-000000000002'),
  32::bigint, 'AC-TREE-113: the entire depth-32 tree can still move to a project');

select * from finish();
rollback;
