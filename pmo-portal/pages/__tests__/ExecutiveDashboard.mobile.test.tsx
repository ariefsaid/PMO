import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { getDashboardHarness, renderCompanyDashboard, resetCompanyDashboardHarness } from '../../test/companyDashboardHarness';

const dashboardHarness = getDashboardHarness();

const originalMatchMedia = window.matchMedia;
const setPhoneViewport = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: !query.includes('min-width'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

const openAttentionHelp = () => fireEvent.click(screen.getByRole('button', { name: 'About Needs attention' }));

beforeEach(() => { resetCompanyDashboardHarness(); setPhoneViewport(); });
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('AC-MOBILE-1 and AC-MOBILE-3 responsive dashboard reading order', () => {
  it('puts the at-risk doorway and contract figure before the passive sales funnel', () => {
    dashboardHarness.pipeline = { stages: [{ status: 'Leads', count: 1, weighted_value: 500, total_value: 1_000 }], projects: [] };
    renderCompanyDashboard();
    const atRisk = screen.getByRole('link', { name: /1 of 7 active delivery projects at risk/ });
    const contractBook = screen.getByRole('link', { name: /Contract on hand/ });
    const chart = screen.getByRole('heading', { name: 'Sales funnel' });
    expect(atRisk.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contractBook.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('states coverage and a checked-zero clear result in the Needs attention help, but stays silent when risk was unchecked', () => {
    expect(dashboardHarness.dashboard).toMatchObject({ active_delivery_projects: 7, active_delivery_actual_project_count: 2 });
    const coverage = renderCompanyDashboard();
    openAttentionHelp();
    expect(screen.getByText(/Actuals available for 2 of 7 active delivery projects\./)).toBeInTheDocument();
    coverage.unmount();

    dashboardHarness.areaItems = [];
    dashboardHarness.dashboard!.projects_at_risk = 0;
    dashboardHarness.dashboard!.risk_unchecked_projects = 0;
    dashboardHarness.dashboard!.active_delivery_actual_project_count = 7;
    const { unmount } = renderCompanyDashboard();
    openAttentionHelp();
    expect(screen.getByText(/Actuals available for 7 of 7 active delivery projects\./)).toBeInTheDocument();
    expect(screen.getByText(/0 projects at risk\. All 7 active delivery projects are currently on track\./)).toBeInTheDocument();
    unmount();

    dashboardHarness.dashboard!.risk_unchecked_projects = 1;
    renderCompanyDashboard();
    openAttentionHelp();
    expect(screen.queryByText(/0 projects at risk\. All 7 active delivery projects are currently on track\./)).not.toBeInTheDocument();
  });
});
