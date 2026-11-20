import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #2329 / migration 1018 — the organization's fiscal-year start month, at the DAL seam. Both calls are RPCs: the read
 * says who keeps the calendar (PMO or the accounting system), the write is the Admin-only setter. Neither sends an
 * org id; the server takes the caller's organization from the session.
 */
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getOrgFiscalYearSetting, setOrgFiscalYearStartMonth } from '@/src/lib/db/orgs';
import { AppError } from '@/src/lib/appError';

beforeEach(() => h.rpc.mockReset());

describe('getOrgFiscalYearSetting', () => {
  it('AC-FCAL-014 reads who keeps the calendar and the PMO start month', async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ source: 'pmo', start_month: 4 }], error: null });
    await expect(getOrgFiscalYearSetting()).resolves.toEqual({ source: 'pmo', startMonth: 4 });
    expect(h.rpc).toHaveBeenCalledWith('get_org_fiscal_year_setting');
  });

  it('AC-FCAL-014 an accounting system keeps the calendar', async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ source: 'accounting_system', start_month: null }], error: null });
    await expect(getOrgFiscalYearSetting()).resolves.toEqual({ source: 'accounting_system', startMonth: null });
  });

  it('AC-FCAL-014 no readable organization, an unknown source or a transport error is a failure, not a default', async () => {
    h.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(getOrgFiscalYearSetting()).rejects.toBeInstanceOf(AppError);
    h.rpc.mockResolvedValueOnce({ data: [{ source: 'other', start_month: 4 }], error: null });
    await expect(getOrgFiscalYearSetting()).rejects.toBeInstanceOf(AppError);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline', code: 'FETCH_ERROR' } });
    await expect(getOrgFiscalYearSetting()).rejects.toBeInstanceOf(AppError);
  });
});

describe('setOrgFiscalYearStartMonth', () => {
  it('AC-FCAL-003 sends only the month to the setter, or null to clear it', async () => {
    h.rpc.mockResolvedValue({ data: 4, error: null });
    await setOrgFiscalYearStartMonth(4);
    expect(h.rpc).toHaveBeenCalledWith('set_org_fiscal_year_start_month', { p_month: 4 });
    await setOrgFiscalYearStartMonth(null);
    expect(h.rpc).toHaveBeenLastCalledWith('set_org_fiscal_year_start_month', { p_month: null });
  });

  it('AC-FCAL-003 refuses a month outside 1-12 before calling the server, and surfaces a server refusal', async () => {
    await expect(setOrgFiscalYearStartMonth(13)).rejects.toBeInstanceOf(AppError);
    expect(h.rpc).not.toHaveBeenCalled();
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'only an Admin can set the fiscal year', code: '42501' } });
    await expect(setOrgFiscalYearStartMonth(4)).rejects.toMatchObject({ message: 'only an Admin can set the fiscal year' });
  });
});
