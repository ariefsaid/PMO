import { describe, expect, it } from 'vitest';
import { AdapterError } from '../../contract.ts';
import { AppError } from '../../../appError.ts';
import { OdooError, type OdooCall } from '../client.ts';
import { createOdooStockAdapter, type StockIntentResult } from './stockAdapter.ts';
import { DOC, ISSUE_INTENT, stockBed, TRANSFER_INTENT } from './stockFixtures.ts';

const command = (over: Record<string, unknown> = {}) => ({
  domain: 'inventory', operation: 'create' as const, record: { id: DOC, erp_doc_kind: 'stock-document' }, idempotencyKey: `stock:${DOC}`, ...over,
});
const writes = (seen: string[]) => seen.filter((c) => /\/(load|write|button_validate|create|unlink)$/.test(c));

const failing = (match: (model: string, method: string) => boolean, error: Error) => (inner: OdooCall): OdooCall =>
  (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
    if (match(model, method)) throw error;
    return inner<T>(model, method, body);
  }) as OdooCall;

describe('AC-OSP-002 createOdooStockAdapter commits a stock document through the one picking writer', () => {
  it('AC-OSP-001 a capability or mapping refusal rejects with zero ERP writes', async () => {
    const { call, seen } = stockBed();
    const adapter = createOdooStockAdapter({ call, loadIntent: async (): Promise<StockIntentResult> => ({ ok: false, reason: 'item-unmapped', message: 'Match the item in Integration setup.' }) });

    await expect(adapter.commit(command())).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringContaining('Match the item') });
    expect(seen).toHaveLength(0);
  });

  it('AC-OSP-002 a confirmed read-back returns stock.picking:<id> with Odoo quantity and value', async () => {
    const { call } = stockBed();
    const adapter = createOdooStockAdapter({ call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });

    const result = await adapter.commit(command());

    expect(result.externalRecordId).toMatch(/^stock\.picking:\d+$/);
    expect(result.canonical).toMatchObject({ id: DOC, state: 'confirmed', completedQuantity: 11, completedValue: -110, currency: 'IDR', exception: null });
  });

  it('AC-OSP-003 an issue posts the project and confirms on the picking_entry lines Odoo booked', async () => {
    const { call, fake } = stockBed();
    const adapter = createOdooStockAdapter({ call, loadIntent: async () => ({ ok: true, intent: ISSUE_INTENT }) });

    const result = await adapter.commit(command());

    expect(fake.rows('stock.picking')[0]).toMatchObject({ project_id: 55 });
    expect(result.canonical).toMatchObject({ state: 'confirmed', completedValue: -110 });
  });

  it('AC-OSP-007 a held verdict raises command-held with its exception', async () => {
    const { call } = stockBed((inner) => (async <T>(model: string, method: string, body?: Record<string, unknown>) => {
      const out = await inner<T>(model, method, body);
      return (model === 'stock.move' && method === 'read'
        ? (out as unknown as Array<Record<string, unknown>>).map((m) => ({ ...m, quantity: Number(m.quantity) + 1 }))
        : out) as T;
    }) as OdooCall);
    const adapter = createOdooStockAdapter({ call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });

    const error = await adapter.commit(command()).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'command-held', message: expect.stringContaining('STK_EVIDENCE_QUANTITY') });
  });

  it('AC-OSP-004 load refused is commit-rejected; a lost load answer is external-unreachable', async () => {
    const refused = stockBed(failing((_m, me) => me === 'load', new OdooError('validation', 422)));
    const a1 = createOdooStockAdapter({ call: refused.call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });
    await expect(a1.commit(command())).rejects.toMatchObject({ code: 'commit-rejected' });

    const lost = stockBed();
    lost.fake.failAt('after-load');
    const a2 = createOdooStockAdapter({ call: lost.call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });
    const error = await a2.commit(command()).catch((e) => e);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error.code).toBe('external-unreachable');
  });

  it('AC-OSP-004 a refusal after the picking exists is command-held, never failed; a lost validate answer is external-unreachable', async () => {
    const refused = stockBed(failing((m, me) => m === 'stock.picking' && me === 'button_validate', new OdooError('validation', 422)));
    const a1 = createOdooStockAdapter({ call: refused.call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });
    await expect(a1.commit(command())).rejects.toMatchObject({ code: 'command-held' });

    const lost = stockBed();
    lost.fake.failAt('after-validate');
    const a2 = createOdooStockAdapter({ call: lost.call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });
    await expect(a2.commit(command())).rejects.toMatchObject({ code: 'external-unreachable' });
  });

  it('AC-OSP-004 a lost read-back is external-unreachable: Odoo validated, the probe adopts it later', async () => {
    const { call } = stockBed(failing((m, me) => m === 'stock.picking' && me === 'read', new Error('connection dropped')));
    const adapter = createOdooStockAdapter({ call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });
    await expect(adapter.commit(command())).rejects.toMatchObject({ code: 'external-unreachable' });
  });

  it('AC-OSP-004 an expired commit deadline stops with no Odoo write', async () => {
    const { call, seen } = stockBed();
    const adapter = createOdooStockAdapter({ call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });
    await expect(adapter.commit(command({ commitDeadlineAtMs: Date.now() - 1 }))).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(writes(seen)).toHaveLength(0);
  });

  it('AC-OSP-002 a command for another domain or document is refused with no Odoo call', async () => {
    const { call, seen } = stockBed();
    const adapter = createOdooStockAdapter({ call, loadIntent: async () => ({ ok: true, intent: { ...TRANSFER_INTENT, documentId: 'other' } }) });
    await expect(adapter.commit(command({ domain: 'procurement' }))).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.commit(command())).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(seen).toHaveLength(0);
  });

  it('AC-OSP-002 reads other than the commit are refused, not answered empty', async () => {
    const { call } = stockBed();
    const adapter = createOdooStockAdapter({ call, loadIntent: async () => ({ ok: true, intent: TRANSFER_INTENT }) });
    await expect(adapter.listChangesSinceWatermark('inventory', null)).rejects.toMatchObject({ code: 'commit-rejected' });
    await expect(adapter.getByExternalId('inventory', 'stock.picking:1')).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(adapter.tier).toBe('odoo');
  });
});
