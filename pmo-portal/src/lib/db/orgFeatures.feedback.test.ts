import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { setFeedbackSurveys } from './orgFeatures';

beforeEach(() => rpc.mockReset());

describe('AC-PHO-101 setFeedbackSurveys', () => {
  it('calls the Admin RPC with the flag and no org id (the server stamps the caller org)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await setFeedbackSurveys(false);
    expect(rpc).toHaveBeenCalledWith('admin_set_feedback_surveys', { p_enabled: false });
  });

  it('surfaces a denied write as an AppError carrying the code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin_only', code: '42501' } });
    await expect(setFeedbackSurveys(true)).rejects.toMatchObject({ code: '42501' });
  });
});
