import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { setOrgTerms } from './orgTerms';
import en from '../../../public/locales/en/notifications.json';
import id from '../../../public/locales/id/notifications.json';
import { NOTIFICATION_TITLE_KEYS, notificationBody, notificationTitle } from './notificationCopy';

describe('notification wording', () => {
  afterEach(() => setOrgTerms({}));
  it.each(['budgetCancellationHeld', 'budgetRetryAuthorization'])('renders the %s app template', async (key) => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en } } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(notificationBody({ body: 'stored', message_key: key, message_params: {} }, inst.t.bind(inst))).toContain('job');
  });
  it('renders the shipped Indonesian template and retains the typed invoice number', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'pekerjaan-pekerjaan' } } });
    const body = notificationBody({ body: 'stored', message_key: 'unassignedInvoice', message_params: { invoice: 'Project Phoenix', amount: '' } }, inst.t.bind(inst));
    expect(body).toContain('Project Phoenix');
    expect(body).toContain('tanpa pekerjaan');
    expect(body).toContain('ke pekerjaan');
  });
  it('AC-TERM-007 renames a generated label but leaves a new user body and a historical body unchanged', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: {
      en: { notifications: { budgetArchiveWarning: 'Budget for this project.', literal: '{{body}}', unassignedInvoice: 'Invoice {{invoice}}{{amount}} has no project.', unassignedInvoiceTitle: 'Invoice needs a project', budgetPushFailed: 'Project failed: {{reason}}.' } },
    } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(notificationBody({ body: 'old body', message_key: 'budgetArchiveWarning', message_params: {} }, inst.t.bind(inst))).toBe('Budget for this job.');
    expect(notificationBody({ body: 'Project {{name}}', message_key: 'literal', message_params: { body: 'Project {{name}}' } }, inst.t.bind(inst))).toBe('Project {{name}}');
    expect(notificationTitle({ title: 'old title', message_key: 'unassignedInvoice' }, inst.t.bind(inst))).toBe('Invoice needs a job');
    expect(notificationBody({ body: 'old body', message_key: 'unassignedInvoice', message_params: { invoice: 'Project Phoenix', amount: ' (42)' } }, inst.t.bind(inst))).toBe('Invoice Project Phoenix (42) has no job.');
    expect(notificationBody({ body: 'old body', message_key: 'budgetPushFailed', message_params: { reason: 'Project {{name}}' } }, inst.t.bind(inst))).toBe('Job failed: Project {{name}}.');
    expect(notificationBody({ body: 'Project Phoenix', message_key: null, message_params: null }, inst.t.bind(inst))).toBe('Project Phoenix');
    expect(notificationBody({ body: 'Project Phoenix', message_key: 'unknown', message_params: {} }, inst.t.bind(inst))).toBe('Project Phoenix');
  });
  it('fix/walk-people item 9: the leave result reads in the reader\'s language, with the note when there is one', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
    const t = inst.t.bind(inst);
    const params = { type: 'Sakit', from: '2026-12-01', to: '2026-12-03', note: 'Dokumen kurang' };
    expect(notificationTitle({ title: 'Leave rejected', message_key: 'leaveRejected' }, t)).toBe('Cuti ditolak');
    const body = notificationBody({ body: 'stored', message_key: 'leaveRejected', message_params: params }, t);
    expect(body).toContain('ditolak');
    expect(body).toContain('Sakit');
    expect(body).toContain('Dokumen kurang');
    expect(notificationBody({ body: 'stored', message_key: 'leaveApproved', message_params: { ...params, note: null } }, t)).toContain('disetujui');
  });

  describe('fix-waiting item 4: titles the database writes reach the reader in their language', () => {
    it('JOB-WAIT-4 shows every known database title in Bahasa Indonesia on a Bahasa organisation, and keeps an unknown one as stored', async () => {
      const inst = i18next.createInstance();
      await inst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const t = inst.t.bind(inst);
      expect(notificationTitle({ title: 'Your material request was sent back', message_key: 'literal' }, t)).toBe('Permintaan material Anda dikembalikan');
      expect(notificationTitle({ title: 'Your procurement was approved', message_key: 'literal' }, t)).toBe('Pengadaan Anda disetujui');
      expect(notificationTitle({ title: 'Something written by a person', message_key: 'literal' }, t)).toBe('Something written by a person');
    });
    it('AC-WAIT-060 every title in the table has English and Bahasa text, so none can reach a Bahasa screen in English', () => {
      for (const key of Object.values(NOTIFICATION_TITLE_KEYS)) {
        expect((en as { title: Record<string, string> }).title[key], `en ${key}`).toBeTruthy();
        expect((id as { title: Record<string, string> }).title[key], `id ${key}`).toBeTruthy();
      }
    });
  });

  it('AC-TR-006 rewrites a database-written body in the reader\'s language, never a person\'s words or an unknown title', () => {
    const t = ((_k: string, d: string) => d) as unknown as Parameters<typeof notificationBody>[1];
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } }, id: { project: { singular: 'pekerjaan', plural: 'pekerjaan' } } });
    const row = { title: 'Procurement awaiting your approval', body: 'Project Alpha needs a decision.', message_key: null, message_params: null };
    expect(notificationBody(row, t, 'en')).toBe('Job Alpha needs a decision.');
    expect(notificationBody(row, t, 'id')).toBe('Pekerjaan Alpha needs a decision.');
    expect(notificationBody({ ...row, title: 'Your timesheet was rejected', body: 'Project is wrong' }, t, 'en')).toBe('Project is wrong');
    expect(notificationBody({ ...row, title: 'Written by a person' }, t, 'en')).toBe('Project Alpha needs a decision.');
    expect(notificationBody(row, t)).toBe('Project Alpha needs a decision.');
  });
});
