import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `OD-TAX-1` / migration 0207 — the org-wide tax-treatment default, at the DAL seam.
 *
 * The read is every member's (a form cannot pre-select what it cannot read); the write is
 * Admin-only at the RLS layer. What these tests actually pin is the SHAPE of both calls, because
 * the shape is the safety property: the read asks for exactly one column and never sends `org_id`,
 * and the write targets the row the DATABASE said was readable rather than an id the client
 * asserted about itself.
 */
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = {
    from: [] as string[],
    select: [] as unknown[],
    limit: [] as unknown[],
    update: [] as unknown[],
    eq: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: 'select' | 'limit' | 'update' | 'eq') => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.limit = chain('limit');
  builder.update = chain('update');
  builder.eq = chain('eq');
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve(queue.shift() ?? { data: null, error: null });
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, queue };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getOrgTaxDefault, setOrgTaxDefault } from './orgs';

beforeEach(() => {
  h.from.mockClear();
  h.queue.length = 0;
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
});

describe('getOrgTaxDefault — the pre-selection, read from the org row (OD-TAX-1, 0207)', () => {
  it('reads organizations.default_tax_treatment and never sends org_id (RLS scopes the row)', async () => {
    h.queue.push({ data: [{ default_tax_treatment: 'inclusive' }], error: null });
    await expect(getOrgTaxDefault()).resolves.toBe('inclusive');
    expect(h.calls.from).toEqual(['organizations']);
    expect(h.calls.select).toEqual(['default_tax_treatment']);
    expect(h.calls.limit).toEqual([1]);
    expect(h.calls.eq).toEqual([]);
  });

  it('returns the OTHER value when the org holds it — the read is not a constant wearing a query', async () => {
    h.queue.push({ data: [{ default_tax_treatment: 'exclusive' }], error: null });
    await expect(getOrgTaxDefault()).resolves.toBe('exclusive');
  });

  it('returns null — never a guessed marker — when no org row is visible', async () => {
    h.queue.push({ data: [], error: null });
    await expect(getOrgTaxDefault()).resolves.toBeNull();
  });

  it('returns null for an out-of-domain value rather than passing it to a form', async () => {
    // A CHECK relaxation, a typo'd seed, a future third basis: none of them may reach a select and
    // be submitted as if a person had chosen it.
    h.queue.push({ data: [{ default_tax_treatment: 'inklusif' }], error: null });
    await expect(getOrgTaxDefault()).resolves.toBeNull();
  });

  it('throws on a query error instead of resolving to a silently wrong pre-selection', async () => {
    h.queue.push({ data: null, error: { message: 'rls denied' } });
    await expect(getOrgTaxDefault()).rejects.toThrow('rls denied');
  });
});

describe('setOrgTaxDefault — Admin-only write, targeted at the row RLS returned', () => {
  it('updates ONLY default_tax_treatment, on the id the database handed back', async () => {
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    h.queue.push({ data: null, error: null });
    await setOrgTaxDefault('inclusive');
    expect(h.calls.from).toEqual(['organizations', 'organizations']);
    expect(h.calls.update).toEqual([{ default_tax_treatment: 'inclusive' }]);
    expect(h.calls.eq).toEqual([['id', 'org-1']]);
  });

  it('writes the value it was given — both directions of the domain', async () => {
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    h.queue.push({ data: null, error: null });
    await setOrgTaxDefault('exclusive');
    expect(h.calls.update).toEqual([{ default_tax_treatment: 'exclusive' }]);
  });

  it('refuses to write at all when no org row is readable — no unfiltered UPDATE', async () => {
    h.queue.push({ data: [], error: null });
    await expect(setOrgTaxDefault('inclusive')).rejects.toThrow(/no organization/i);
    expect(h.calls.update).toEqual([]);
  });

  it('surfaces the RLS refusal of a non-Admin rather than reporting success', async () => {
    h.queue.push({ data: [{ id: 'org-1' }], error: null });
    h.queue.push({ data: null, error: { message: 'new row violates row-level security policy' } });
    await expect(setOrgTaxDefault('inclusive')).rejects.toThrow(/row-level security/);
  });
});
