import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { matchRoutes, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';
const permissionState = vi.hoisted(() => ({ role: 'Finance' }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => action === 'view' && entity === 'finance' && ['Finance', 'Executive', 'Admin'].includes(permissionState.role),
}));

import { appRouteConfig, FinanceAccessRoute, FinanceLegacyRedirect } from './App';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

afterEach(cleanup);

describe('Application route table', () => {
  it('AC-1405-ROUTE-001: Finance serves the hub and its four explicit areas', () => {
    const expected = [
      ['/finance', '/finance'],
      ['/finance/receivables', '/finance/receivables'],
      ['/finance/payables', '/finance/payables'],
      ['/finance/reports', '/finance/reports'],
      ['/finance/statements', '/finance/statements'],
    ];
    for (const [url, path] of expected) {
      const route = matchRoutes(appRouteConfig, url)?.at(-1)?.route;
      expect(route?.path, url).toBe(path);
      expect(React.isValidElement(route?.element), url).toBe(true);
    }
  });

  it('AC-1405-ROUTE-002: legacy Finance list URLs redirect to their canonical area', () => {
    const redirects = [
      ['/sales-invoices', '/finance/receivables'],
      ['/incoming-payments', '/finance/receivables'],
      ['/revenue-by-project', '/finance/reports'],
      ['/reports', '/finance/reports'],
      ['/financial-statements', '/finance/statements'],
    ];
    for (const [url, target] of redirects) {
      const route = matchRoutes(appRouteConfig, url)?.at(-1)?.route;
      expect(route?.path, url).toBe(url);
      expect(route?.element).toMatchObject({ props: { to: target } });
    }
  });

  it('AC-1405-ROUTE-003: legacy redirects retain filters and add the payments view selector', async () => {
    render(
      <MemoryRouter initialEntries={['/incoming-payments?q=receipt&customer=co-1#recent']}>
        <Routes>
          <Route path="/incoming-payments" element={<FinanceLegacyRedirect to="/finance/receivables" paymentsView />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('location')).toHaveTextContent('/finance/receivables?q=receipt&customer=co-1&view=payments#recent');
  });

  it('AC-1405-ROUTE-004: invoice and receipt detail routes remain addressable', () => {
    expect(matchRoutes(appRouteConfig, '/sales-invoices/invoice-1')?.at(-1)?.route?.path).toBe('/sales-invoices/:invoiceId');
    expect(matchRoutes(appRouteConfig, '/incoming-payments/receipt-1')?.at(-1)?.route?.path).toBe('/incoming-payments/:receiptId');
  });

  it.each(['Project Manager', 'Engineer'])('AC-1405-ROUTE-005: %s receives AccessDenied for Finance routes', (role) => {
    permissionState.role = role;
    render(<MemoryRouter><FinanceAccessRoute><p>Finance page content</p></FinanceAccessRoute></MemoryRouter>);
    expect(screen.getByRole('region')).toBeInTheDocument();
    expect(screen.queryByText('Finance page content')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Dashboard/ })).toBeInTheDocument();
  });

  it.each(['Finance', 'Executive', 'Admin'])('AC-1405-ROUTE-006: %s can read the Finance route', (role) => {
    permissionState.role = role;
    render(<MemoryRouter><FinanceAccessRoute><p>Finance page content</p></FinanceAccessRoute></MemoryRouter>);
    expect(screen.getByText('Finance page content')).toBeInTheDocument();
  });

  it('AC-007 support: /financial-statements now redirects to the unchanged Statements page', () => {
    const route = matchRoutes(appRouteConfig, '/finance/statements')?.at(-1)?.route;
    expect(route?.path).toBe('/finance/statements');
    expect(React.isValidElement(route?.element)).toBe(true);
  });

  it('AC-L10N-060 support: /settings/profile resolves to the profile settings route', () => {
    const route = matchRoutes(appRouteConfig, '/settings/profile')?.at(-1)?.route;
    expect(route?.path).toBe('/settings/profile');
    expect(React.isValidElement(route?.element)).toBe(true);
  });

  it('AC-ADMIA-001/003: every Administration destination resolves to a real route element', () => {
    const paths = [
      '/administration', '/administration/users', '/administration/integrations',
      '/administration/accounting', '/administration/credits', '/administration/usage',
      '/administration/features', '/administration/exchange-rates', '/administration/cost-attribution',
    ];
    for (const path of paths) {
      const route = matchRoutes(appRouteConfig, path)?.at(-1)?.route;
      expect(route?.path, path).not.toBe('*');
      expect(React.isValidElement(route?.element), path).toBe(true);
    }
  });

  it('AC-ADMIA-003: unknown Administration sections resolve to their section fallback', () => {
    expect(matchRoutes(appRouteConfig, '/administration/unknown')?.at(-1)?.route?.path).toBe('/administration/:section');
  });
});
