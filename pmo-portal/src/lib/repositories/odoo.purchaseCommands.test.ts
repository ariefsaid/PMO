import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, ...unknown[]]> = [];
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'order']) chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain; };
  chain.then = (r: (v: unknown) => unknown) => r(result);
  return {
    calls,
    setResult: (r: typeof result) => { result = r; },
    from: vi.fn((t: string) => { calls.push(['from', t]); return chain; }),
    rpc: vi.fn(async (..._a: unknown[]): Promise<{ data: unknown; error: unknown }> => rpcResult),
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc, functions: { invoke: vi.fn() } } }));
import { odooRepository } from './odoo';

beforeEach(() => { vi.clearAllMocks(); h.calls.length = 0; });

const NOW = new Date('2026-11-03T12:00:00Z');
const row = (over: Record<string, unknown>) => ({ id: 'o1', state: 'pending', last_error: null, updated_at: '2026-11-03T11:00:00Z', actor_user_id: 'u1', payload: { erp_doc_kind: 'payment' }, ...over });

it('AC-OPP-080 reads this case\'s unsettled commands from the Odoo tier only, newest first', async () => {
  h.setResult({ data: [row({})], error: null });
  const out = await odooRepository.listPurchaseCommands('case-1', NOW);
  expect(h.calls).toContainEqual(['from', 'external_command_outbox']);
  expect(h.calls).toContainEqual(['eq', 'external_tier', 'odoo']);
  expect(h.calls).toContainEqual(['eq', 'domain', 'procurement']);
  expect(h.calls).toContainEqual(['eq', 'payload->>procurementId', 'case-1']);
  expect(h.calls).toContainEqual(['neq', 'state', 'confirmed']);
  expect(out).toEqual([{ id: 'o1', kind: 'payment', state: 'pending', lastError: null, updatedAt: '2026-11-03T11:00:00Z', actorUserId: 'u1' }]);
});

it('AC-OPP-080 a failed command older than a day is history, not news; a held or in-flight one never ages out', async () => {
  h.setResult({ data: [
    row({ id: 'old-failed', state: 'failed', updated_at: '2026-11-01T00:00:00Z' }),
    row({ id: 'new-failed', state: 'failed', updated_at: '2026-11-03T08:00:00Z' }),
    row({ id: 'old-held', state: 'held', updated_at: '2026-10-01T00:00:00Z' }),
  ], error: null });
  expect((await odooRepository.listPurchaseCommands('case-1', NOW)).map((c) => c.id)).toEqual(['new-failed', 'old-held']);
});

it('AC-OPP-080 a row of a kind the screen does not know is left out', async () => {
  h.setResult({ data: [row({ payload: { erp_doc_kind: 'something-else' } })], error: null });
  expect(await odooRepository.listPurchaseCommands('case-1', NOW)).toEqual([]);
});

it('AC-OPP-082 adopting names the Odoo payment by number; the model-qualified reference is built below the repository', async () => {
  await odooRepository.resolveHeldPayment({ outboxId: 'o1', resolution: 'adopt', paymentNumber: '42' });
  expect(h.rpc).toHaveBeenCalledWith('resolve_held_outbox_command', { p_outbox_id: 'o1', p_resolution: 'adopt', p_external_record_id: 'account.payment:42', p_reason: undefined });
});

it('AC-OPP-082 confirming absence names no document', async () => {
  await odooRepository.resolveHeldPayment({ outboxId: 'o1', resolution: 'absent', reason: 'checked' });
  expect(h.rpc).toHaveBeenCalledWith('resolve_held_outbox_command', { p_outbox_id: 'o1', p_resolution: 'absent', p_external_record_id: undefined, p_reason: 'checked' });
});

it('AC-OPP-082 a payment number that is not a positive whole number is refused before any call', async () => {
  for (const bad of ['', 'abc', '0', '-3', '4.5']) {
    await expect(odooRepository.resolveHeldPayment({ outboxId: 'o1', resolution: 'adopt', paymentNumber: bad })).rejects.toThrow();
  }
  expect(h.rpc).not.toHaveBeenCalled();
});

it('AC-OPP-082 the database refusal comes back as a plain error, not a raw one', async () => {
  h.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'not authorized' } });
  await expect(odooRepository.resolveHeldPayment({ outboxId: 'o1', resolution: 'absent' })).rejects.toMatchObject({ code: expect.any(String) });
});
