import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder (cloned from companies.test.ts).
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
  listContacts,
  listContactsByCompany,
  getContact,
  createContact,
  updateContact,
  archiveContact,
  deleteContact,
} from './contacts';
import { AppError } from '@/src/lib/appError';

const input = {
  company_id: 'co1',
  full_name: 'Jane Doe',
  title: 'Buyer',
  email: 'jane@example.com',
  phone: '555-0100',
  notes: null,
};

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-CRM-020 listContacts', () => {
  it('AC-CRM-020: selects non-archived contacts ordered by name, never sends org_id', async () => {
    h.result.value = {
      data: [{ id: 'ct1', full_name: 'Aaron', archived_at: null }],
      error: null,
    };
    const rows = await listContacts();
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual('full_name');
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(rows[0].full_name).toBe('Aaron');
  });

  it('AC-CRM-020: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listContacts()).resolves.toEqual([]);
  });

  it('AC-CRM-020: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listContacts()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listContacts()).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-CRM-021 listContactsByCompany', () => {
  it('AC-CRM-021: filters company_id + non-archived, ordered by name', async () => {
    h.result.value = { data: [], error: null };
    await listContactsByCompany('co1');
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.eq).toContainEqual(['company_id', 'co1']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    expect(h.calls.order).toContainEqual('full_name');
  });
});

describe('AC-CRM-022 getContact', () => {
  it('AC-CRM-022: selects a single contact by id (maybeSingle), no org_id', async () => {
    h.result.value = { data: { id: 'ct1', full_name: 'Jane' }, error: null };
    const row = await getContact('ct1');
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.eq).toContainEqual(['id', 'ct1']);
    expect(h.calls.maybeSingle).toBe(1);
    expect(row?.full_name).toBe('Jane');
  });

  it('AC-CRM-022: returns null when no row found', async () => {
    h.result.value = { data: null, error: null };
    await expect(getContact('missing')).resolves.toBeNull();
  });
});

describe('AC-CRM-022 createContact', () => {
  it('AC-CRM-022: inserts the input fields, NEVER org_id, returns the new row', async () => {
    h.result.value = { data: { id: 'new', full_name: 'Jane Doe' }, error: null };
    const row = await createContact(input);
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.insert).toHaveLength(1);
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect((h.calls.insert[0] as Record<string, unknown>).full_name).toBe('Jane Doe');
    expect((h.calls.insert[0] as Record<string, unknown>).company_id).toBe('co1');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-CRM-022: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(createContact(input)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-CRM-022 updateContact', () => {
  it('AC-CRM-022: updates by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await updateContact('ct1', input);
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.update).toHaveLength(1);
    expect(JSON.stringify(h.calls.update)).not.toContain('org_id');
    expect(h.calls.eq).toContainEqual(['id', 'ct1']);
  });
});

describe('AC-CRM-022 archiveContact', () => {
  it('AC-CRM-022: sets archived_at via update by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await archiveContact('ct1');
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.update).toHaveLength(1);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toHaveProperty('archived_at');
    expect(patch.archived_at).not.toBeNull();
    expect(h.calls.eq).toContainEqual(['id', 'ct1']);
    expect(JSON.stringify(patch)).not.toContain('org_id');
  });
});

describe('AC-CRM-022 deleteContact', () => {
  it('AC-CRM-022: deletes by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await deleteContact('ct1');
    expect(h.calls.from).toEqual(['contacts']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'ct1']);
  });

  it('AC-CRM-022: throws AppError with code on a denied delete', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(deleteContact('ct1')).rejects.toMatchObject({ code: '42501' });
  });
});
