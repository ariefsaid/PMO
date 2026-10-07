import { describe, expect, it } from 'vitest';
import {
  prepareDraftInvoice,
  validatePreparedDraft,
  resolveItem,
  resolveMilestone,
  resolveProject,
  resolveWorkOrder,
} from '../../../../supabase/functions/agent-chat/draftInvoice';
import { asLoose } from '../../../../supabase/functions/agent-chat/looseClient';
import { fakeSupabase, opsOf, type Invoker } from './testing/fakeSupabase';
import { C1, ctx, newId, oneItem, P1, PREPARED, PROJECT, WO, world } from './testing/draftInvoiceFixtures';

describe('prepareDraftInvoice — gate (#787)', () => {
  it.each(['Project Manager', 'Executive', 'Engineer'])('AC-AIN-007 %s is refused before any lookup', async (role) => {
    const { client, calls, invoke } = fakeSupabase(world(), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx(role, client), newId);
    expect(out).toEqual({ ok: false, error: { error: 'Only Finance or Admin can raise an invoice.' } });
    expect(calls).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('Revenue off → refused', async () => {
    const { client } = fakeSupabase(world({ org_features: () => ({ enabled: false }) }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'x' }, ctx('Finance', client), newId))
      .toEqual({ ok: false, error: { error: 'Invoicing is not turned on for this organisation.' } });
  });
  it('revenue not on ERPNext → refused (#784 not shipped)', async () => {
    const { client, calls } = fakeSupabase(world({ external_domain_ownership: () => [] }), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'x' }, ctx('Admin', client), newId);
    expect(out).toMatchObject({ ok: false, error: { error: expect.stringMatching(/not connected revenue to ERPNext/) } });
    expect(opsOf(calls, 'external_domain_ownership')[0]).toEqual([['eq', 'domain', 'revenue'], ['eq', 'external_tier', 'erpnext'], ['limit', 1]]);
  });
});

describe('resolveProject (#787)', () => {
  it('a uuid matches by id', async () => {
    const { client, calls } = fakeSupabase(world());
    expect(await resolveProject(asLoose(client), P1)).toEqual({ ok: true, value: PROJECT });
    expect(opsOf(calls, 'projects')[0]).toContainEqual(['eq', 'id', P1]);
  });
  it('an exact project number wins before a name search', async () => {
    const { client, calls } = fakeSupabase(world({ projects: (c) => (c.ops.some((o) => o[1] === 'pmo_project_number') ? [PROJECT] : []) }));
    expect(await resolveProject(asLoose(client), 'PRJ-0001')).toEqual({ ok: true, value: PROJECT });
    expect(calls.some((c) => c.ops.some((o) => o[0] === 'ilike'))).toBe(false);
  });
  it('an ambiguous name returns choice candidates; wildcards are stripped', async () => {
    const two = [PROJECT, { ...PROJECT, id: 'p-2', name: 'Harbor Annex' }];
    const { client, calls } = fakeSupabase(world({ projects: (c) => (c.ops.some((o) => o[0] === 'ilike') ? two : []) }));
    expect(await resolveProject(asLoose(client), 'Harbor%')).toEqual({ ok: false, error: { error: 'Which project?', needs: 'choice', candidates: [{ id: P1, label: 'Harbor Tower' }, { id: 'p-2', label: 'Harbor Annex' }] } });
    expect(calls.at(-1)?.ops).toContainEqual(['ilike', 'name', '%Harbor%']);
  });
  it('no match → plain refusal', async () => {
    const { client } = fakeSupabase(world({ projects: () => [] }));
    expect(await resolveProject(asLoose(client), 'Nope')).toEqual({ ok: false, error: { error: 'No project matches "Nope".' } });
  });
});

