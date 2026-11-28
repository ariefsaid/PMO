import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder. Each terminal call
// (the awaited one) resolves the queued result; we assert the recorded calls.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    gt: [] as unknown[],
    limit: [] as unknown[],
    insert: [] as unknown[],
    upsert: [] as unknown[],
    update: [] as unknown[],
    delete: 0,
    single: 0,
    maybeSingle: 0,
    range: [] as unknown[],
  };
  // The builder is thenable so `await builder` resolves `result.value`; every
  // method returns the same builder for arbitrary chaining order.
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
  builder.gt = chain('gt');
  builder.limit = chain('limit');
  builder.insert = chain('insert');
  builder.upsert = chain('upsert');
  builder.update = chain('update');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
  builder.range = chain('range');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  listClientCompanies,
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  archiveCompany,
  deleteCompany,
  setCompanyProjectNumberSegment,
  getCompanyTaxNumber,
  setCompanyTaxNumber,
} from './companies';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('listClientCompanies', () => {
  it("selects companies where type = 'Client' (FR-DAL-005)", async () => {
    h.result.value = { data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }], error: null };
    const result = await listClientCompanies();
    expect(h.calls.from).toEqual(['companies']);
    expect(h.calls.eq).toContainEqual(['type', 'Client']);
    expect(result[0].name).toBe('Innovate Corp');
  });
  it('excludes archived companies from the FK picker (archived_at IS NULL)', async () => {
    // An archived company must never be selectable as a project/opportunity client.
    h.result.value = { data: [], error: null };
    await listClientCompanies();
    expect(h.calls.is).toContainEqual(['archived_at', null]);
  });
  it('throws on error', async () => {
    h.result.value = { data: null, error: { message: 'boom' } };
    await expect(listClientCompanies()).rejects.toThrow('boom');
  });
});

describe('AC-CO-001 listCompanies (all companies, archived hidden by default)', () => {
  it('AC-CO-001: selects all companies, excludes archived, never sends org_id, ordered by name', async () => {
    h.result.value = {
      data: [{ id: 'c1', name: 'Acme', type: 'Vendor', archived_at: null }],
      error: null,
    };
    const result = await listCompanies();
    expect(h.calls.from).toEqual(['companies']);
    // archived hidden by default → filters on archived_at IS NULL
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    // no type filter applied when none requested
    expect(h.calls.eq).not.toContainEqual(['type', expect.anything()]);
    // org_id is never sent on a read (RLS scopes it)
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(result[0].name).toBe('Acme');
  });

  it('AC-CO-001: applies the optional type filter (Internal/Client/Vendor)', async () => {
    h.result.value = { data: [], error: null };
    await listCompanies({ type: 'Vendor' });
    expect(h.calls.eq).toContainEqual(['type', 'Vendor']);
    expect(h.calls.is).toContainEqual(['archived_at', null]);
  });

  it('AC-CO-001: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listCompanies()).resolves.toEqual([]);
  });

  it('AC-CO-001: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listCompanies()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listCompanies()).rejects.toBeInstanceOf(AppError);
  });

  it('data-layer perf hardening #4: does NOT range-bound the query when called with no params (opt-in pagination)', async () => {
    h.result.value = { data: [], error: null };
    await listCompanies();
    expect(h.calls.range).toEqual([]);
  });

});

describe('AC-CO-002 getCompany', () => {
  it('AC-CO-002: selects a single company by id, no org_id', async () => {
    h.result.value = { data: { id: 'c1', name: 'Acme', type: 'Client', archived_at: null }, error: null };
    const row = await getCompany('c1');
    expect(h.calls.from).toEqual(['companies']);
    expect(h.calls.eq).toContainEqual(['id', 'c1']);
    expect(h.calls.maybeSingle).toBe(1);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(row?.name).toBe('Acme');
  });

  it('AC-CO-002: returns null when no row found', async () => {
    h.result.value = { data: null, error: null };
    await expect(getCompany('missing')).resolves.toBeNull();
  });

  it('AC-CO-002: throws AppError with code on error', async () => {
    h.result.value = { data: null, error: { message: 'kaboom', code: 'PGRST116x' } };
    await expect(getCompany('c1')).rejects.toMatchObject({ code: 'PGRST116x' });
  });
});

