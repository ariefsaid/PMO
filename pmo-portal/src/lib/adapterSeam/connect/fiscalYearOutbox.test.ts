import { describe, it, expect, vi } from 'vitest';
import { ensureFiscalYearViaOutbox, type FiscalYearIntent } from './fiscalYearOutbox.ts';
import { createFakeOutbox } from '../dispatch.money.test.ts';
import { fakeFiscalYearErp } from '../erpnext/fakeFiscalYearErp.ts';

describe('Task 5: ensureFiscalYearViaOutbox (AC-ECX-040)', () => {
  const baseIntent: FiscalYearIntent = {
    id: 'f5050000-0000-0000-0000-000000000001',
    org_id: 'f5050000-0000-0000-0000-000000000010',
    binding_id: 'f5050000-0000-0000-0000-000000000020',
    company: 'Acme Co',
    site_url: 'https://erp.test',
    activated_at: '2026-01-01T00:00:00Z',
    target_start: '2027-01-01',
    target_end: '2027-12-31',
    year_name: '2027',
  };

  function createTestHarness(opts: {
    reserveSuccess?: boolean;
    recordStatusSuccess?: boolean;
  } = {}) {
    const fakeOutbox = createFakeOutbox({ reissueOnInconclusiveAbsence: false });
    const erp = fakeFiscalYearErp([], { companies: ['Acme Co'] });

    const serviceClient = {
      rpc: vi.fn(async (fn: string, _args: Record<string, unknown>) => {
        if (fn === 'begin_fiscal_year_post') {
          return { data: opts.reserveSuccess !== false, error: null };
        }
        if (fn === 'record_fiscal_year_status') {
          return { data: opts.recordStatusSuccess !== false, error: null };
        }
        return { data: null, error: new Error(`unknown rpc ${fn}`) };
      }),
      from: vi.fn(),
    };

    return {
      fakeOutbox,
      serviceClient,
      erp,
    };
  }

  it('runs dispatchMoneyWrite and makes at most one POST for one intent', async () => {
    const h = createTestHarness();
    const result = await ensureFiscalYearViaOutbox(
      { serviceClient: h.serviceClient, erpClient: h.erp.client, money: h.fakeOutbox.deps },
      baseIntent,
    );

    expect(result.externalRecordId).toBe('2027');
    expect(h.erp.writes()).toHaveLength(1);
    expect(h.serviceClient.rpc).toHaveBeenCalledWith(
      'begin_fiscal_year_post',
      expect.objectContaining({
        p_intent_id: baseIntent.id,
        p_generation: 1,
      }),
    );
    expect(h.serviceClient.rpc).toHaveBeenCalledWith(
      'record_fiscal_year_status',
      expect.objectContaining({
        p_intent_id: baseIntent.id,
        p_generation: 1,
      }),
    );
  });

  it('two concurrent invocations for one intent cause one begin_fiscal_year_post success and at most one POST', async () => {
    const h = createTestHarness();
    let reserved = false;
    let releaseRun1: () => void;
    const run1Paused = new Promise<void>((resolve) => { releaseRun1 = resolve; });

    h.serviceClient.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'begin_fiscal_year_post') {
        if (!reserved) {
          reserved = true;
          await run1Paused; // Pause run1 while holding reservation
          return { data: true, error: null };
        }
        return { data: false, error: null };
      }
      if (fn === 'record_fiscal_year_status') return { data: true, error: null };
      return { data: null, error: new Error('unknown rpc') };
    });

    const run1 = ensureFiscalYearViaOutbox(
      { serviceClient: h.serviceClient, erpClient: h.erp.client, money: h.fakeOutbox.deps },
      baseIntent,
    );
    const run2 = ensureFiscalYearViaOutbox(
      { serviceClient: h.serviceClient, erpClient: h.erp.client, money: h.fakeOutbox.deps },
      baseIntent,
    );

    // Give run2 a chance to execute while run1 is in-flight/paused
    await new Promise(r => setTimeout(r, 10));
    releaseRun1!();

    const outcomes = await Promise.allSettled([run1, run2]);
    expect(outcomes[0]!.status).toBe('fulfilled');
    expect(outcomes[1]!.status).toBe('fulfilled');
    const beginPostCalls = h.serviceClient.rpc.mock.calls.filter(c => c[0] === 'begin_fiscal_year_post');
    expect(beginPostCalls).toHaveLength(1);
    expect(h.erp.writes()).toHaveLength(1);
  });

  it('a failed retry or held release cannot cause a second POST if already reserved', async () => {
    const h = createTestHarness({ reserveSuccess: false });
    await expect(
      ensureFiscalYearViaOutbox(
        { serviceClient: h.serviceClient, erpClient: h.erp.client, money: h.fakeOutbox.deps },
        baseIntent,
      ),
    ).rejects.toMatchObject({ code: 'command-held' });
    expect(h.erp.writes()).toHaveLength(0);
  });

  it('POST timeout after commit with exactly one matching readback results in adoption without second POST', async () => {
    const h = createTestHarness();
    h.erp.failNextWrite('lost-response');

    const result = await ensureFiscalYearViaOutbox(
      { serviceClient: h.serviceClient, erpClient: h.erp.client, money: h.fakeOutbox.deps },
      baseIntent,
    );

    expect(result.externalRecordId).toBe('2027');
    expect(h.erp.writes()).toHaveLength(1);
  });

  it('POST timeout with absent or ambiguous readback holds and issues no second POST', async () => {
    const h = createTestHarness();
    h.erp.failNextWrite('transport');

    await expect(
      ensureFiscalYearViaOutbox(
        { serviceClient: h.serviceClient, erpClient: h.erp.client, money: h.fakeOutbox.deps },
        baseIntent,
      ),
    ).rejects.toMatchObject({ code: 'command-held' });
    expect(h.erp.writes()).toHaveLength(1);
  });
});
