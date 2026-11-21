import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { requireServiceRoleKey, SEED_PASSWORD } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

/**
 * #2578 quantity change journeys: one self-isolated contract line that is OVER its contract quantity (C 100, assessed 120,
 * allocated 60 on an Issued work order), and a clean-up that removes only that project's rows in dependency order.
 */
export const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const env = loadEnv('development', process.cwd(), 'VITE_');
export const SUPABASE_URL = requireMatchingLocalSupabaseUrls(
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL,
);

export interface QcrFixture { admin: SupabaseClient; projectId: string; workOrderId: string; boqItemId: string; tag: string; pmId: string; financeId: string }

const ok = (step: string, e: { message: string } | null) => { if (e) throw new Error(`QCR fixture ${step}: ${e.message}`); };

export async function makeFixture(label: string): Promise<QcrFixture> {
  const key = requireServiceRoleKey();
  if (!key) throw new Error(`${label} needs SUPABASE_SERVICE_ROLE_KEY — run it via scripts/e2e-local.sh, which exports it`);
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const tag = `${label} ${Date.now()}`;
  const people = await admin.from('profiles').select('id, email').in('email', ['pm@acme.test', 'finance@acme.test']);
  ok('people', people.error);
  const pmId = people.data!.find((p) => p.email === 'pm@acme.test')!.id as string;
  const financeId = people.data!.find((p) => p.email === 'finance@acme.test')!.id as string;
  const project = await admin.from('projects').insert({ org_id: ORG_ID, name: tag, status: 'Ongoing Project', project_manager_id: pmId }).select('id').single();
  ok('project', project.error);
  const projectId = project.data!.id as string;
  const wo = await admin.from('work_orders').insert({
    org_id: ORG_ID, project_id: projectId, title: `${tag} work order`, status: 'Issued', order_value: 10000, tax_treatment: 'exclusive', tax_amount: 0,
  }).select('id').single();
  ok('work order', wo.error);
  const boq = await admin.from('boq_items').insert({
    org_id: ORG_ID, project_id: projectId, item_code: 'EXC', description: 'Excavation', unit: 'm3', quantity: 100, rate: 50,
  }).select('id').single();
  ok('contract line', boq.error);
  ok('allocation', (await admin.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: wo.data!.id, boq_item_id: boq.data!.id, quantity: 60 })).error);
  const entry = await admin.from('project_progress_entries').insert({ org_id: ORG_ID, project_id: projectId, month: '2026-02-01', pct_complete: 50 }).select('id').single();
  ok('progress entry', entry.error);
  ok('assessed quantity', (await admin.from('progress_assessment_quantities').insert({ org_id: ORG_ID, entry_id: entry.data!.id, boq_item_id: boq.data!.id, quantity_to_date: 120 })).error);
  return { admin, projectId, workOrderId: wo.data!.id as string, boqItemId: boq.data!.id as string, tag, pmId, financeId };
}

/** Everything this journey made, in dependency order; uploaded objects go last (a file row restricts its object). */
export async function cleanFixture(f: QcrFixture | undefined): Promise<void> {
  if (!f) return;
  const { admin, projectId } = f;
  const requests = await admin.from('quantity_change_requests').select('id').eq('project_id', projectId);
  ok('requests', requests.error);
  const ids = (requests.data ?? []).map((r) => r.id as string);
  const files = ids.length ? await admin.from('quantity_change_request_files').select('file_path').in('request_id', ids) : { data: [], error: null };
  ok('files', files.error);
  const paths = (files.data ?? []).map((x) => x.file_path as string);
  if (ids.length) ok('request lines', (await admin.from('quantity_change_request_lines').delete().in('request_id', ids)).error);
  ok('notices', (await admin.from('quantity_overrun_notices').delete().eq('boq_item_id', f.boqItemId)).error);
  ok('assessed quantities', (await admin.from('progress_assessment_quantities').delete().eq('boq_item_id', f.boqItemId)).error);
  ok('progress entries', (await admin.from('project_progress_entries').delete().eq('project_id', projectId)).error);
  ok('allocations', (await admin.from('work_order_lines').delete().eq('work_order_id', f.workOrderId)).error);
  // versions, forecasts and notices go with the contract line (the cascade the append-only triggers allow)
  ok('contract lines', (await admin.from('boq_items').delete().eq('project_id', projectId)).error);
  if (ids.length) {
    ok('requests', (await admin.from('quantity_change_requests').delete().in('id', ids)).error);
    await admin.from('notifications').delete().in('metadata->entity->>id', ids);
  }
  await admin.from('notifications').delete().eq('metadata->entity->>id', projectId);
  ok('work orders', (await admin.from('work_orders').delete().eq('project_id', projectId)).error);
  ok('project', (await admin.from('projects').delete().eq('id', projectId)).error);
  if (paths.length) await admin.storage.from('quantity-change-files').remove(paths);
}

/** Act as a seeded user through the real functions (the journeys' own setup for steps that are not the point of the test). */
export async function asUser(email: string): Promise<SupabaseClient> {
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  if (!anon) throw new Error('QCR fixture needs VITE_SUPABASE_ANON_KEY');
  const client = createClient(SUPABASE_URL, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  ok(`sign in ${email}`, error);
  return client;
}
