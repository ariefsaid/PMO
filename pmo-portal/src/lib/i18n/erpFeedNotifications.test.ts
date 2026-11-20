import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyFinanceUnassignedInvoice, surfaceActionRequired } from '../../../../supabase/functions/_shared/erpFeedNotifications';

function client() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), contains: vi.fn(), limit: vi.fn(), in: vi.fn() };
  for (const fn of [query.select, query.eq, query.is, query.contains]) fn.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [], error: null });
  query.in.mockResolvedValue({ data: [{ id: 'recipient' }], error: null });
  const db = { from: (table: string) => table === 'notifications' ? { ...query, insert } : query } as unknown as SupabaseClient;
  return { db, insert };
}

describe('structured ERP notifications', () => {
  it('passes invoice identifiers and amounts as parameters', async () => {
    const { db, insert } = client();
    await notifyFinanceUnassignedInvoice(db, 'org', { salesInvoiceId: 'i', siNumber: 'Project Phoenix', amount: 42 });
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ message_key: 'unassignedInvoice', message_params: { invoice: 'Project Phoenix', amount: ' (42)' } })]);
  });
  it.each([
    ['budget-archive-cancellation-held', 'budgetCancellationHeld'],
    ['budget-archive-resume-actor-unauthorized', 'budgetRetryAuthorization'],
  ])('maps the %s app notification to %s', async (action, key) => {
    const { db, insert } = client();
    await surfaceActionRequired(db, 'org', action, {});
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ message_key: key, message_params: {} })]);
  });
  it('passes an ERP error as a parameter rather than app template text', async () => {
    const { db, insert } = client();
    await surfaceActionRequired(db, 'org', 'budget-push-failed', { reason: 'Project Phoenix' });
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ message_key: 'budgetPushFailed', message_params: { reason: 'Project Phoenix' } })]);
  });
});
