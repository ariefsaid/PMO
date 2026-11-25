import { expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { allowedActions } from './mainAction';
const t = ((key: string, fallback?: string) => fallback ?? key) as unknown as TFunction;
it('AC-EPS-001 Buyer submits only the approved plan purchase and cannot approve its own submission', () => {
  const actions = (status: 'Draft' | 'Requested', role: string, context: { maySubmit: boolean; isSubmitter: boolean }) =>
    allowedActions(status, role, false, false, t, true, false, true, true, context).map((a) => a.to);
  expect(actions('Draft', 'Engineer', { maySubmit: true, isSubmitter: false })).toContain('Requested');
  expect(actions('Draft', 'Engineer', { maySubmit: false, isSubmitter: false })).not.toContain('Requested');
  expect(actions('Requested', 'Admin', { maySubmit: false, isSubmitter: true })).not.toContain('Approved');
});
