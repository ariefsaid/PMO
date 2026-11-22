import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    rpc: h.rpc,
    from: (table: string) => ({
      select: () => (table === 'org_billing_plan_settings'
        ? { maybeSingle: h.maybeSingle }
        : { order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  },
}));

import { getPlanSettings, savePlanReminder } from './billingPlan';

beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: null, error: null }); h.maybeSingle.mockReset(); });

describe('billing plan reminder DAL (#2675)', () => {
  it('AC-DNC-005 saves the switch and the day limit through the reminder writer', async () => {
    await savePlanReminder({ reminderOn: true, afterDays: 14 });
    expect(h.rpc).toHaveBeenCalledWith('set_billing_plan_reminder', { p_reminder_on: true, p_after_days: 14 });
  });
  it('AC-DNC-007 a refused write throws with the database reason', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'bad', code: '23514', details: 'after-days-invalid' } });
    await expect(savePlanReminder({ reminderOn: true, afterDays: 0 })).rejects.toMatchObject({ code: 'after-days-invalid' });
  });
  it('AC-DNC-003 reads the limit, and no row means reminder off with no limit', async () => {
    h.maybeSingle.mockResolvedValue({ data: { monthly_target: null, target_currency: null, done_not_claimed_reminder_on: true, done_not_claimed_after_days: 7 }, error: null });
    expect(await getPlanSettings()).toMatchObject({ reminderOn: true, doneNotClaimedAfterDays: 7 });
    h.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getPlanSettings()).toMatchObject({ reminderOn: false, doneNotClaimedAfterDays: null });
  });
});