describe('resolveWorkOrder (#787)', () => {
  it('matches the number case-insensitively first, scoped to the project when known', async () => {
    const { client, calls } = fakeSupabase(world());
    expect(await resolveWorkOrder(asLoose(client), 'wo-20261001-001%', PROJECT)).toEqual({ ok: true, value: WO });
    expect(opsOf(calls, 'work_orders')[0]).toEqual(expect.arrayContaining([['ilike', 'wo_number', 'wo-20261001-001'], ['eq', 'project_id', P1]]));
  });
  it('falls back to a title search', async () => {
    const { client, calls } = fakeSupabase(world({ work_orders: (c) => (c.ops.some((o) => o[1] === 'title') ? [WO] : []) }));
    expect(await resolveWorkOrder(asLoose(client), 'survey', null)).toEqual({ ok: true, value: WO });
    expect(opsOf(calls, 'work_orders')[1]).toContainEqual(['ilike', 'title', '%survey%']);
  });
  it('AC-AIN-009 two matches → choice candidates', async () => {
    const { client } = fakeSupabase(world({ work_orders: () => [WO, { ...WO, id: 'w2', wo_number: 'WO-2', title: 'B' }] }));
    expect(await resolveWorkOrder(asLoose(client), 'WO', null)).toEqual({ ok: false, error: { error: 'Which work order?', needs: 'choice', candidates: [
      { id: WO.id, label: 'WO-20261001-001 — Phase 2 survey' }, { id: 'w2', label: 'WO-2 — B' }] } });
  });
  it('FR-AIN-023 a candidate id (the work order uuid) resolves in one round', async () => {
    const { client, calls } = fakeSupabase(world());
    expect(await resolveWorkOrder(asLoose(client), WO.id, null)).toEqual({ ok: true, value: WO });
    expect(opsOf(calls, 'work_orders')).toHaveLength(1);
    expect(opsOf(calls, 'work_orders')[0]).toContainEqual(['eq', 'id', WO.id]);
  });
  it.each(['Draft', 'Cancelled'])('AC-AIN-009 a %s work order is refused', async (status) => {
    const { client } = fakeSupabase(world({ work_orders: () => [{ ...WO, status }] }));
    expect(await resolveWorkOrder(asLoose(client), 'WO-20261001-001', null)).toEqual({ ok: false, error: {
      error: `WO-20261001-001 — Phase 2 survey is ${status}; only an Issued or Closed work order can be invoiced.` } });
  });
  it('Closed is invoiceable (DD-AIN-4)', async () => {
    const { client } = fakeSupabase(world({ work_orders: () => [{ ...WO, status: 'Closed' }] }));
    expect(await resolveWorkOrder(asLoose(client), 'WO-20261001-001', null)).toMatchObject({ ok: true });
  });
});

describe('resolveMilestone (#787)', () => {
  it('AC-AIN-008 "milestone 2" on a project = the second in project order', async () => {
    const { client, calls } = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(client), 'milestone 2', PROJECT)).toMatchObject({ ok: true, value: { id: 'm-2' } });
    expect(opsOf(calls, 'project_milestones')[0]).toEqual(expect.arrayContaining([['eq', 'project_id', P1], ['order', 'sort_order', { ascending: true }]]));
  });
  it('a position with no project → asks which project', async () => {
    const { client } = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(client), '2', null)).toEqual({ ok: false, error: { error: 'Which project is the milestone on?', needs: 'choice' } });
  });
  it('a position past the end → plain refusal', async () => {
    const { client } = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(client), 'M5', PROJECT)).toEqual({ ok: false, error: { error: 'Harbor Tower has 2 milestones; there is no milestone 5.' } });
  });
  it('a name matches by ilike; two matches → choice', async () => {
    const one = fakeSupabase(world({ project_milestones: () => [{ id: 'm-2', name: 'Foundation', project_id: P1, sort_order: 2 }] }));
    expect(await resolveMilestone(asLoose(one.client), 'Found', null)).toMatchObject({ ok: true, value: { id: 'm-2' } });
    const two = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(two.client), 'n', null)).toMatchObject({ ok: false, error: { needs: 'choice' } });
  });
});

describe('resolveMilestone — same name on two projects (#787)', () => {
  const M1 = '44444444-4444-4444-8444-444444444441';
  const M2 = '44444444-4444-4444-8444-444444444442';
  const P2 = '55555555-5555-4555-8555-555555555555';
  const rows = [
    { id: M1, name: 'Foundation', project_id: P1, sort_order: 2 },
    { id: M2, name: 'Foundation', project_id: P2, sort_order: 1 },
  ];
  const responders = (): Parameters<typeof world>[0] => ({
    project_milestones: (c) => (c.ops.some((o) => o[0] === 'eq' && o[1] === 'id') ? [rows.find((r) => r.id === c.ops.find((o) => o[1] === 'id')![2])] : rows),
    projects: () => [{ id: P1, name: 'Harbor Tower' }, { id: P2, name: 'Harbor Annex' }],
  });
  it('FR-AIN-023 candidates are distinct (id = milestone uuid, label names the project) and the chosen id resolves in one round', async () => {
    const { client } = fakeSupabase(world(responders()));
    const first = await resolveMilestone(asLoose(client), 'Foundation', null);
    expect(first).toEqual({ ok: false, error: { error: 'Which milestone?', needs: 'choice', candidates: [
      { id: M1, label: 'Harbor Tower — Foundation' }, { id: M2, label: 'Harbor Annex — Foundation' }] } });
    const second = await resolveMilestone(asLoose(client), M2, null);
    expect(second).toMatchObject({ ok: true, value: { id: M2, project_id: P2 } });
  });
});

