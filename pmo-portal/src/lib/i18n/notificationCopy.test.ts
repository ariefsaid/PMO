import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { setOrgTerms } from './orgTerms';
import en from '../../../public/locales/en/notifications.json';
import id from '../../../public/locales/id/notifications.json';
import { notificationBody, notificationTitle } from './notificationCopy';

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
});
