import { describe, it, expect, afterEach, vi } from 'vitest';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { setOrgTerms } from './orgTerms';

describe('AC-TERM-003 catalogue terminology renames through i18next, in both languages', () => {
  afterEach(() => setOrgTerms({}));
  it('does not rename user-entered interpolation values', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', resources: { en: { translation: { label: 'Project: {{name}}' } } } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(inst.t('label', { name: 'Project Phoenix' })).toBe('Job: Project Phoenix');
  });
  it('does not change user data even when it resembles an internal marker', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const inst = i18next.createInstance();
      await inst.use(orgTermsPlugin).init({ lng: 'en', resources: { en: { translation: { label: 'Project {{name}}' } } } });
      setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
      const marker = [`\uE000${(0.5).toString(36).slice(2)}-0\uE001`, ...Array.from({ length: 200 }, (_, i) => `\uE000${i}\uE001`)].join('');
      expect(inst.t('label', { name: marker })).toBe(`Job ${marker}`);
    } finally {
      random.mockRestore();
    }
  });
  it('does not rename a user-provided fallback value', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', resources: { en: { translation: {} } } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(inst.t('missing', { defaultValue: 'Project Phoenix' })).toBe('Project Phoenix');
  });
  it('keeps interpolation keys intact and nested user values unchanged', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', resources: { en: { translation: { outer: 'Open $t(inner)', inner: 'Project {{project}}' } } } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(inst.t('outer', { project: 'Project Phoenix' })).toBe('Open Job Project Phoenix');
  });
  it('uses the matching English catalogue entry for Indonesian number context', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', resources: {
      en: { translation: { one: 'New project', many: 'All projects' } },
      id: { translation: { one: 'Proyek baru', many: 'Semua proyek' } },
    } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'daftar pekerjaan' } } });
    expect(inst.t('one')).toBe('Pekerjaan baru');
    expect(inst.t('many')).toBe('Semua daftar pekerjaan');
  });
  it('keeps singular and plural distinct when both occur in Indonesian copy', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['administration'], defaultNS: 'administration', resources: {
      en: { administration: { integrations: { send: { refusal: { planFirst: 'Choose the cost-account plan for projects first, then send this project again.' } } } } },
      id: { administration: { integrations: { send: { refusal: { planFirst: 'Pilih dulu rencana akun biaya untuk proyek, lalu kirim proyek ini lagi.' } } } } },
    } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'daftar pekerjaan' } } });
    expect(inst.t('integrations.send.refusal.planFirst')).toBe('Pilih dulu rencana akun biaya untuk daftar pekerjaan, lalu kirim pekerjaan ini lagi.');
  });
  it('uses the parent context for Indonesian nested work-order labels', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['common'], defaultNS: 'common', resources: {
      en: { common: { terms: { clientWorkOrder: 'Work order' }, one: 'Open work order', many: 'Open work orders' } },
      id: { common: { terms: { clientWorkOrder: 'Work Order / SPK' }, one: 'Buka $t(common:terms.clientWorkOrder)', many: 'Semua $t(common:terms.clientWorkOrder)' } },
    } });
    setOrgTerms({ id: { workOrder: { singular: 'kartu', plural: 'kartu-kartu' } } });
    expect(inst.t('one')).toBe('Buka Kartu');
    expect(inst.t('many')).toBe('Semua Kartu-kartu');
  });
  it('recognizes the plural nested work-order label when English uses purchase orders', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['common'], defaultNS: 'common', resources: {
      en: { common: { terms: { clientWorkOrder: 'Work order' }, projectDetail: { workOrders: { error: { sub: 'The client purchase orders could not be read.' } } } } },
      id: { common: { terms: { clientWorkOrder: 'Work Order / SPK' }, projectDetail: { workOrders: { error: { sub: '$t(common:terms.clientWorkOrder) klien tidak dapat dibaca.' } } } } },
    } });
    setOrgTerms({ id: { workOrder: { singular: 'kartu', plural: 'berbagai kartu' } } });
    expect(inst.t('projectDetail.workOrders.error.sub')).toBe('Berbagai kartu klien tidak dapat dibaca.');
  });
  it('defaults an unmatched Indonesian term to singular', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', resources: {
      en: { translation: { label: 'Unassigned' } }, id: { translation: { label: 'Tanpa proyek' } },
    } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'daftar pekerjaan' } } });
    expect(inst.t('label')).toBe('Tanpa pekerjaan');
  });
  it('uses plural for an Indonesian label whose English source uses a different phrase', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['dashboard'], defaultNS: 'dashboard', resources: {
      en: { dashboard: { uxs03: { pmoPurchasing: 'PMO purchasing requests' } } },
      id: { dashboard: { uxs03: { pmoPurchasing: 'Permintaan pembelian PMO' } } },
    } });
    setOrgTerms({ id: { purchaseRequest: { singular: 'permohonan', plural: 'berbagai permohonan' } } });
    expect(inst.t('uxs03.pmoPurchasing')).toBe('Berbagai permohonan PMO');
  });
  it('distinguishes a project from the project list in Indonesian copy', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['common'], defaultNS: 'common', resources: {
      en: { common: { projects: { confirm: { archiveDescription: 'It will be hidden from the default project list.' } } } },
      id: { common: { projects: { confirm: { archiveDescription: 'Proyek akan disembunyikan dari daftar proyek default.' } } } },
    } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'pekerjaan-pekerjaan' } } });
    expect(inst.t('projects.confirm.archiveDescription')).toBe('Pekerjaan akan disembunyikan dari daftar pekerjaan-pekerjaan default.');
  });
  it('preserves translated markup component identifiers', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', resources: { en: { translation: { label: 'Project <project/> for {{name}}' } } } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(inst.t('label', { name: 'Project Phoenix' })).toBe('Job <project/> for Project Phoenix');
  });
  it('preserves Indonesian possessive and across forms', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', resources: {
      en: { translation: { line: 'Open the project and share across projects' } },
      id: { translation: { line: 'Buka proyeknya dan bagikan antarproyek' } },
    } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'berbagai pekerjaan' } } });
    expect(inst.t('line')).toBe('Buka pekerjaannya dan bagikan antar berbagai pekerjaan');
  });
  it('treats organisation wording as text even when it resembles interpolation or markup', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', resources: { en: { translation: { label: 'Project {{name}}' } } } });
    setOrgTerms({ en: { project: { singular: '{{name}} <project/>', plural: 'jobs' } } });
    expect(inst.t('label', { name: 'Alpha' })).toBe('{{name}} <project/> Alpha');
  });
  it('rewrites t() output per language', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({
      lng: 'en',
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
  it('rewrites deliveryNote through i18next in English and Indonesian (#2687)', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({
      lng: 'en',
      resources: {
        en: { translation: { print: 'Print delivery note', list: 'All delivery notes' } },
        id: { translation: { print: 'Cetak surat jalan', list: 'Semua nota pengiriman' } },
      },
    });
    setOrgTerms({
      en: { deliveryNote: { singular: 'dispatch docket', plural: 'dispatch dockets' } },
      id: { deliveryNote: { singular: 'faktur jalan', plural: 'faktur jalan' } },
    });
    expect(inst.t('print')).toBe('Print dispatch docket');
    expect(inst.t('list')).toBe('All dispatch dockets');
    expect(inst.t('print', { lng: 'id' })).toBe('Cetak faktur jalan');
    expect(inst.t('list', { lng: 'id' })).toBe('Semua faktur jalan');
  });
});
