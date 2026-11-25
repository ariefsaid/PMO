import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SEED_PASSWORD } from '../helpers';
import { ORG_ID, serviceClient } from './jobFixtures';

/** Seed ids (supabase/seed.sql): the Engineer, and the delivery project the delivery-milestone journey leaves with no BoQ. */
export const ENGINEER_ID = '00000000-0000-0000-0000-0000000000a4';
export const SEED_PROJECT_ID = '40000000-0000-0000-0000-000000000013';
export const SEED_PROJECT_NAME = 'Seabridge Terminal Delivery';

// scripts/e2e-local.sh already exports these; fall back to the CLI only when run another way (concurrent `supabase status` calls fail under load).
const FROM_RUN_ENV: Record<string, string | undefined> = { API_URL: process.env.SUPABASE_URL, ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY };
function readSupabaseEnv(name: string): string {
  const exported = FROM_RUN_ENV[name];
  if (exported) return exported;
  const output = execSync('supabase status -o env', { encoding: 'utf8' });
  const match = output.match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
  if (!match) throw new Error(`Missing ${name} from supabase status -o env`);
  return match[1];
}

/** A client signed in as a seed user. Stock RPCs refuse a service-role call (no auth.uid()), so fixtures use a real JWT. */
export async function userClient(email: string): Promise<SupabaseClient> {
  const client = createClient(readSupabaseEnv('API_URL'), readSupabaseEnv('ANON_KEY'), { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

function must<T>(r: { data: unknown; error: { message: string } | null }, what: string): T {
  if (r.error || r.data === null || r.data === undefined) throw new Error(`${what}: ${r.error?.message ?? 'no data'}`);
  return r.data as T;
}

/** The append-only ledger cannot be cleaned (PQ-10), so every code carries a per-run suffix. */
export const runSuffix = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.toUpperCase();

export async function makeItem(admin: SupabaseClient, sfx: string, tag = 'I') {
  const unit = must<{ id: string }>(await admin.from('stock_units').insert({ code: `E2E-U${sfx}`, name: `E2E unit ${sfx}`, whole_only: true }).select('id').single(), 'unit');
  const item = must<{ id: string; code: string; name: string }>(await admin.from('stock_items').insert({ code: `E2E-${tag}${sfx}`, name: `E2E item ${sfx}`, unit_id: unit.id }).select('id, code, name').single(), 'item');
  return item;
}
export async function makeWarehouse(admin: SupabaseClient, sfx: string, tag: string, kind: 'central' | 'site' | 'vendor', projectId?: string) {
  const wh = must<{ id: string; code: string; name: string }>(
    await admin.from('stock_warehouses').insert({
      code: `E2E-${tag}${sfx}`,
      name: `E2E ${tag} ${sfx}`,
      kind,
      ...(projectId ? { project_id: projectId } : {}),
    }).select('id, code, name').single(),
    'warehouse',
  );
  return wh;
}
export async function makeWorkItem(admin: SupabaseClient, sfx: string) {
  const b = must<{ id: string; item_code: string; description: string }>(await admin.from('boq_items').insert({ project_id: SEED_PROJECT_ID, item_code: `E2E-W${sfx}`, description: `E2E work ${sfx}`, unit: 'm3', quantity: 10, rate: 1000 }).select('id, item_code, description').single(), 'boq');
  return b;
}
export async function keeperOf(admin: SupabaseClient, warehouseId: string, userId = ENGINEER_ID) {
  const { error } = await admin.rpc('set_stock_warehouse_keeper', { p_warehouse_id: warehouseId, p_user_id: userId, p_assigned: true });
  if (error) throw new Error(`keeper: ${error.message}`);
}
export async function postReceive(client: SupabaseClient, warehouseId: string, itemId: string, qty: string, cost = '25') {
  // A plain receive is refused while the org's order-receiving switch is on (RGO_USE_ORDER); serial journeys leave it on. Turn it off for the receipt, then put it back.
  const svc = serviceClient('postReceive');
  const flag = await svc.from('order_receiving_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle();
  if (flag.error) throw new Error(`receiving switch read: ${flag.error.message}`);
  const wasOn = flag.data?.enabled === true;
  const setEnabled = async (enabled: boolean) => {
    const w = await svc.from('order_receiving_settings').update({ enabled }).eq('org_id', ORG_ID);
    if (w.error) throw new Error(`receiving switch: ${w.error.message}`);
  };
  if (wasOn) await setEnabled(false);
  try {
    const r = await client.rpc('create_stock_document', {
      p_header: { kind: 'receive', warehouse_id: warehouseId }, p_lines: [{ item_id: itemId, quantity: qty, unit_cost: cost }], p_post: true, p_client_request_id: randomUUID(),
    });
    return must<string>(r, 'receive');
  } finally {
    if (wasOn) await setEnabled(true);
  }
}
