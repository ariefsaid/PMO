import React, { Suspense } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  role: 'Engineer',
  loaded: { company: 0, engineer: 0, pm: 0 },
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: state.role, realRole: state.role }),
}));
vi.mock('@/src/components/dashboard/hub/company/CompanyDashboard', async () => {
  const ReactModule = await import('react');
  state.loaded.company += 1;
  return { CompanyDashboard: ({ role }: { role: string }) => ReactModule.createElement('div', { 'data-testid': `company-${role}` }) };
});
vi.mock('@/src/components/dashboard/EngineerDashboard', async () => {
  const ReactModule = await import('react');
  state.loaded.engineer += 1;
  return { EngineerDashboard: () => ReactModule.createElement('div', { 'data-testid': 'engineer-dashboard' }, 'Engineer work') };
});
vi.mock('@/src/components/dashboard/PMDashboard', async () => {
  const ReactModule = await import('react');
  state.loaded.pm += 1;
  return { PMDashboard: () => ReactModule.createElement('div', { 'data-testid': 'pm-dashboard' }, 'My projects') };
});

async function renderDashboard() {
  const { default: ExecutiveDashboard } = await import('./ExecutiveDashboard');
  return render(
    <Suspense fallback={<div role="status">Loading dashboard</div>}>
      <ExecutiveDashboard />
    </Suspense>,
  );
}

describe('ExecutiveDashboard role chunks', () => {
  beforeEach(() => {
    vi.resetModules();
    state.role = 'Engineer';
    state.loaded.company = 0;
    state.loaded.engineer = 0;
    state.loaded.pm = 0;
  });

  it('loads only the Engineer dashboard when an Engineer opens the dashboard', async () => {
    await renderDashboard();

    expect(await screen.findByTestId('engineer-dashboard')).toBeInTheDocument();
    expect(state.loaded.engineer).toBe(1);
    expect(state.loaded.company).toBe(0);
    expect(state.loaded.pm).toBe(0);
  });

  it('loads only the company dashboard for the Executive role', async () => {
    state.role = 'Executive';
    await renderDashboard();

    expect(await screen.findByTestId('company-Executive')).toBeInTheDocument();
    expect(state.loaded.company).toBe(1);
    expect(state.loaded.engineer).toBe(0);
    expect(state.loaded.pm).toBe(0);
  });

  it('loads only the Project Manager dashboard for the Project Manager role', async () => {
    state.role = 'Project Manager';
    await renderDashboard();

    expect(await screen.findByTestId('pm-dashboard')).toBeInTheDocument();
    expect(state.loaded.pm).toBe(1);
    expect(state.loaded.company).toBe(0);
    expect(state.loaded.engineer).toBe(0);
  });
});
