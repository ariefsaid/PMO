import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const container='supabase_db_pmo-portal';
const ids={org:'10200000-0000-0000-0000-000000000031',u1:'10200000-0000-0000-0000-000000000131',u2:'10200000-0000-0000-0000-000000000132',project:'10200000-0000-0000-0000-000000000231',case:'10200000-0000-0000-0000-000000000232'};
function sqlAsAdmin(sql) {
  const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8'});
  if(r.status!==0) throw new Error(r.stderr||r.stdout||'race fixture SQL failed');
  return r.stdout;
}
function rpc(kind,id,item,actor) {
 return `set role authenticated; set request.jwt.claims='{"sub":"${actor}","role":"authenticated"}';
 select public.m365_link_record_folder('${kind}','${id}','{"drive_id":"synthetic-drive","item_id":"${item}","web_url":"https://example.invalid/${item}","name":"Synthetic folder","item_kind":"folder"}'::jsonb,'synthetic-site','synthetic-drive',(select updated_at from public.org_m365_document_settings where org_id='${ids.org}'));`;
}
function start(sql) {
 const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);
 let out='',err=''; child.stdout.on('data',x=>out+=x); child.stderr.on('data',x=>err+=x);
 child.stdin.end(sql);
 return {child,output:()=>out,error:()=>err,done:new Promise((resolve,reject)=>child.on('close',code=>code===0?resolve():reject(new Error(err||out||`psql exit ${code}`))))};
}
async function race(kind,id,rowTable,foreignCol) {
 const first=`begin; ${rpc(kind,id,`winner-${kind}`,ids.u1)} select pg_sleep(1.5); commit;`;
 const a=start(first);
 await delay(250);
 const b=start(rpc(kind,id,`loser-${kind}`,ids.u2));
 await delay(300);
 if(b.child.exitCode!==null) throw new Error(`${kind} loser did not wait for the record lock`);
 await Promise.all([a.done,b.done]);
 const state=sqlAsAdmin(`select count(*)||':'||min(ms_item_id) from public.${rowTable} where ${foreignCol}='${id}' and source='onedrive' and ms_item_kind='folder';` ).trim();
 if(state!==`1:winner-${kind}`) throw new Error(`${kind} race winner mismatch: ${state}`);
 const action=kind==='project'?'project_document.m365_linked':'procurement_document.m365_linked';
 const audits=sqlAsAdmin(`select count(*) from public.audit_events where action='${action}' and entity_id in (select id from public.${rowTable} where ${foreignCol}='${id}' and ms_item_kind='folder');`).trim();
 if(audits!=='1') throw new Error(`${kind} race emitted ${audits} link events`);
}
export async function runRace() {
 if(process.env.PMO_DB_LOCK_HELD!=='1') throw new Error('Run under scripts/with-db-lock.sh.');
 const i=ids;
 try {
  sqlAsAdmin(`insert into public.organizations(id,name) values ('${i.org}','Synthetic race org');
 insert into auth.users(id,email) values ('${i.u1}','race-one@example.invalid'),('${i.u2}','race-two@example.invalid');
 insert into public.profiles(id,org_id,full_name,email,role,status) values
 ('${i.u1}','${i.org}','Synthetic writer one','race-one@example.invalid','Project Manager','active'),
 ('${i.u2}','${i.org}','Synthetic writer two','race-two@example.invalid','Finance','active');
 insert into public.projects(id,org_id,name,status) values ('${i.project}','${i.org}','Synthetic race project','Ongoing Project');
 insert into public.procurements(id,org_id,title,status) values ('${i.case}','${i.org}','Synthetic race case','Draft');
 insert into public.org_m365_document_settings(org_id,default_site_id,default_site_name,default_drive_id,default_drive_name,updated_by)
 values ('${i.org}','synthetic-site','Synthetic site','synthetic-drive','Synthetic library','${i.u1}');`);
  await race('project',i.project,'project_documents','project_id');
  await race('procurement',i.case,'procurement_documents','procurement_id');
  sqlAsAdmin(`set role authenticated; set request.jwt.claims='{"sub":"${i.u1}","role":"authenticated"}';
 insert into public.project_documents(project_id,category,title,status,author_id,source,ms_drive_id,ms_item_id,ms_web_url,ms_item_name,ms_item_kind)
 values ('${i.project}','Reference','Manual one','Draft','${i.u1}','onedrive','synthetic-drive','manual-one','https://example.invalid/manual-one','Manual one','folder'),
 ('${i.project}','Reference','Manual two','Draft','${i.u1}','onedrive','synthetic-drive','manual-two','https://example.invalid/manual-two','Manual two','folder');
 reset role;
 do $$ begin if (select count(*) from public.project_documents where project_id='${i.project}' and ms_item_id like 'manual-%')<>2 then raise exception 'manual folder inserts remain allowed'; end if; end $$;`);
 } finally {
  sqlAsAdmin(`delete from public.audit_events where org_id='${i.org}'; delete from public.project_documents where project_id='${i.project}'; delete from public.procurement_documents where procurement_id='${i.case}'; delete from public.org_m365_document_settings where org_id='${i.org}'; delete from public.procurements where id='${i.case}'; delete from public.projects where id='${i.project}'; delete from public.profiles where id in ('${i.u1}','${i.u2}'); delete from auth.users where id in ('${i.u1}','${i.u2}'); delete from public.organizations where id='${i.org}';`);
 }
}
if (process.argv[1]?.endsWith('m365-record-folder-race.mjs')) await runRace();