describe('AC-CO-003 createCompany', () => {
  it('AC-CO-003: inserts only name + type, NEVER org_id, returns the new row', async () => {
    h.result.value = { data: { id: 'new', name: 'Globex', type: 'Vendor', archived_at: null }, error: null };
    const row = await createCompany({ name: 'Globex', type: 'Vendor' });
    expect(h.calls.from).toEqual(['companies']);
    expect(h.calls.insert).toEqual([{ name: 'Globex', type: 'Vendor' }]);
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-CO-003: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(createCompany({ name: 'X', type: 'Client' })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-CO-004 updateCompany', () => {
  it('AC-CO-004: updates name + type by id, NEVER org_id', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await updateCompany('c1', { name: 'Renamed', type: 'Internal' });
    expect(h.calls.from).toEqual(['companies']);
    expect(h.calls.update).toEqual([{ name: 'Renamed', type: 'Internal' }]);
    expect(h.calls.eq).toContainEqual(['id', 'c1']);
    expect(JSON.stringify(h.calls.update)).not.toContain('org_id');
  });

  it('AC-CO-004: throws AppError with code on a denied update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(updateCompany('c1', { name: 'Y', type: 'Client' })).rejects.toMatchObject({ code: '42501' });
  });

  it('#534: a using-denied update (0 rows matched, no error) throws 42501 instead of resolving as success', async () => {
    h.result.value = { data: [], error: null };
    await expect(updateCompany('c1', { name: 'Y', type: 'Client' })).rejects.toBeInstanceOf(AppError);
    await expect(updateCompany('c1', { name: 'Y', type: 'Client' })).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.update.length).toBeGreaterThan(0);
  });
});

describe('AC-CODE-001 company-local project number segment', () => {
  it('AC-CODE-001 sends only the trimmed segment through its PMO-local update', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await setCompanyProjectNumberSegment('c1', '  ACME  ');
    expect(h.calls.update).toEqual([{ client_number_segment: 'ACME' }]);
    expect(h.calls.eq).toContainEqual(['id', 'c1']);
  });

  it('AC-CODE-001 clears an optional company segment to NULL', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await setCompanyProjectNumberSegment('c1', '   ');
    expect(h.calls.update).toEqual([{ client_number_segment: null }]);
  });
});

describe('AC-CO-005 archiveCompany', () => {
  it('AC-CO-005: sets archived_at via update by id, NEVER org_id', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await archiveCompany('c1');
    expect(h.calls.from).toEqual(['companies']);
    // a single update that sets archived_at
    expect(h.calls.update).toHaveLength(1);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toHaveProperty('archived_at');
    expect(patch.archived_at).not.toBeNull();
    expect(h.calls.eq).toContainEqual(['id', 'c1']);
    expect(JSON.stringify(patch)).not.toContain('org_id');
  });

  it('AC-CO-005: throws AppError with code on a denied archive', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(archiveCompany('c1')).rejects.toMatchObject({ code: '42501' });
  });

  it('#534: a using-denied archive (0 rows matched, no error) throws 42501 instead of resolving as success', async () => {
    h.result.value = { data: [], error: null };
    await expect(archiveCompany('c1')).rejects.toBeInstanceOf(AppError);
    await expect(archiveCompany('c1')).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.update.length).toBeGreaterThan(0);
  });
});