describe('resolveItem (#787)', () => {
  it('M1 a named item is checked against the catalogue and used', async () => {
    const { client, invoke } = fakeSupabase(world(), oneItem);
    expect(await resolveItem(ctx('Finance', client), 'SVC')).toEqual({ ok: true, value: { code: 'SVC', name: 'Services', only: true } });
    expect(invoke).toHaveBeenCalledWith('external-items', { body: { purpose: 'sales' } });
  });
  it('M1 a named item that is not in the catalogue is refused with the catalogue as candidates', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    expect(await resolveItem(ctx('Finance', client), 'MADE-UP')).toEqual({ ok: false, error: {
      error: 'ERPNext has no sales item "MADE-UP". Which item should the invoice use?', needs: 'itemCode', candidates: [{ id: 'SVC', label: 'SVC — Services' }] } });
  });
  it('M1 a named item cannot be verified when the catalogue is unreadable → asks, never trusts the model', async () => {
    const broken: Invoker = async () => ({ data: null, error: { message: 'x' } });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), broken).client), 'SVC')).toMatchObject({ ok: false, error: { needs: 'itemCode' } });
  });
  it('the only sales item is used', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    expect(await resolveItem(ctx('Finance', client))).toEqual({ ok: true, value: { code: 'SVC', name: 'Services', only: true } });
  });
  it('several items: a valid named one is accepted (not the only one); unnamed → itemCode candidates; none → refusal; unreadable → asks', async () => {
    const many: Invoker = async () => ({ data: { items: [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }] }, error: null });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), many).client), 'B')).toEqual({ ok: true, value: { code: 'B', name: 'Beta', only: false } });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), many).client))).toEqual({ ok: false, error: {
      error: 'Which ERPNext item should the invoice use?', needs: 'itemCode', candidates: [{ id: 'A', label: 'A — Alpha' }, { id: 'B', label: 'B — Beta' }] } });
    const none: Invoker = async () => ({ data: { items: [] }, error: null });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), none).client))).toMatchObject({ ok: false, error: { error: expect.stringMatching(/no sales item/) } });
    const broken: Invoker = async () => ({ data: null, error: { message: 'x' } });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), broken).client))).toMatchObject({ ok: false, error: { needs: 'itemCode' } });
  });
});

