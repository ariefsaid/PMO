import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';

const h = vi.hoisted(() => ({
  permissions: { statements: true, billing: true, earned: true },
  revenueFeature: true,
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => {
    if (action !== 'view') return false;
    if (entity === 'financialStatements') return h.permissions.statements;
    if (entity === 'salesInvoice') return h.permissions.billing;
    if (entity === 'managementPack') return h.permissions.earned;
    return false;
  },
}));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.revenueFeature }));
vi.mock('../FinancialStatements', () => ({ default: () => <div>Statements content</div> }));
vi.mock('../RevenueByProject', () => ({ default: () => <div>Billing content</div> }));
vi.mock('../ManagementPack', () => ({ default: () => <div>Earned content</div> }));

import MoneyInReports from '../money-in/MoneyInReports';

function CurrentUrl() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="current-url">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Browser back</button></>;
}

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/financial-statements" element={<><MoneyInReports /><CurrentUrl /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Money in reports home', () => {
  it('switches named sections while preserving the independent report selections', async () => {
    h.permissions = { statements: true, billing: true, earned: true };
    h.revenueFeature = true;
    const user = userEvent.setup();
    renderPage('/financial-statements?section=project-revenue&view=earned&from=2026-01&to=2026-06&periodStart=2026-01-01');
    expect(screen.getByText('Earned content')).toBeInTheDocument();
    expect(screen.getAllByText(/Cumulative project revenue · net of tax · through the selected as-at month/)).toHaveLength(1);
    await user.click(screen.getByRole('link', { name: 'Statements' }));
    expect(screen.getByText('Statements content')).toBeInTheDocument();
    expect(screen.getByTestId('current-url')).toHaveTextContent('section=statements');
    expect(screen.getByTestId('current-url')).toHaveTextContent('from=2026-01');
    expect(screen.getByTestId('current-url')).toHaveTextContent('to=2026-06');
    expect(screen.getByTestId('current-url')).toHaveTextContent('periodStart=2026-01-01');
    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByText('Earned content')).toBeInTheDocument();
    expect(screen.getByTestId('current-url')).toHaveTextContent('view=earned');
  });

  it('recovers a Project Manager from a Statements URL without mounting statement reads', () => {
    h.permissions = { statements: false, billing: true, earned: true };
    h.revenueFeature = true;
    renderPage('/financial-statements?section=statements');
    expect(screen.getByText('Earned content')).toBeInTheDocument();
    expect(screen.queryByText('Statements content')).not.toBeInTheDocument();
    expect(screen.getByText(/statements are available to Finance/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Statements' })).not.toBeInTheDocument();
  });

  it('recovers Earned to Billing when the revenue feature is off', () => {
    h.permissions = { statements: false, billing: true, earned: true };
    h.revenueFeature = false;
    renderPage('/financial-statements?section=project-revenue&view=earned&from=2026-02&to=2026-05');
    expect(screen.getByText('Billing content')).toBeInTheDocument();
    expect(screen.queryByText('Earned content')).not.toBeInTheDocument();
    expect(screen.getByTestId('current-url')).toHaveTextContent('view=billing');
    expect(screen.getByTestId('current-url')).toHaveTextContent('from=2026-02');
    expect(screen.getByTestId('current-url')).toHaveTextContent('to=2026-05');
  });

  it('keeps the existing no-access recovery for a role with neither report permission', () => {
    h.permissions = { statements: false, billing: false, earned: false };
    h.revenueFeature = true;
    renderPage('/financial-statements?section=statements');
    expect(screen.getByText('Reports are not available to this role.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to dashboard' })).toBeInTheDocument();
    expect(screen.queryByText('Statements content')).not.toBeInTheDocument();
    expect(screen.queryByText('Billing content')).not.toBeInTheDocument();
  });
});
