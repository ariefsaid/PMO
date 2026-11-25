// Shared fixture for the two-step stock-transfer journeys (JOB-F9, JOB-F10). Those journeys need the organisation's
// transfer mode turned to two-step, which is a shared setting — they live in the serial lane and restore it in `finally`.
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { need, ORG_ID, profileId } from './jobFixtures';
import { keeperOf, makeItem, makeWarehouse, postReceive, runSuffix, userClient } from './stockFixture';

/** The seed admin: the person an organisation's Admin settings belong to (real JWT — stock RPCs refuse a service-role call). */
export const ADMIN_SEED_EMAIL = 'admin@acme.test';

/** The organisation's transfer mode, read as the deciding value (the serial specs put it back as they found it). */
export async function transferMode(svc: SupabaseClient): Promise<'one_step' | 'two_step'> {
  const row = need('transfer mode', await svc.from('organizations').select('stock_transfer_mode').eq('id', ORG_ID).single());
  return row.stock_transfer_mode === 'two_step' ? 'two_step' : 'one_step';
}

/** An Admin action: the transfer settings screen calls the same RPC. Serial lane only — it is one setting for the whole org. */
export async function setTransferMode(mode: 'one_step' | 'two_step'): Promise<void> {
  const session = await userClient(ADMIN_SEED_EMAIL);
  const { error } = await session.rpc('set_stock_transfer_mode', { p_mode: mode });
  if (error) throw new Error(`set transfer mode: ${error.message}`);
}

export interface SentTransfer {
  number: string; transferId: string; itemCode: string; site: { code: string; name: string };
}

/** Pipe in the central warehouse and a transfer of `qty` already sent to the site, addressed to `receiverId`, who keeps it. */
export async function sendTransfer(svc: SupabaseClient, receiverId: string, qty: string): Promise<SentTransfer> {
  const sfx = runSuffix();
  const item = await makeItem(svc, sfx, 'PIPE');
  const central = await makeWarehouse(svc, sfx, 'CEN', 'central');
  const site = await makeWarehouse(svc, sfx, 'SITE', 'site');
  // The keeper assignment and the send are real-JWT calls: the seed admin keeps the source, the receiver keeps the destination.
  const session = await userClient(ADMIN_SEED_EMAIL);
  await keeperOf(session, site.id, receiverId);
  await keeperOf(session, central.id, await profileId(svc, ADMIN_SEED_EMAIL));
  await postReceive(session, central.id, item.id, qty);
  const sent = await session.rpc('send_stock_transfer', {
    p_header: { warehouse_id: central.id, to_warehouse_id: site.id, to_user_id: receiverId, note: `E2E ${sfx}` },
    p_lines: [{ item_id: item.id, quantity: qty }],
    p_client_request_id: randomUUID(),
  });
  if (sent.error) throw new Error(`send transfer: ${sent.error.message}`);
  const number = need('transfer number', await svc.from('stock_transfers').select('number').eq('id', sent.data as string).single()).number;
  return { number: String(number), transferId: sent.data as string, itemCode: item.code, site: { code: site.code, name: site.name } };
}