describe('prepareDraftInvoice — assembled draft (#787)', () => {
  it('AC-AIN-014 a tax-inclusive work order proposes its value before tax, with PO reference and summary', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toMatchObject({
      kind: 'prepared-draft-invoice', customerId: C1, projectId: P1, reference_number: 'PO-778',
      items: [{ item_code: 'SVC', qty: 1, rate: 1_000_000, description: 'WO-20261001-001 — Phase 2 survey' }],
      display: { customerName: 'PT Client', projectName: 'Harbor Tower', sourceLabel: 'WO-20261001-001' },
    });
    expect(out.value.commandId).not.toBe(out.value.idempotencyKey);
    expect(out.summary).toMatch(/^Save as Draft: invoice PT Client .* excl\. tax for WO-20261001-001\. Not submitted\.$/);
  });
  it('a stated amount wins over the work order value', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001', amount: 400_000 }, ctx('Admin', client), newId);
    expect(out.ok && out.value.items[0].rate).toBe(400_000);
  });
  it('AC-AIN-008 a milestone without an amount asks for one; with one, proposes it', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    expect(await prepareDraftInvoice({ milestone: '2', project: P1 }, ctx('Finance', client), newId)).toEqual({ ok: false, error: {
      error: "Milestones don't carry an amount yet. How much should this invoice be, before tax?", needs: 'amount' } });
    const out = await prepareDraftInvoice({ milestone: '2', project: P1, amount: 5_000_000 }, ctx('Finance', client), newId);
    expect(out.ok && out.value).toMatchObject({ reference_number: null, items: [{ rate: 5_000_000, description: 'Harbor Tower — Foundation' }] });
  });
  it('a client not linked to ERPNext, or no client, is refused before the chip', async () => {
    const unlinked = fakeSupabase(world({ external_refs: () => [] }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', unlinked.client), newId))
      .toEqual({ ok: false, error: { error: 'PT Client is not linked to ERPNext yet, so an invoice cannot be raised for them.' } });
    const noClient = fakeSupabase(world({ projects: () => ({ ...PROJECT, client_id: null }) }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', noClient.client), newId))
      .toEqual({ ok: false, error: { error: 'Harbor Tower has no client, so there is no one to invoice.' } });
  });
});

describe('prepareDraftInvoice — chip honesty and limits (#787)', () => {
  const many: Invoker = async () => ({ data: { items: [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }] }, error: null });
  it('M1 the chip shows the item whenever it is not the org\'s only sales item, within 120 chars', async () => {
    const { client } = fakeSupabase(world(), many);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001', itemCode: 'B' }, ctx('Finance', client), newId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.display.itemLabel).toBe('B — Beta');
    expect(out.summary).toMatch(/B — Beta/);
    expect(out.summary.length).toBeLessThanOrEqual(120);
    expect(validatePreparedDraft(out.value)).toEqual({ ok: true, value: out.value });
  });
  it('M1 an unknown model-supplied item code is refused before the chip', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001', itemCode: 'NOPE' }, ctx('Finance', client), newId))
      .toMatchObject({ ok: false, error: { needs: 'itemCode' } });
  });
  it('M3 long titles and names are clipped so the chip it shows can always be approved', async () => {
    const big = { ...WO, title: 'T'.repeat(300) };
    const { client } = fakeSupabase(world({ work_orders: () => [big], companies: () => ({ name: 'C'.repeat(300) }), projects: (c) => (c.terminal === 'maybeSingle' ? { ...PROJECT, name: 'P'.repeat(300) } : [{ ...PROJECT, name: 'P'.repeat(300) }]) }), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const v of Object.values(out.value.display)) expect(v.length).toBeLessThanOrEqual(200);
    expect(validatePreparedDraft(out.value)).toMatchObject({ ok: true });
  });
  it('M3 a client PO reference over 140 chars is refused before the chip with a clear message', async () => {
    const { client } = fakeSupabase(world({ work_orders: () => [{ ...WO, client_po_number: 'X'.repeat(141) }] }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId)).toEqual({ ok: false, error: {
      error: 'The client PO reference on WO-20261001-001 is longer than 140 characters, so it cannot go on an invoice. Shorten it on the work order first.' } });
  });
  it('a source currency that differs from the org\'s billing currency is refused before the chip (the dispatch sends no currency)', async () => {
    const { client } = fakeSupabase(world({ work_orders: () => [{ ...WO, currency: 'USD' }] }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId)).toEqual({ ok: false, error: {
      error: "WO-20261001-001 is in USD, but this organisation invoices in IDR. Create this one from Sales Invoices instead." } });
    const ms = fakeSupabase(world({ projects: (c) => (c.terminal === 'maybeSingle' ? { ...PROJECT, currency: 'USD' } : [{ ...PROJECT, currency: 'USD' }]) }), oneItem);
    expect(await prepareDraftInvoice({ milestone: '2', project: P1, amount: 5 }, ctx('Finance', ms.client), newId))
      .toMatchObject({ ok: false, error: { error: expect.stringMatching(/in USD, but this organisation invoices in IDR/) } });
  });
});
describe('prepareDraftInvoice — billing by work order (OD-BILL-1, DD-BWO-9)', () => {
  const billed = (rows: Array<{ billed: number | null; currency: string }>) =>
    world({ work_order_billing_lines: () => rows });

  it('AC-BWO-005 a work-order draft names the work order and defaults to what is still to invoice', async () => {
    const { client, calls } = fakeSupabase(billed([{ billed: 400_000, currency: 'IDR' }]), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.workOrderId).toBe(WO.id);
    expect(out.value.items[0].rate).toBe(600_000);
    expect(opsOf(calls, 'work_order_billing_lines')[0]).toContainEqual(['eq', 'work_order_id', WO.id]);
    expect(validatePreparedDraft(out.value)).toEqual({ ok: true, value: out.value });
  });

  it('AC-BWO-005 a stated amount above what is left is refused before the chip', async () => {
    const { client } = fakeSupabase(billed([{ billed: 400_000, currency: 'IDR' }]), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001', amount: 700_000 }, ctx('Finance', client), newId)).toEqual({
      ok: false,
      error: { error: 'Only IDR\u00a0600,000 is still to invoice on WO-20261001-001 — Phase 2 survey. How much should this invoice be, before tax?', needs: 'amount' },
    });
  });

  it('AC-BWO-005 a work order with nothing left is refused before the chip', async () => {
    const { client } = fakeSupabase(billed([{ billed: 1_000_000, currency: 'IDR' }]), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId))
      .toEqual({ ok: false, error: { error: 'Nothing is left to invoice on WO-20261001-001 — Phase 2 survey.' } });
  });

  it('AC-BWO-005 an invoice that cannot be totalled is refused before the chip', async () => {
    const { client } = fakeSupabase(billed([{ billed: null, currency: 'IDR' }]), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId)).toEqual({
      ok: false,
      error: { error: 'An invoice on WO-20261001-001 — Phase 2 survey has no amount or is in another currency, so what is left to invoice cannot be worked out.' },
    });
  });

  it('AC-BWO-005 a replayed draft with a malformed work-order id is refused', () => {
    expect(validatePreparedDraft({ ...PREPARED, workOrderId: 'not-a-uuid' })).toEqual({ ok: false, error: 'workOrderId must be a uuid' });
  });
});
