import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const upPath = new URL('../supabase/migrations/0365_project_short_name.sql', import.meta.url);
const downPath = new URL('../supabase/migrations/rollback/0365_project_short_name_down.sql', import.meta.url);
const container = 'supabase_db_pmo-portal';

export function readPair(up = fs.readFileSync(upPath, 'utf8'), down = fs.readFileSync(downPath, 'utf8')) {
  return { up, down };
}

function psql(sql) {
  const result = spawnSync('docker', [
    'exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres',
  ], { input: sql, encoding: 'utf8', maxBuffer: 4_000_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'project short-name migration reversal failed');
  return result.stdout;
}

export function run() {
  if (process.env.PMO_DB_LOCK_HELD !== '1') throw new Error('Run under scripts/with-db-lock.sh.');
  const { up, down } = readPair();
  const sql = `begin;
-- A real row and alias make this a data-preservation probe, not an all-NULL schema check.
do $$ begin
  if not exists (select 1 from public.projects) then
    raise exception 'reversal probe requires the local seeded project/org fixture';
  end if;
end $$;
insert into public.projects (id, org_id, name, status, contract_value)
select '03650000-0000-0000-0000-000000000999', org_id, 'Reversal probe contractual title', 'Leads', 0
  from public.projects order by id limit 1;
update public.projects set short_name = 'Reversal probe alias'
 where id = '03650000-0000-0000-0000-000000000999';
create temporary table before_state as select id, name from public.projects;
create temporary table before_history as
 select captured - 'short_name' as unrelated, captured ? 'short_name' as had_alias
   from public.record_history_config where table_name = 'projects';

${down}

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='short_name') then
    raise exception 'down migration left projects.short_name';
  end if;
  if exists (select 1 from public.record_history_config where table_name='projects' and captured ? 'short_name') then
    raise exception 'down migration left the short_name history member';
  end if;
  perform public.get_sales_pipeline();
  perform public.search_record_references('reversal probe');
end $$;

${up}

do $$ declare v_alias text; begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='short_name') then
    raise exception 'up migration did not restore projects.short_name';
  end if;
  if not has_column_privilege('authenticated', 'public.projects', 'short_name', 'INSERT')
     or not has_column_privilege('authenticated', 'public.projects', 'short_name', 'UPDATE') then
    raise exception 'up migration did not restore short_name column grants';
  end if;
  if not exists (select 1 from public.record_history_config where table_name='projects' and captured->>'short_name'='text') then
    raise exception 'up migration did not restore short_name history classification';
  end if;
  if exists (
    select 1 from public.record_history_config c cross join before_history b
     where c.table_name='projects' and (c.captured - 'short_name') is distinct from b.unrelated
  ) then raise exception 'migration changed unrelated history configuration'; end if;
  if exists (
    select 1 from before_state b full join public.projects p using (id)
     where b.id is null or p.id is null or b.name is distinct from p.name
  ) then raise exception 'migration changed contractual project data'; end if;
  select short_name into v_alias from public.projects where id='03650000-0000-0000-0000-000000000999';
  if v_alias is not null then raise exception 'down/up unexpectedly retained the discarded optional alias'; end if;
  update public.projects set short_name='Reversal probe alias' where id='03650000-0000-0000-0000-000000000999';
  if not exists (
    select 1 from json_array_elements(public.get_sales_pipeline()->'projects') item
     where item->>'id'='03650000-0000-0000-0000-000000000999'
       and item->>'name'='Reversal probe contractual title'
       and item->>'short_name'='Reversal probe alias'
  ) then raise exception 'restored pipeline projection does not expose both project names'; end if;
end $$;
rollback;`;
  psql(sql);
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) run();
