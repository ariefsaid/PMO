// #1511 F4 (FR-OFM-030/031): the register's read-model writer. A register CREATE reserves the PMO asset through
// `record_odoo_asset_created` (0854 §4: the mirror row AND the linked `equipment_assets` row, in one transaction); every other write —
// a register update, a maintenance create, a maintenance update — lands the mirror row through `apply_odoo_master_rows`, carrying the
// PMO id only on a create so the mirror row can be derived from it. An RPC error is thrown, never swallowed.
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.equipment.test.ts
import { assertEquals, assertRejects } from '@std/assert';
import { getReadModelWriter } from './readModelWriters.ts';

const ASSET_ID = '15110000-0000-4000-8000-000000000001';
const REQUEST_ID = '15110000-0000-4000-8000-000000000002';
const ROW = { external_id: '42', code: 'EXC-001', name: 'Excavator 20t', parent_external_id: null, active: true, attrs: {}, source_write_date: '2026-11-09 08:00:00' };

function rig(error: { message: string; code?: string } | null = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const ctx = {
    serviceClient: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { error }; } },
    orgId: 'org-1',
  };
  return { ctx: ctx as never, calls };
}

const writer = getReadModelWriter('equipment');
const command = (operation: 'create' | 'update', record: Record<string, unknown>) => ({ domain: 'equipment', operation, record }) as never;
const canonical = (kind: string, row: Record<string, unknown> = ROW) => ({ id: ASSET_ID, kind, row }) as never;

Deno.test('a register create reserves the PMO asset through the recorder, with the unit the form chose', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, canonical('equipment'), command('create', { id: ASSET_ID, erp_doc_kind: 'register-equipment', default_unit: 'days' }));
  assertEquals(calls, [{ fn: 'record_odoo_asset_created', args: { p_org_id: 'org-1', p_kind: 'equipment', p_row: ROW, p_asset_id: ASSET_ID, p_default_unit: 'days' } }]);
});

Deno.test("a register create with no unit chosen defaults to hours (the recorder's own default, stated once here)", async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, canonical('vehicle'), command('create', { id: ASSET_ID, erp_doc_kind: 'register-vehicle' }));
  assertEquals(calls[0].args.p_default_unit, 'hours');
});

Deno.test('a maintenance create lands the mirror row carrying the PMO id the command reserved', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, canonical('maintenance_request'), command('create', { id: REQUEST_ID, erp_doc_kind: 'maintenance-request', asset_id: ASSET_ID }));
  assertEquals(calls, [{ fn: 'apply_odoo_master_rows', args: { p_org_id: 'org-1', p_kind: 'maintenance_request', p_rows: [{ ...ROW, pmo_id: REQUEST_ID }] } }]);
});

Deno.test('an update is a plain mirror write: no PMO id is claimed, so the existing row is updated in place', async () => {
  const { ctx, calls } = rig();
  await writer.upsert(ctx, canonical('vehicle'), command('update', { id: ASSET_ID, erp_doc_kind: 'register-vehicle', external_id: 'fleet.vehicle:7' }));
  assertEquals(calls, [{ fn: 'apply_odoo_master_rows', args: { p_org_id: 'org-1', p_kind: 'vehicle', p_rows: [ROW] } }]);
});

Deno.test('an RPC error is thrown with its own code, never swallowed into a silent no-op', async () => {
  const { ctx } = rig({ message: 'the Odoo row must be a JSON object', code: '22023' });
  await assertRejects(
    () => writer.upsert(ctx, canonical('equipment'), command('create', { id: ASSET_ID, erp_doc_kind: 'register-equipment' })),
    Error,
    'the Odoo row must be a JSON object',
  );
});

Deno.test('a canonical with no mirror row is refused before any RPC: nothing is written from a guess', async () => {
  const { ctx, calls } = rig();
  await assertRejects(() => writer.upsert(ctx, { id: ASSET_ID, kind: 'equipment' } as never, command('update', { id: ASSET_ID })));
  assertEquals(calls, []);
});
