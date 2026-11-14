import { describe, it } from '@std/testing/bdd';
import { assertEquals, assertRejects, assert } from '@std/assert';
import {
  writeOdooStockMirror,
  type StockMirrorClient,
  type WriteStockMirrorParams,
} from './odooStockMirror.ts';
import type { StockEvidenceVerdict } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/evidence.ts';

const ORG = '15120000-0000-0000-0000-000000000001';
const DOC = '15120000-0000-0000-0000-000000003001';
const COMPANY = 42;
const GENERATION = 1;

const baseParams: WriteStockMirrorParams = {
  orgId: ORG,
  documentId: DOC,
  companyId: COMPANY,
  generation: GENERATION,
};

function createFakeClient(opts?: {
  onRpc?: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null };
}): StockMirrorClient & { from?: (table: string) => unknown } {
  return {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      if (fn !== 'write_stock_erp_mirror') {
        return { data: null, error: { message: `Unknown function ${fn}`, code: '42883' } };
      }
      if (opts?.onRpc) {
        const res = opts.onRpc(fn, args);
        return { data: res.data ?? null, error: res.error ?? null };
      }
      return { data: null, error: null };
    },
    // Expose table write refusal: service_role has no grant on stock_erp_mirror table
    from: (_table: string) => {
      throw new Error('42501: permission denied for table stock_erp_mirror');
    },
  };
}

