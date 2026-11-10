import { describe, expect, it, vi } from 'vitest';
import { primeProcurementSweepBaseline, type SweepBaselineRow } from '../e2e/serial/_sweepBaseline';

describe('primeProcurementSweepBaseline', () => {
  it('records each latest existing ERP row as the inclusive starting cursor for the journey', async () => {
    const kinds = [
      { doctype: 'Purchase Invoice', domain: 'procurement::Purchase Invoice' },
      { doctype: 'Payment Entry', domain: 'procurement::Payment Entry' },
    ];
    const readLatest = vi.fn(async (doctype: string) => ({
      'Purchase Invoice': { modified: '2026-11-10 08:15:00', name: 'PINV-900' },
      'Payment Entry': { modified: '2026-11-10 08:16:00', name: 'PAY-900' },
    }[doctype] ?? null));
    const writeRows = vi.fn(async (_rows: readonly SweepBaselineRow[]) => undefined);

    await primeProcurementSweepBaseline({
      orgId: 'org-1', company: 'PMO Smoke Co', kinds, readLatest, writeRows,
    });

    expect(readLatest).toHaveBeenCalledTimes(2);
    expect(readLatest).toHaveBeenCalledWith('Purchase Invoice', 'PMO Smoke Co');
    expect(readLatest).toHaveBeenCalledWith('Payment Entry', 'PMO Smoke Co');
    expect(writeRows).toHaveBeenCalledWith([
      {
        org_id: 'org-1', external_tier: 'erpnext', domain: 'procurement::Purchase Invoice',
        watermark_cursor: '2026-11-10 08:15:00.000000|PINV-900',
      },
      {
        org_id: 'org-1', external_tier: 'erpnext', domain: 'procurement::Payment Entry',
        watermark_cursor: '2026-11-10 08:16:00.000000|PAY-900',
      },
    ]);
  });

  it('keeps an empty ERP doctype at the beginning and refuses a partially read baseline', async () => {
    const kinds = [{ doctype: 'Payment Entry', domain: 'procurement::Payment Entry' }];
    const writeRows = vi.fn(async (_rows: readonly SweepBaselineRow[]) => undefined);

    await primeProcurementSweepBaseline({
      orgId: 'org-1', company: 'PMO Smoke Co', kinds,
      readLatest: async () => null,
      writeRows,
    });
    expect(writeRows).toHaveBeenCalledWith([{
      org_id: 'org-1', external_tier: 'erpnext', domain: 'procurement::Payment Entry', watermark_cursor: '',
    }]);

    const error = new Error('ERP list failed');
    await expect(primeProcurementSweepBaseline({
      orgId: 'org-1', company: 'PMO Smoke Co', kinds,
      readLatest: async () => { throw error; },
      writeRows,
    })).rejects.toBe(error);
  });
});
