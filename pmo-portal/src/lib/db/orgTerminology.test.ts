/** AC-TR-005 (#2799): the overrides read is bounded by the registry (terms x languages), never a smaller constant. */
import { describe, it, expect, vi } from 'vitest';

const rows = vi.hoisted(() => ({ all: [] as Array<{ term_key: string; locale: string; singular: string; plural: string }> }));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: (n: number) => Promise.resolve({ data: rows.all.slice(0, n), error: null }) }) }),
  },
}));

import { listOrgTerminology } from './orgTerminology';
import { TERM_KEYS, TERM_LOCALES } from '@/src/lib/i18n/orgTerms';

describe('AC-TR-005 listOrgTerminology', () => {
  it('returns every saved override when all terms are renamed in both languages', async () => {
    rows.all = TERM_KEYS.flatMap((k) => TERM_LOCALES.map((l) => ({ term_key: k, locale: l, singular: `x ${k}`, plural: `xs ${k}` })));
    expect(rows.all.length).toBeGreaterThan(50);
    const terms = await listOrgTerminology();
    expect(Object.keys(terms.en ?? {})).toHaveLength(TERM_KEYS.length);
    expect(Object.keys(terms.id ?? {})).toHaveLength(TERM_KEYS.length);
  });
  it('returns 40 overrides without cutting any (the old cap was 50 rows and silently dropped the rest)', async () => {
    rows.all = TERM_KEYS.slice(0, 20).flatMap((k) => TERM_LOCALES.map((l) => ({ term_key: k, locale: l, singular: 'a', plural: 'b' })));
    const terms = await listOrgTerminology();
    expect(Object.keys(terms.en ?? {})).toHaveLength(20);
    expect(Object.keys(terms.id ?? {})).toHaveLength(20);
  });
});