describe('AC-CO-006 deleteCompany (hard-delete; FK RESTRICT surfaces 23503)', () => {
  it('AC-CO-006: deletes by id, NEVER org_id', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await deleteCompany('c1');
    expect(h.calls.from).toEqual(['companies']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'c1']);
    expect(JSON.stringify(h.calls.eq)).not.toContain('org_id');
  });

  it('AC-CO-006: surfaces the FK violation as AppError preserving code 23503 (in-use company)', async () => {
    h.result.value = {
      data: null,
      error: { message: 'update or delete on table "companies" violates foreign key constraint', code: '23503' },
    };
    const err = await deleteCompany('c1').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('23503');
  });

  it('AC-CO-006: throws AppError with code 42501 when RLS denies the delete', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(deleteCompany('c1')).rejects.toMatchObject({ code: '42501' });
  });

  it('#534: a using-denied delete (0 rows matched, no error) throws 42501 instead of resolving as success', async () => {
    h.result.value = { data: [], error: null };
    await expect(deleteCompany('c1')).rejects.toBeInstanceOf(AppError);
    await expect(deleteCompany('c1')).rejects.toMatchObject({ code: '42501' });
    expect(h.calls.delete).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-3025 — the PMO-native vendor master data (vendor code, address, payment
// terms). The payload shapes mirror short_name's: present when supplied (a
// blank trims to null so clearing works), omitted entirely when not.
// ---------------------------------------------------------------------------

describe('AC-3025 vendor fields in createCompany', () => {
  it('inserts the vendor fields it is given, trimming blanks to null, and never org_id', async () => {
    h.result.value = { data: { id: 'new', name: 'Globex', type: 'Vendor' }, error: null };
    await createCompany({
      name: 'Globex', type: 'Vendor',
      vendor_code: ' VEN-0077 ', address: ' Jl. Raya 12 ', payment_terms_days: 30,
    });
    expect(h.calls.insert).toEqual([{
      name: 'Globex', type: 'Vendor',
      vendor_code: 'VEN-0077', address: 'Jl. Raya 12', payment_terms_days: 30,
    }]);
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
  });

  it('omits the vendor keys when they are not supplied', async () => {
    h.result.value = { data: { id: 'new', name: 'Globex', type: 'Client' }, error: null };
    await createCompany({ name: 'Globex', type: 'Client' });
    expect(h.calls.insert).toEqual([{ name: 'Globex', type: 'Client' }]);
  });

  it('clears a supplied-but-blank vendor field to null', async () => {
    h.result.value = { data: { id: 'new', name: 'Globex', type: 'Vendor' }, error: null };
    await createCompany({ name: 'Globex', type: 'Vendor', vendor_code: '   ', payment_terms_days: null });
    expect(h.calls.insert).toEqual([{ name: 'Globex', type: 'Vendor', vendor_code: null, payment_terms_days: null }]);
  });
});

describe('AC-3025 vendor fields in updateCompany', () => {
  it('updates the vendor fields by id, never org_id', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await updateCompany('c1', { name: 'Renamed', type: 'Vendor', vendor_code: 'VEN-1', address: 'Jakarta', payment_terms_days: 14 });
    expect(h.calls.update).toEqual([{
      name: 'Renamed', type: 'Vendor', vendor_code: 'VEN-1', address: 'Jakarta', payment_terms_days: 14,
    }]);
    expect(JSON.stringify(h.calls.update)).not.toContain('org_id');
  });

  it('omits the vendor keys for an input that does not carry them', async () => {
    h.result.value = { data: [{ id: 'c1' }], error: null };
    await updateCompany('c1', { name: 'Renamed', type: 'Client' });
    expect(h.calls.update).toEqual([{ name: 'Renamed', type: 'Client' }]);
  });
});

// ---------------------------------------------------------------------------
// AC-3025 slice 2 — the vendor's tax number rides its own side table
// (company_tax_numbers): reads and writes are the four vendor-edit roles'
// business; this layer only pins the payload shapes.
// ---------------------------------------------------------------------------

describe('AC-3025 slice 2 companyTaxNumber DAL', () => {
  it('reads the single row for the company', async () => {
    h.result.value = { data: { tax_number: '01.234.567.8-901.000' }, error: null };
    await expect(getCompanyTaxNumber('v1')).resolves.toBe('01.234.567.8-901.000');
    expect(h.calls.from).toEqual(['company_tax_numbers']);
    expect(h.calls.eq).toContainEqual(['company_id', 'v1']);
  });

  it('upserts by company_id and trims the value, never sending org_id', async () => {
    h.result.value = { data: null, error: null };
    await setCompanyTaxNumber('v1', ' 01.234.567.8-901.000 ');
    expect((h.calls.upsert[0] as unknown[])[0]).toEqual({ company_id: 'v1', tax_number: '01.234.567.8-901.000' });
    expect(JSON.stringify(h.calls.upsert)).not.toContain('org_id');
  });

  it('clearing deletes the row for the company; nothing to clear is a no-op', async () => {
    h.result.value = { data: { tax_number: 'x' }, error: null };
    await setCompanyTaxNumber('v1', null);
    expect(h.calls.delete).toBeGreaterThan(0);
    expect(h.calls.eq).toContainEqual(['company_id', 'v1']);

    h.calls.delete = 0;
    h.result.value = { data: null, error: null };
    await setCompanyTaxNumber('v1', null);
    expect(h.calls.delete).toBe(0);
  });
});
