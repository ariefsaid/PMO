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

describe('AC-RD-UNAVAIL-002 plan vs actual leaves an unavailable amount out, never zero', () => {
  it('lists a known amount and zero, and shows the dash for incomplete or other-currency spending', () => {
    dashboardHarness.dashboard!.top_projects = [
      { id: 'small', name: 'Small', contract_value: 1_000, currency: 'USD', spent: 500, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
      { id: 'zero', name: 'Zero', contract_value: 900, currency: 'USD', spent: 0, actual_complete: true, actual_currency: 'USD', status: 'Ongoing Project' },
      { id: 'unknown', name: 'Unknown', contract_value: 800, currency: 'USD', spent: null, actual_complete: false, actual_currency: 'USD', status: 'Ongoing Project' },
      { id: 'mismatch', name: 'Mismatch', contract_value: 700, currency: 'USD', spent: 500, actual_complete: true, actual_currency: 'EUR', status: 'Ongoing Project' },
    ];
    renderCompanyDashboard();
    const table = screen.getByRole('table', { name: 'Plan vs actual by project' });
    const cells = (name: string) => within(within(table).getByRole('rowheader', { name }).closest('tr') as HTMLElement).getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells('Small')).toEqual(['$1,000', 'No active budget', '$500', '50%']);
    expect(cells('Zero')).toEqual(['$900', 'No active budget', '$0', '0%']);
    expect(cells('Unknown')).toEqual(['$800', 'No active budget', '—', '—']);
    expect(cells('Mismatch')).toEqual(['$700', 'No active budget', '—', '—']);
  });
});
