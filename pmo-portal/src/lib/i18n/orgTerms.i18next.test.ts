import { describe, it, expect, afterEach } from 'vitest';
import i18next from 'i18next';
import { orgTermsPostProcessor } from './index';
import { setOrgTerms } from './orgTerms';

describe('AC-TERM-003 the post-processor renames through i18next, in both languages', () => {
  afterEach(() => setOrgTerms({}));
  it('rewrites t() output per language', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPostProcessor).init({
      lng: 'en',
      postProcess: ['orgTerms'],
      resources: {
        en: { translation: { a: 'Open work orders', b: 'Save work order' } },
        id: { translation: { a: 'Work Order terbuka', c: 'Semua proyek' } },
      },
    });
    expect(inst.t('a')).toBe('Open work orders');
    setOrgTerms({
      en: { workOrder: { singular: 'job card', plural: 'job cards' } },
      id: { workOrder: { singular: 'kartu kerja', plural: 'kartu kerja' } },
    });
    expect(inst.t('a')).toBe('Open job cards');
    expect(inst.t('b')).toBe('Save job card');
    expect(inst.t('a', { lng: 'id' })).toBe('Kartu Kerja terbuka');
  });
});
