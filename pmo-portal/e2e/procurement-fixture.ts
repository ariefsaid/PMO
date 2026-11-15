import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireServiceRoleKey } from './helpers';
import { requireMatchingLocalSupabaseUrls } from '../src/lib/testing/localSupabaseUrl';

/**
 * #1882 — a per-test procurement fixture. Specs that move a procurement through a status used to
 * target a shared seed row, which a previous run (or an earlier spec in the same pass) had already
 * advanced, so they only passed against a freshly reset database. Each caller now creates the row
 * it reads, namespaced and unique, and removes it (and the rows hanging off it) afterwards.
 */

const PM_ID = '00000000-0000-0000-0000-0000000000a2';
const EXEC_ID = '00000000-0000-0000-0000-0000000000a1';
const SEED_PROJECT_ID = '40000000-0000-0000-0000-000000000003';

export interface ProcurementFixture {
  id: string;
  code: string;
  url: string;
  cleanup: () => Promise<void>;
}

function serviceClient(): SupabaseClient {
  const key = requireServiceRoleKey();
  if (!key) throw new Error('procurement fixture requires the service-role key supplied by scripts/e2e-local.sh or CI.');
  const url = requireMatchingLocalSupabaseUrls(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL);
  if (!url) throw new Error('procurement fixture requires SUPABASE_URL supplied by scripts/e2e-local.sh or CI.');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Create a requested-by-PM procurement at `status` with one line item; `Approved` is stamped as approved by the exec. */
export async function createProcurementFixture(opts: {
  status: 'Draft' | 'Approved';
  title: string;
}): Promise<ProcurementFixture> {
  const admin = serviceClient();
  const id = randomUUID();
  const code = `E2E-${id.slice(0, 8).toUpperCase()}`;
  const { error } = await admin.from('procurements').insert({
    id,
    code,
    title: `${opts.title} ${code}`,
    project_id: SEED_PROJECT_ID,
    requested_by_id: PM_ID,
    status: opts.status,
    total_value: 12000,
    ...(opts.status === 'Approved' ? { approved_by_id: EXEC_ID } : {}),
  });
  if (error) throw new Error(`procurement fixture insert failed: ${error.message}`);
  const { error: itemError } = await admin
    .from('procurement_items')
    .insert({ procurement_id: id, name: 'Fixture line', description: 'e2e fixture', quantity: 1, rate: 12000 });
  if (itemError) throw new Error(`procurement fixture item insert failed: ${itemError.message}`);

  return {
    id,
    code,
    url: `/procurement/${id}`,
    cleanup: async () => {
      for (const table of ['procurement_documents', 'procurement_status_events', 'procurement_quotations', 'procurement_items']) {
        await admin.from(table).delete().eq('procurement_id', id);
      }
      await admin.from('procurements').delete().eq('id', id);
    },
  };
}
