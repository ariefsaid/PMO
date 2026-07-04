import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    order: [] as unknown[],
    update: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.order = chain('order');
  builder.update = chain('update');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listRunEvents, rateAgentEvent } from './agentEvents';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-AGP-021 listRunEvents', () => {
  it('listRunEvents orders by seq ascending, scoped to the given run_id', async () => {
    h.result.value = {
      data: [
        { id: 'e1', run_id: 'run-1', seq: 1, type: 'user' },
        { id: 'e2', run_id: 'run-1', seq: 2, type: 'assistant' },
      ],
      error: null,
    };
    const rows = await listRunEvents('run-1');

    expect(h.calls.from).toEqual(['agent_events']);
    expect(h.calls.eq).toContainEqual(['run_id', 'run-1']);
    expect(h.calls.order).toContainEqual(['seq', { ascending: true }]);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listRunEvents('run-1')).resolves.toEqual([]);
  });

  it('throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listRunEvents('run-1')).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listRunEvents('run-1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-AGP-022 rateAgentEvent', () => {
  it('rateAgentEvent sends only rating/downvote_reason, scoped by id', async () => {
    h.result.value = { data: null, error: null };
    await rateAgentEvent('e1', 'down', 'inaccurate');

    expect(h.calls.from).toEqual(['agent_events']);
    expect(h.calls.update).toEqual([{ rating: 'down', downvote_reason: 'inaccurate' }]);
    expect(h.calls.eq).toContainEqual(['id', 'e1']);
    expect(JSON.stringify(h.calls.update)).not.toContain('payload');
    expect(JSON.stringify(h.calls.update)).not.toContain('"text"');
    expect(JSON.stringify(h.calls.update)).not.toContain('type');
  });

  it('rateAgentEvent with no reason sends downvote_reason: null (thumbs-up path)', async () => {
    h.result.value = { data: null, error: null };
    await rateAgentEvent('e1', 'up');
    expect(h.calls.update).toEqual([{ rating: 'up', downvote_reason: null }]);
  });

  it('throws AppError preserving the PG code on a denied/non-owner update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(rateAgentEvent('e1', 'down', 'too_slow')).rejects.toMatchObject({ code: '42501' });
  });
});
