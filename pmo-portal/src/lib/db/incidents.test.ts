import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder. Each terminal call
// (the awaited one) resolves the queued result; we assert the recorded calls.
// Mirrors src/lib/db/companies.test.ts (the reference template).
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: 0,
    single: 0,
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'single' || name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  listIncidents,
  getIncident,
  createIncident,
  updateIncident,
  transitionIncident,
  deleteIncident,
} from './incidents';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-IN-001 listIncidents (org-scoped, newest first)', () => {
  it('AC-IN-001: selects all incidents in the org, never sends org_id, ordered by incident_date desc', async () => {
    h.result.value = {
      data: [{ id: 'i1', type: 'Near Miss', severity: 'Low', status: 'Open', incident_date: '2026-03-15' }],
      error: null,
    };
    const result = await listIncidents();
    expect(h.calls.from).toEqual(['incident_reports']);
    // org_id is never sent on a read (RLS scopes it)
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    // ordered by incident_date, newest first
    expect(h.calls.order).toContainEqual(['incident_date', { ascending: false }]);
    expect(result[0].type).toBe('Near Miss');
  });

  it('AC-IN-001: applies the optional status filter (Open/Investigating/Closed)', async () => {
    h.result.value = { data: [], error: null };
    await listIncidents({ status: 'Investigating' });
    expect(h.calls.eq).toContainEqual(['status', 'Investigating']);
  });

  it('AC-IN-001: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listIncidents()).resolves.toEqual([]);
  });

  it('AC-IN-001: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listIncidents()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listIncidents()).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-IN-002 getIncident', () => {
  it('AC-IN-002: selects a single incident by id, no org_id', async () => {
    h.result.value = { data: { id: 'i1', type: 'Spill', severity: 'High', status: 'Open' }, error: null };
    const row = await getIncident('i1');
    expect(h.calls.from).toEqual(['incident_reports']);
    expect(h.calls.eq).toContainEqual(['id', 'i1']);
    expect(h.calls.maybeSingle).toBe(1);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(row?.type).toBe('Spill');
  });

  it('AC-IN-002: returns null when no row found', async () => {
    h.result.value = { data: null, error: null };
    await expect(getIncident('missing')).resolves.toBeNull();
  });

  it('AC-IN-002: throws AppError with code on error', async () => {
    h.result.value = { data: null, error: { message: 'kaboom', code: 'PGRST116x' } };
    await expect(getIncident('i1')).rejects.toMatchObject({ code: 'PGRST116x' });
  });
});

describe('AC-IN-003 createIncident (any member files; reporter + org_id server-stamped)', () => {
  it('AC-IN-003: inserts the form fields, NEVER org_id, NEVER status (defaults Open server-side), returns the new row', async () => {
    h.result.value = {
      data: { id: 'new', type: 'Near Miss', severity: 'Medium', status: 'Open', incident_date: '2026-06-08' },
      error: null,
    };
    const row = await createIncident({
      incident_date: '2026-06-08',
      type: 'Near Miss',
      severity: 'Medium',
      location: 'Site B',
      description: 'Trip hazard',
    });
    expect(h.calls.from).toEqual(['incident_reports']);
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert).toMatchObject({
      incident_date: '2026-06-08',
      type: 'Near Miss',
      severity: 'Medium',
      location: 'Site B',
      description: 'Trip hazard',
    });
    // org_id, status and reported_by are NEVER sent by the client (RLS / column
    // default / DB trigger stamp them); only org_id is forbidden-by-RLS, status
    // defaults Open, reporter is server-resolved.
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(insert).not.toHaveProperty('status');
    expect(insert).not.toHaveProperty('id');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-IN-003: omits empty optional fields (location/description) so they persist as NULL', async () => {
    h.result.value = { data: { id: 'n2' }, error: null };
    await createIncident({ incident_date: '2026-06-08', type: 'Other', severity: 'Low' });
    const insert = h.calls.insert[0] as Record<string, unknown>;
    expect(insert).not.toHaveProperty('location');
    expect(insert).not.toHaveProperty('description');
  });

  it('AC-IN-003: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(
      createIncident({ incident_date: '2026-06-08', type: 'X', severity: 'Low' }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-IN-004 updateIncident (managers edit incident detail)', () => {
  it('AC-IN-004: updates the editable fields by id, NEVER org_id/status', async () => {
    h.result.value = { data: null, error: null };
    await updateIncident('i1', {
      incident_date: '2026-06-09',
      type: 'Spill',
      severity: 'High',
      location: 'HQ',
      description: 'Updated',
    });
    expect(h.calls.from).toEqual(['incident_reports']);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ type: 'Spill', severity: 'High' });
    expect(h.calls.eq).toContainEqual(['id', 'i1']);
    expect(JSON.stringify(h.calls.update)).not.toContain('org_id');
    expect(patch).not.toHaveProperty('status');
  });

  it('AC-IN-004: throws AppError with code on a denied update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(
      updateIncident('i1', { incident_date: '2026-06-09', type: 'Y', severity: 'Low' }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-IN-004 transitionIncident (Open→Investigating→Closed status workflow, managers only)', () => {
  it('AC-IN-004: sets ONLY status by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await transitionIncident('i1', 'Investigating');
    expect(h.calls.from).toEqual(['incident_reports']);
    expect(h.calls.update).toEqual([{ status: 'Investigating' }]);
    expect(h.calls.eq).toContainEqual(['id', 'i1']);
    expect(JSON.stringify(h.calls.update)).not.toContain('org_id');
  });

  it('AC-IN-004: throws AppError preserving 42501 when a non-manager update is denied by RLS', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(transitionIncident('i1', 'Closed')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-IN-005 deleteIncident (Admin only)', () => {
  it('AC-IN-005: deletes by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await deleteIncident('i1');
    expect(h.calls.from).toEqual(['incident_reports']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'i1']);
    expect(JSON.stringify(h.calls.eq)).not.toContain('org_id');
  });

  it('AC-IN-005: throws AppError with code 42501 when RLS denies the delete', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(deleteIncident('i1')).rejects.toMatchObject({ code: '42501' });
  });
});
