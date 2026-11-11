import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { getDashboardHarness, renderCompanyDashboard, resetCompanyDashboardHarness } from '../../test/companyDashboardHarness';

const dashboardHarness = getDashboardHarness();

const originalMatchMedia = window.matchMedia;
const setPhoneViewport = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: !query.includes('min-width'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => { resetCompanyDashboardHarness(); setPhoneViewport(); });
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('AC-MOBILE-1 and AC-MOBILE-3 responsive dashboard reading order', () => {
  it('puts the off-track projects and the contract figure before the passive sales card', () => {
    dashboardHarness.pipeline = { stages: [{ status: 'Leads', count: 1, weighted_value: 500, total_value: 1_000 }], projects: [] };
    renderCompanyDashboard();
    const offTrack = screen.getByRole('heading', { name: 'Projects off track' });
    const contractBook = screen.getByRole('link', { name: /Contract on hand/ });
    const sales = screen.getByRole('heading', { name: 'Sales' });
    expect(offTrack.compareDocumentPosition(sales) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contractBook.compareDocumentPosition(sales) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('never claims a clear result while risk was unchecked: names the unchecked projects, and says "No project is off track" only when all were checked', () => {
    dashboardHarness.dashboard!.attention_projects = [];
    const unchecked = renderCompanyDashboard();
    expect(screen.getByRole('link', { name: 'Budget check unavailable for 5 projects' })).toBeInTheDocument();
    expect(screen.queryByText('No project is off track.')).not.toBeInTheDocument();
    expect(screen.getByText('No checked project is off track.')).toBeInTheDocument();
    unchecked.unmount();

    dashboardHarness.dashboard!.risk_unchecked_projects = 0;
    renderCompanyDashboard();
    expect(screen.getByText('No project is off track.')).toBeInTheDocument();
    expect(screen.queryByText(/can’t be checked/)).not.toBeInTheDocument();
  });
});
