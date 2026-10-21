import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const upPath = new URL('../supabase/migrations/0336_m365_record_folders.sql', import.meta.url);
const downPath = new URL('../supabase/migrations/rollback/0336_m365_record_folders_down.sql', import.meta.url);
const container = 'supabase_db_pmo-portal';
export function readPair(up = fs.readFileSync(upPath,'utf8'), down = fs.readFileSync(downPath,'utf8')) {
  return { up, down };
}
function psql(sql) {
  const result = spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8',maxBuffer:2_000_000});
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'local catalog reversal failed');
  return result.stdout;
}
export function run() {
  if (process.env.PMO_DB_LOCK_HELD !== '1') throw new Error('Run under scripts/with-db-lock.sh.');
  const {up,down}=readPair();
  const names=['m365_link_record_folder','m365_record_folder_created','m365_record_folder_candidates','m365_record_folder_default_matches'];
  const indexes=['project_documents_folder_parent_idx','procurement_documents_folder_parent_idx','m365_folder_created_identity_idx'];
  const exists = names.map(n=>`to_regprocedure('public.${n}(text,uuid,jsonb,text,text,timestamptz)')`).join(',');
  const sql=`begin;
create temporary table before_state as select (select count(*) from public.project_documents) p,(select count(*) from public.procurement_documents) c,(select count(*) from public.audit_events) a;
${down}
do $$ begin if exists(select 1 from pg_indexes where schemaname='public' and indexname in (${indexes.map(x=>`'${x}'`).join(',')})) then raise exception 'rollback left index'; end if; end $$;
${up}
do $$ begin if not exists(select 1 from pg_indexes where schemaname='public' and indexname in (${indexes.map(x=>`'${x}'`).join(',')}) group by schemaname having count(*)=3) then raise exception 'migration did not restore its indexes'; end if; end $$;
rollback;`;
  psql(sql);
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) run();
