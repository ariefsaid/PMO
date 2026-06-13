import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    single: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'single') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.single = chain('single');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listActivities, createActivity } from './crmActivities';
import { AppError } from '@/src/lib/appError';

const input = {
  contact_id: 'ct1',
  kind: 'Call' as const,
  subject: 'Kickoff',
  body: 'Discussed scope',
  occurred_at: '2026-06-14T10:00:00.000Z',
  company_id: null,
  project_id: null,
};

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-CRM-023 listActivities', () => {
  it('AC-CRM-023: selects a contact\'s activities ordered occurred_at desc, never sends org_id', async () => {
    h.result.value = { data: [{ id: 'a1', kind: 'Call' }], error: null };
    const rows = await listActivities('ct1');
    expect(h.calls.from).toEqual(['crm_activities']);
    expect(h.calls.eq).toContainEqual(['contact_id', 'ct1']);
    expect(h.calls.order).toContainEqual(['occurred_at', { ascending: false }]);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(rows[0].id).toBe('a1');
  });

  it('AC-CRM-023: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listActivities('ct1')).resolves.toEqual([]);
  });

  it('AC-CRM-023: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listActivities('ct1')).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-CRM-023 createActivity', () => {
  it('AC-CRM-023: inserts contact_id/kind/subject/body/occurred_at + logged_by_id, NEVER org_id', async () => {
    h.result.value = { data: { id: 'new', kind: 'Call' }, error: null };
    const row = await createActivity(input, 'user-1');
    expect(h.calls.from).toEqual(['crm_activities']);
    const payload = h.calls.insert[0] as Record<string, unknown>;
    expect(payload.contact_id).toBe('ct1');
    expect(payload.kind).toBe('Call');
    expect(payload.subject).toBe('Kickoff');
    expect(payload.body).toBe('Discussed scope');
    expect(payload.occurred_at).toBe('2026-06-14T10:00:00.000Z');
    expect(payload.logged_by_id).toBe('user-1');
    expect(JSON.stringify(payload)).not.toContain('org_id');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-CRM-023: passes a null logged_by when the caller has no id', async () => {
    h.result.value = { data: { id: 'new' }, error: null };
    await createActivity(input, null);
    const payload = h.calls.insert[0] as Record<string, unknown>;
    expect(payload.logged_by_id).toBeNull();
  });

  it('AC-CRM-023: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(createActivity(input, 'user-1')).rejects.toMatchObject({ code: '42501' });
  });
});
