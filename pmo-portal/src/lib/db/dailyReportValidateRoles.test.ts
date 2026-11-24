import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  eqs: [] as Array<[string, unknown]>,
  selectCols: '',
  rows: [] as Array<{ daily_report_validate_roles: string[] }>,
  selectErr: null as { message: string; code?: string } | null,
  rpcCall: null as { fn: string; args: unknown } | null,
  rpcData: [] as string[] | null,
  rpcErr: null as { message: string; code?: string } | null,
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    from: () => {
      const chain = {
        select: (cols: string) => {
          h.selectCols = cols;
          return chain;
        },
        eq: (k: string, v: unknown) => {
          h.eqs.push([k, v]);
          return chain;
        },
        limit: async () => ({ data: h.selectErr ? null : h.rows, error: h.selectErr }),
      };
      return chain;
    },
    rpc: async (fn: string, args: unknown) => {
      h.rpcCall = { fn, args };
      return { data: h.rpcErr ? null : h.rpcData, error: h.rpcErr };
    },
  },
}));

import { getDailyReportValidateRoles, setDailyReportValidateRoles } from './dailyReportValidateRoles';

describe('dailyReportValidateRoles DAL (AC-DRVR-002, AC-DRVR-004)', () => {
  beforeEach(() => {
    h.eqs = [];
    h.selectCols = '';
    h.rows = [{ daily_report_validate_roles: ['site_supervisor'] }];
    h.selectErr = null;
    h.rpcCall = null;
    h.rpcData = ['site_supervisor'];
    h.rpcErr = null;
  });

  it('reads daily_report_validate_roles without sending org_id and defaults to empty', async () => {
    expect(await getDailyReportValidateRoles()).toEqual(['site_supervisor']);
    expect(h.selectCols).toBe('daily_report_validate_roles');
    expect(h.eqs).toEqual([]);

    h.rows = [];
    expect(await getDailyReportValidateRoles()).toEqual([]);

    h.selectErr = { message: 'boom', code: '42501' };
    await expect(getDailyReportValidateRoles()).rejects.toMatchObject({ message: 'boom', code: '42501' });
  });

  it('writes via set_daily_report_validate_roles RPC and preserves refusal codes', async () => {
    expect(await setDailyReportValidateRoles(['site_supervisor'])).toEqual(['site_supervisor']);
    expect(h.rpcCall).toEqual({
      fn: 'set_daily_report_validate_roles',
      args: { p_roles: ['site_supervisor'] },
    });

    h.rpcErr = { message: 'DSR_VALIDATE_ROLE_ADMIN: admin only', code: '42501' };
    await expect(setDailyReportValidateRoles(['site_supervisor'])).rejects.toMatchObject({
      message: 'DSR_VALIDATE_ROLE_ADMIN: admin only',
      code: '42501',
    });
  });
});
