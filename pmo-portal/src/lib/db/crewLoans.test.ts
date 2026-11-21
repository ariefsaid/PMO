import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/** #2704 — the crew loans DAL. Writes never send org_id; a correction names the version it read; a refusal keeps its Postgres code. */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls = { from: [] as string[], rpc: [] as Array<[string, unknown]>, insert: [] as unknown[], update: [] as unknown[], eq: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => { (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'order', 'gt', 'limit'] as const) builder[k] = () => builder;
  for (const k of ['insert', 'update', 'eq'] as const) builder[k] = chain(k);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as loans from './crewLoans';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
});

const input = { worker_id: 'w', home_crew_id: 'a', host_crew_id: 'b', valid_from: '2026-11-10', valid_to: '2026-11-14' };

describe('#2704 crew loans DAL', () => {
  it('creates a loan without sending org_id', async () => {
    await loans.createCrewLoan(input);
    expect(h.calls.from).toEqual(['crew_loans']);
    expect(h.calls.insert).toEqual([input]);
  });

  it('keeps the Postgres code of a refusal', async () => {
    h.result.value = { data: null, error: { message: 'conflicting key value violates exclusion constraint "crew_loans_no_overlap"', code: '23P01' } };
    await expect(loans.createCrewLoan(input)).rejects.toMatchObject({ code: '23P01' });
  });

  it('lists loans newest first', async () => {
    h.result.value = { data: [
      { id: '1', worker_id: 'w', home_crew_id: 'a', host_crew_id: 'b', valid_from: '2026-11-01', valid_to: '2026-11-02', version: 1 },
      { id: '2', worker_id: 'w', home_crew_id: 'a', host_crew_id: 'b', valid_from: '2026-11-10', valid_to: '2026-11-12', version: 1 },
    ], error: null };
    expect((await loans.listAllCrewLoans()).map((l) => l.id)).toEqual(['2', '1']);
  });

  it('corrects dates by version and throws when the row changed', async () => {
    h.result.value = { data: [{ id: 'x' }], error: null };
    await loans.correctCrewLoan('x', 3, { valid_from: '2026-11-10', valid_to: '2026-11-11' });
    expect(h.calls.eq).toEqual([['id', 'x'], ['version', 3]]);
    h.result.value = { data: [], error: null };
    await expect(loans.correctCrewLoan('x', 3, { valid_from: '2026-11-10', valid_to: '2026-11-11' })).rejects.toBeInstanceOf(AppError);
  });

  it('reads the setting as off unless it is exactly true', async () => {
    h.result.value = { data: [{ crew_loans_enabled: true }], error: null };
    expect(await loans.getCrewLoansEnabled()).toBe(true);
    h.result.value = { data: [{ crew_loans_enabled: null }], error: null };
    expect(await loans.getCrewLoansEnabled()).toBe(false);
    h.result.value = { data: [], error: null };
    expect(await loans.getCrewLoansEnabled()).toBe(false);
  });

  it('sets the setting through the Admin RPC', async () => {
    await loans.setCrewLoansEnabled(true);
    expect(h.calls.rpc).toEqual([['set_org_crew_loans_enabled', { p_enabled: true }]]);
  });
});
