// @e2e-isolation: serial — updates the org's shared ERP project map; uses a prepared disposable ERP binding.
import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {signInAdmin} from './_sarHelpers';
const FUNCTIONS_URL=process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL=process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY=process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL=process.env.ERPNEXT_BENCH_URL ?? '';
const BENCH_KEY=process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET=process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const ORG_ID=process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const READY=Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_URL && BENCH_KEY && BENCH_SECRET);
if(FUNCTIONS_URL && !READY)throw new Error('AC-SETUP-001: the served setup lane requires its disposable ERP fixture.');
test.skip(!READY,'AC-SETUP-001 requires the prepared local served setup lane and disposable ERP binding.');
test.setTimeout(90_000);
test('AC-SETUP-001 a saved native project links to the actual ERP Project and retry reuses that identity',async()=>{
 const admin=createClient(AUTH_URL,SERVICE_KEY);const token=await signInAdmin(AUTH_URL,ANON_KEY);
 const user=createClient(AUTH_URL,ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});
 const {data:binding,error:bindingError}=await admin.from('external_org_bindings').select('config,site_url,activated_at').eq('org_id',ORG_ID).eq('external_tier','erpnext').single();
 expect(bindingError).toBeNull();expect(binding?.activated_at).toBeTruthy();expect(binding?.site_url).toMatch(/^https:\/\//);expect(binding?.config?.company).toEqual(expect.any(String));
 const id=crypto.randomUUID();const name=`Setup Delivery ${crypto.randomUUID()}`;let erpProject:string|undefined;
 const {data:clients,error:clientError}=await user.from('companies').select('id').eq('type','Client').limit(1);expect(clientError).toBeNull();expect(clients?.length).toBe(1);
 try{
  const {error:createError}=await user.from('projects').insert({id,name,client_id:clients![0].id,status:'Leads',contract_value:0});
  expect(createError).toBeNull();
  const ensure=async()=>{
   const response=await fetch(`${FUNCTIONS_URL}/functions/v1/external-set-company`,{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON_KEY,Authorization:`Bearer ${token}`},body:JSON.stringify({tier:'erpnext',setupAction:'ensure-project',projectId:id})});
   const result=await response.json();expect(response.status,'The authenticated setup request must complete').toBe(200);expect(result).toMatchObject({ok:true,erpProject:expect.any(String)});return result.erpProject as string;
  };
  erpProject=await ensure();expect(await ensure()).toBe(erpProject);
  const {data:stored,error:storedError}=await admin.from('external_org_bindings').select('config').eq('org_id',ORG_ID).eq('external_tier','erpnext').single();expect(storedError).toBeNull();expect(stored?.config.project_map[id]).toBe(erpProject);
  const readback=await fetch(`${BENCH_URL}/api/resource/Project/${encodeURIComponent(erpProject)}`,{headers:{Authorization:`token ${BENCH_KEY}:${BENCH_SECRET}`}});expect(readback.status).toBe(200);expect((await readback.json()).data).toMatchObject({name:erpProject,project_name:name,company:binding!.config.company,is_active:'Yes'});
  const {count,error:countError}=await user.from('projects').select('id',{head:true,count:'exact'}).eq('id',id);expect(countError).toBeNull();expect(count).toBe(1);
 }finally{
  const {error:restoreError}=await admin.from('external_org_bindings').update({config:binding!.config}).eq('org_id',ORG_ID).eq('external_tier','erpnext');expect(restoreError).toBeNull();
  const {error:deleteError}=await admin.from('projects').delete().eq('id',id);expect(deleteError).toBeNull();
  if(erpProject){const removed=await fetch(`${BENCH_URL}/api/resource/Project/${encodeURIComponent(erpProject)}`,{method:'DELETE',headers:{Authorization:`token ${BENCH_KEY}:${BENCH_SECRET}`}});expect(removed.ok).toBe(true);}
 }
});
