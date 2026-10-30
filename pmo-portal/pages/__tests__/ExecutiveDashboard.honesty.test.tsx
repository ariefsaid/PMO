import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { resetActiveLocale, setActiveLocale } from '../../src/lib/locale/activeLocale';
import { getDashboardHarness, renderCompanyDashboard, resetCompanyDashboardHarness } from '../../test/companyDashboardHarness';

const dashboardHarness = getDashboardHarness();

beforeEach(() => {
  resetCompanyDashboardHarness();
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
});
afterEach(resetActiveLocale);

describe('AC-RD-UNAVAIL-002 redesigned project-spend link names', () => {
  it('announces a small known amount, zero, and the reason when the amount is unavailable', () => {
    dashboardHarness.dashboard!.top_projects = [
      { id: 'small', name: 'Small', contract_value: 1_000, currency: 'USD', spent: 500, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
      { id: 'zero', name: 'Zero', contract_value: 1_000, currency: 'USD', spent: 0, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
      { id: 'unknown', name: 'Unknown', contract_value: 1_000, currency: 'USD', spent: null, actual_complete: false, actual_currency: 'USD', status: 'Ongoing Project' },
      { id: 'mismatch', name: 'Mismatch', contract_value: 1_000, currency: 'USD', spent: 500, actual_complete: true, actual_currency: 'EUR', status: 'Ongoing Project' },
    ];
    renderCompanyDashboard();
    const spendList = screen.getByRole('list', { name: 'Spending vs contract' });
    expect(within(spendList).getByRole('link', { name: /Small.*recorded spending.*\$500/ })).toHaveAttribute('href', '/projects/small');
    expect(within(spendList).getByRole('link', { name: /Zero.*recorded spending.*\$0/ })).toHaveAttribute('href', '/projects/zero');
    expect(within(spendList).getByRole('link', { name: /Unknown.*spending unavailable.*actuals are incomplete/i })).toHaveAttribute('href', '/projects/unknown');
    expect(within(spendList).getByRole('link', { name: /Mismatch.*recorded spending.*different currency from the contract/i })).toHaveAttribute('href', '/projects/mismatch');
  });
});
