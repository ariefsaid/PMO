import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2698 — the payment channel DAL reads the switch, list and a request's channel, and calls only the 1356 RPCs. */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const chain: Record<string, unknown> = {};
  const done = () => Promise.resolve(result.value);
  for (const k of ['select', 'eq', 'in', 'not', 'order']) chain[k] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(done);
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done().then(res, rej);
  return { rpc: vi.fn(() => Promise.resolve(result.value)), from: vi.fn(() => chain), result, chain };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import {
  archivePaymentChannel, getPaymentChannelNames, getPaymentChannelsEnabled, getProcurementPaymentChannel, listPaymentChannels,
  savePaymentChannel, setPaymentChannelsEnabled, setProcurementPaymentChannel,
} from './paymentChannels';

beforeEach(() => { h.rpc.mockClear(); h.from.mockClear(); h.result.value = { data: null, error: null }; });

describe('payment channel DAL (#2698)', () => {
  it('AC-PCH-001 no settings row reads as off', async () => {
    expect(await getPaymentChannelsEnabled()).toBe(false);
    expect(h.from).toHaveBeenCalledWith('org_payment_channel_settings');
    h.result.value = { data: { enabled: true }, error: null };
    expect(await getPaymentChannelsEnabled()).toBe(true);
  });

  it('AC-PCH-011 lists the channels with their archived flag', async () => {
    h.result.value = { data: [{ id: 'c1', name: 'Cash', archived_at: null }, { id: 'c2', name: 'Card', archived_at: '2026-11-21T00:00:00Z' }], error: null };
    expect(await listPaymentChannels()).toEqual([{ id: 'c1', name: 'Cash', archived: false }, { id: 'c2', name: 'Card', archived: true }]);
  });

  it('AC-PCH-011 the Admin writes call their RPCs with no org, actor or stamp', async () => {
    await setPaymentChannelsEnabled(true);
    await savePaymentChannel(null, 'Wire');
    await archivePaymentChannel('c1', true);
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'set_payment_channel_settings', { p_enabled: true });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'save_payment_channel', { p_id: null, p_name: 'Wire' });
    expect(h.rpc).toHaveBeenNthCalledWith(3, 'archive_payment_channel', { p_id: 'c1', p_archived: true });
  });

  it('AC-PCH-010 sets and clears a request\'s channel through the RPC only', async () => {
    await setProcurementPaymentChannel('p1', 'c1');
    await setProcurementPaymentChannel('p1', null);
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'set_procurement_payment_channel', { p_id: 'p1', p_channel_id: 'c1' });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'set_procurement_payment_channel', { p_id: 'p1', p_channel_id: null });
  });

  it('AC-PCH-007 a refusal keeps its code', async () => {
    h.result.value = { data: null, error: { message: 'Payment channel edit is not permitted', code: '42501' } };
    await expect(setProcurementPaymentChannel('p1', 'c1')).rejects.toMatchObject({ code: '42501' });
  });

  it('AC-PCH-009 reads one request\'s channel and the names for a list', async () => {
    h.result.value = { data: { payment_channel_id: 'c1', payment_channel: { name: 'Cash' } }, error: null };
    expect(await getProcurementPaymentChannel('p1')).toEqual({ channelId: 'c1', name: 'Cash' });
    h.result.value = { data: [{ id: 'p1', payment_channel: { name: 'Cash' } }, { id: 'p2', payment_channel: null }], error: null };
    expect(await getPaymentChannelNames(['p1', 'p2'])).toEqual({ p1: 'Cash' });
    h.from.mockClear();
    expect(await getPaymentChannelNames([])).toEqual({});
    expect(h.from).not.toHaveBeenCalled();
  });
});