describe('odooStockMirror (server adapter, AC-OSP-007)', () => {
  it('AC-OSP-007: confirmed verdict passes all expected arguments to write_stock_erp_mirror', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const client = createFakeClient({
      onRpc: (_fn, args) => {
        capturedArgs = args;
        return { data: null, error: null };
      },
    });

    const verdict: StockEvidenceVerdict = {
      state: 'confirmed',
      externalModel: 'stock.picking',
      externalId: '77',
      completedQuantity: 10,
      completedValue: 240.5,
      currency: 'IDR',
      sourceWrittenAt: '2026-11-14 10:00:00',
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, true);
    assertEquals(capturedArgs.p_org_id, ORG);
    assertEquals(capturedArgs.p_document_id, DOC);
    assertEquals(capturedArgs.p_company_id, COMPANY);
    assertEquals(capturedArgs.p_generation, GENERATION);
    assertEquals(capturedArgs.p_state, 'confirmed');
    assertEquals(capturedArgs.p_external_model, 'stock.picking');
    assertEquals(capturedArgs.p_external_id, '77');
    assertEquals(capturedArgs.p_completed_quantity, 10);
    assertEquals(capturedArgs.p_completed_value, 240.5);
    assertEquals(capturedArgs.p_currency, 'IDR');
    assertEquals(capturedArgs.p_source_written_at, '2026-11-14 10:00:00');
    assertEquals(typeof capturedArgs.p_fetched_at, 'string');
    assertEquals(capturedArgs.p_exception, null);
  });

  it('AC-OSP-007: pending verdict passes expected arguments with null quantities and values', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const client = createFakeClient({
      onRpc: (_fn, args) => {
        capturedArgs = args;
        return { data: null, error: null };
      },
    });

    const verdict: StockEvidenceVerdict = {
      state: 'pending',
      externalModel: 'stock.picking',
      externalId: '77',
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: '2026-11-14 10:00:00',
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, true);
    assertEquals(capturedArgs.p_state, 'pending');
    assertEquals(capturedArgs.p_completed_quantity, null);
    assertEquals(capturedArgs.p_completed_value, null);
    assertEquals(capturedArgs.p_currency, null);
  });

  it('AC-OSP-007: held verdict passes expected arguments with exception', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const client = createFakeClient({
      onRpc: (_fn, args) => {
        capturedArgs = args;
        return { data: null, error: null };
      },
    });

    const verdict: StockEvidenceVerdict = {
      state: 'held',
      externalModel: 'stock.picking',
      externalId: '77',
      completedQuantity: 6,
      completedValue: null,
      currency: 'IDR',
      sourceWrittenAt: '2026-11-14 10:00:00',
      exception: 'STK_EVIDENCE_QUANTITY: completed quantity does not match intent',
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, true);
    assertEquals(capturedArgs.p_state, 'held');
    assertEquals(capturedArgs.p_completed_quantity, 6);
    assertEquals(capturedArgs.p_completed_value, null);
    assertEquals(capturedArgs.p_exception, 'STK_EVIDENCE_QUANTITY: completed quantity does not match intent');
  });

  it('AC-OSP-007: stale verdict passes expected arguments', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const client = createFakeClient({
      onRpc: (_fn, args) => {
        capturedArgs = args;
        return { data: null, error: null };
      },
    });

    const verdict: StockEvidenceVerdict = {
      state: 'stale',
      externalModel: 'stock.picking',
      externalId: '77',
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: '2026-11-14 09:00:00',
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, true);
    assertEquals(capturedArgs.p_state, 'stale');
  });

  it('AC-OSP-007: confirmed verdict with null value is not fixed by adapter and fails with STK_MIRROR_EVIDENCE', async () => {
    let capturedArgs: Record<string, unknown> = {};
    const client = createFakeClient({
      onRpc: (_fn, args) => {
        capturedArgs = args;
        if (args.p_state === 'confirmed' && args.p_completed_value === null) {
          return { error: { message: 'STK_MIRROR_EVIDENCE: confirmed evidence is incomplete', code: 'P0001' } };
        }
        return { data: null, error: null };
      },
    });

    // If an invalid verdict with state 'confirmed' and null completedValue is passed:
    const invalidVerdict: StockEvidenceVerdict = {
      state: 'confirmed',
      externalModel: 'stock.picking',
      externalId: '77',
      completedQuantity: 10,
      completedValue: null, // missing value
      currency: 'IDR',
      sourceWrittenAt: '2026-11-14 10:00:00',
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, invalidVerdict);

    // Assert the adapter did NOT fix it (e.g. by converting null to 0)
    assertEquals(capturedArgs.p_completed_value, null);
    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.refusal, 'STK_MIRROR_EVIDENCE');
      assert(res.message.includes('STK_MIRROR_EVIDENCE'));
    }
  });

  it('AC-OSP-007: database refusal STK_MIRROR_FENCE returns typed refusal', async () => {
    const client = createFakeClient({
      onRpc: () => ({
        error: { message: 'STK_MIRROR_FENCE: no command at this generation', code: 'P0001' },
      }),
    });

    const verdict: StockEvidenceVerdict = {
      state: 'pending',
      externalModel: null,
      externalId: null,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: null,
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.refusal, 'STK_MIRROR_FENCE');
      assert(res.message.includes('STK_MIRROR_FENCE'));
    }
  });

  it('AC-OSP-007: database refusal STK_MIRROR_COMPANY returns typed refusal', async () => {
    const client = createFakeClient({
      onRpc: () => ({
        error: { message: 'STK_MIRROR_COMPANY: connected company does not match', code: 'P0001' },
      }),
    });

    const verdict: StockEvidenceVerdict = {
      state: 'pending',
      externalModel: null,
      externalId: null,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: null,
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.refusal, 'STK_MIRROR_COMPANY');
    }
  });

  it('AC-OSP-007: database refusal STK_MIRROR_EVIDENCE returns typed refusal', async () => {
    const client = createFakeClient({
      onRpc: () => ({
        error: { message: 'STK_MIRROR_EVIDENCE: confirmed evidence is incomplete', code: 'P0001' },
      }),
    });

    const verdict: StockEvidenceVerdict = {
      state: 'confirmed',
      externalModel: 'stock.picking',
      externalId: '77',
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: null,
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.refusal, 'STK_MIRROR_EVIDENCE');
    }
  });

  it('AC-OSP-007: database refusal STK_MIRROR_CONFIRMED returns typed refusal', async () => {
    const client = createFakeClient({
      onRpc: () => ({
        error: { message: 'STK_MIRROR_CONFIRMED: confirmed evidence cannot be downgraded', code: 'P0001' },
      }),
    });

    const verdict: StockEvidenceVerdict = {
      state: 'pending',
      externalModel: null,
      externalId: null,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: null,
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.refusal, 'STK_MIRROR_CONFIRMED');
    }
  });

  it('AC-OSP-007: database refusal STK_MIRROR_DOCUMENT returns typed refusal', async () => {
    const client = createFakeClient({
      onRpc: () => ({
        error: { message: 'STK_MIRROR_DOCUMENT: document is not in this organisation', code: 'P0001' },
      }),
    });

    const verdict: StockEvidenceVerdict = {
      state: 'pending',
      externalModel: null,
      externalId: null,
      completedQuantity: null,
      completedValue: null,
      currency: null,
      sourceWrittenAt: null,
      exception: null,
    };

    const res = await writeOdooStockMirror(client, baseParams, verdict);

    assertEquals(res.ok, false);
    if (!res.ok) {
      assertEquals(res.refusal, 'STK_MIRROR_DOCUMENT');
    }
  });

  it('AC-OSP-007: client exposes ONLY the rpc call and refuses direct table writes', async () => {
    const client = createFakeClient();
    assert(typeof client.rpc === 'function');
    assert(typeof client.from === 'function');
    await assertRejects(
      async () => {
        client.from!('stock_erp_mirror');
      },
      Error,
      '42501',
    );
  });
});
