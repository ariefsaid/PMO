import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { setOrgTerms } from './orgTerms';
import en from '../../../public/locales/en/workOrderSections.json';
import id from '../../../public/locales/id/workOrderSections.json';
import { applyOrgTerms, type OrgTerms } from './orgTerms';

describe('additional organisation terminology', () => {
  it('renames work-order plan and foreman in screen text in both languages', () => {
    const terms = {
      en: { workOrderPlan: { singular: 'job budget', plural: 'job budgets' }, foreman: { singular: 'crew lead', plural: 'crew leads' } },
      id: { workOrderPlan: { singular: 'anggaran kerja', plural: 'anggaran kerja' }, foreman: { singular: 'ketua regu', plural: 'ketua regu' } },
    } as OrgTerms;
    expect(applyOrgTerms('Work-order plan and foreman', 'en', terms, { namespace: 'workOrderSections' })).toBe('Job budget and crew lead');
    expect(applyOrgTerms('Rencana work order dan mandor', 'id', terms, { namespace: 'workOrderSections' })).toBe('Anggaran kerja dan ketua regu');
  });
});

it('renames the billing step in the email lead', async () => {
  const { renderEmail } = await import('../../../../supabase/functions/email-notify/templates');
  const email = renderEmail('billing_step', 'en', 'Reminder', null, {
    terms: { en: { billingStep: { singular: 'stage', plural: 'stages' } } },
  });
  expect(email.text).toContain('A stage is waiting for you.');
  expect(email.html).toContain('A stage is waiting for you.');
});


afterEach(() => setOrgTerms({}));
it('shows both renamed terms in the work-order sections screen catalogue', async () => {
  const screen = i18next.createInstance();
  await screen.use(orgTermsPlugin).init({ lng: 'en', fallbackLng: 'en', ns: ['workOrderSections'], defaultNS: 'workOrderSections', resources: { en: { workOrderSections: en }, id: { workOrderSections: id } } });
  setOrgTerms({ en: { workOrderPlan: { singular: 'job budget', plural: 'job budgets' }, foreman: { singular: 'crew lead', plural: 'crew leads' } }, id: { workOrderPlan: { singular: 'anggaran kerja', plural: 'anggaran kerja' }, foreman: { singular: 'ketua regu', plural: 'ketua regu' } } });
  expect(screen.t('foreman')).toBe('Crew lead');
  expect(screen.t('materials.overAllocated', { items: 'Steel' })).toBe('Steel is allocated above the job budget.');
  await screen.changeLanguage('id');
  expect(screen.t('foreman')).toBe('Ketua regu');
  expect(screen.t('materials.overAllocated', { items: 'Baja' })).toBe('Baja dialokasikan melebihi anggaran kerja.');
});

it('escapes organisation wording in the email lead HTML', async () => {
  const { renderEmail } = await import('../../../../supabase/functions/email-notify/templates');
  const email = renderEmail('billing_step', 'en', 'Reminder', null, {
    terms: { en: { billingStep: { singular: '<stage>', plural: '<stages>' } } },
  });
  expect(email.html).toContain('&lt;stage&gt;');
});

it('uses the renamed issue in its overdue email', async () => {
  const { renderEmail } = await import('../../../../supabase/functions/email-notify/templates');
  const email = renderEmail('overdue_item', 'en', 'Issue is overdue', 'This issue is overdue.', {
    terms: { en: { issue: { singular: 'concern', plural: 'concerns' } } },
  });
  expect(email.subject).toBe('Concern is overdue');
  expect(email.text).toContain('This concern is overdue.');
});

it('does not rename issue as a verb in an unrelated email', async () => {
  const { renderEmail } = await import('../../../../supabase/functions/email-notify/templates');
  const email = renderEmail('approval_request', 'en', 'Order ready', 'Issue an order.', {
    terms: { en: { issue: { singular: 'concern', plural: 'concerns' } } },
  });
  expect(email.text).toContain('Issue an order.');
});

it('uses the renamed close-out in its overdue email', async () => {
  const { renderEmail } = await import('../../../../supabase/functions/email-notify/templates');
  const email = renderEmail('overdue_item', 'en', 'Close-out item is overdue', 'A close-out item is overdue.', {
    terms: { en: { closeOut: { singular: 'completion', plural: 'completions' } } },
  });
  expect(email.subject).toBe('Completion item is overdue');
  expect(email.text).toContain('A completion item is overdue.');
});
