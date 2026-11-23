import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Record<string, unknown[]> = { from: [], insert: [], update: [], eq: [] };
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const rec = (name: string) => (...args: unknown[]) => { calls[name]?.push(args.length <= 1 ? args[0] : args); return builder; };
  for (const m of ['select', 'insert', 'update', 'eq', 'order', 'range']) builder[m] = rec(m);
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return { calls, from: vi.fn((t: string) => { calls.from.push(t); return builder; }), set: (r: typeof result) => { result = r; } };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { addIncidentType, listIncidentTypes, renameIncidentType, setIncidentTypeArchived } from './incidentTypes';
import { AppError } from '@/src/lib/appError';

beforeEach(() => { for (const k of Object.keys(h.calls)) h.calls[k].length = 0; h.set({ data: [], error: null }); });

describe('incident types DAL (AC-ICM-010)', () => {
  it('lists the organisation types', async () => {
    h.set({ data: [{ id: 't1', label: 'Civil', archived_at: null }], error: null });
    await expect(listIncidentTypes()).resolves.toEqual([{ id: 't1', label: 'Civil', archived_at: null }]);
    expect(h.calls.from).toContain('incident_types');
  });
  it('adds a trimmed label and never sends org_id', async () => {
    await addIncidentType('  Civil ');
    expect(h.calls.insert).toEqual([{ label: 'Civil' }]);
  });
  it('renames and archives by id', async () => {
    await renameIncidentType('t1', ' Civil works ');
    expect(h.calls.update[0]).toEqual({ label: 'Civil works' });
    await setIncidentTypeArchived('t1', true);
    expect(h.calls.update[1]).toMatchObject({ archived_at: expect.any(String) });
    await setIncidentTypeArchived('t1', false);
    expect(h.calls.update[2]).toEqual({ archived_at: null });
  });
  it('surfaces a refusal as an AppError with its code', async () => {
    h.set({ data: null, error: { message: 'duplicate key', code: '23505' } });
    await expect(addIncidentType('Civil')).rejects.toBeInstanceOf(AppError);
  });
});
