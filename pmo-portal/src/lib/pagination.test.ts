import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_SIZE, resolveRange, type PageParams } from './pagination';

describe('resolveRange (data-layer performance hardening #4 — pagination)', () => {
  // Pagination is OPT-IN per call: an omitted `params` (or a `params` with no `page`/`pageSize`
  // field at all) must return `undefined` — NOT a default range — so a DAL function backward-
  // compatibly preserves today's unbounded-list behavior for every existing caller (e.g. the
  // ⌘K CommandPalette record search, which reads the FULL cached list client-side). Only a
  // caller that explicitly passes `page` and/or `pageSize` opts into a bounded `.range()`.
  it('returns undefined when no params are given (no behavior change for existing callers)', () => {
    expect(resolveRange()).toBeUndefined();
  });

  it('returns undefined when params is an empty object (no page/pageSize field present)', () => {
    expect(resolveRange({})).toBeUndefined();
  });

  it('computes [from, to] for a given page + explicit pageSize', () => {
    const params: PageParams = { page: 2, pageSize: 20 };
    expect(resolveRange(params)).toEqual({ from: 40, to: 59 });
  });

  it('uses DEFAULT_PAGE_SIZE when only page is given', () => {
    expect(resolveRange({ page: 1 })).toEqual({
      from: DEFAULT_PAGE_SIZE,
      to: DEFAULT_PAGE_SIZE * 2 - 1,
    });
  });

  it('uses page 0 when only pageSize is given', () => {
    expect(resolveRange({ pageSize: 10 })).toEqual({ from: 0, to: 9 });
  });

  it('clamps a negative page to 0', () => {
    expect(resolveRange({ page: -3, pageSize: 10 })).toEqual({ from: 0, to: 9 });
  });
});
