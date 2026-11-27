import { describe, expect, it, vi } from 'vitest';
import { applyOrgTerms, TERM_KEYS, type OrgTerms } from './orgTerms';

const terms = (en: string, id: string): OrgTerms => ({
  en: { workOrder: { singular: en, plural: `${en}s` } },
  id: { workOrder: { singular: id, plural: `${id}s` } },
});

describe('applyOrgTerms compiled-pattern cache (speed map #3014)', () => {
  it('a changed terms object never serves the earlier result', () => {
    const a = terms('Job', 'Pekerjaan');
    const b = terms('Task', 'Tugas');
    expect(applyOrgTerms('Create a work order', 'en', a)).toBe('Create a Job');
    expect(applyOrgTerms('Create a work order', 'en', b)).toBe('Create a Task');
    expect(applyOrgTerms('Create a work order', 'en', a)).toBe('Create a Job');
  });

  it('locale and namespace each get their own result', () => {
    const t = terms('Job', 'Pekerjaan');
    expect(applyOrgTerms('work order', 'en', t)).toBe('Job');
    expect(applyOrgTerms('perintah kerja', 'id', t)).toBe('Pekerjaan');
    expect(applyOrgTerms('perintah kerja', 'en', t)).toBe('perintah kerja');
  });

  it('compiles the pattern once per (terms, locale), not per call', () => {
    const t = terms('Job', 'Pekerjaan');
    const Real = globalThis.RegExp;
    let compiled = 0;
    vi.stubGlobal('RegExp', new Proxy(Real, { construct(target, args) { compiled++; return Reflect.construct(target, args); } }));
    try {
      for (let i = 0; i < 1000; i++) applyOrgTerms(`work order ${i}`, 'en', t);
      expect(compiled).toBe(1);
      for (let i = 0; i < 1000; i++) applyOrgTerms(`perintah kerja ${i}`, 'id', t);
      expect(compiled).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('timing: 10,000 lookups (informational)', () => {
    const t: OrgTerms = { en: {}, id: {} };
    for (const k of TERM_KEYS.slice(0, 25)) {
      t.en![k] = { singular: `E ${k}`, plural: `E ${k}s` };
      t.id![k] = { singular: `I ${k}`, plural: `I ${k}s` };
    }
    const s = performance.now();
    for (let i = 0; i < 5000; i++) {
      applyOrgTerms(`Open the work order list ${i}`, 'en', t);
      applyOrgTerms(`Buka daftar perintah kerja ${i}`, 'id', t);
    }
    console.log(`BENCH 10000 lookups: ${(performance.now() - s).toFixed(1)} ms`);
  });
});
