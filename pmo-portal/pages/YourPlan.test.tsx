/**
 * AC-PLN-013 [Vitest] — "Your plan" (FR-PLN-014): read-only plan details and the General feedback setting.
 *
 * It must list the plan, the switches that are on, and the limits. The Admin-owned feedback switch
 * lives under General; plan details and other feature settings remain read-only. Usage against a
 * limit is honestly shown as "not tracked yet" until S5 ships the meters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { api, permissionState } = vi.hoisted(() => ({
  api: {
    getOwnPlan: vi.fn(),
    listOwn: vi.fn(),
    setFeedbackSurveys: vi.fn(),
  },
  permissionState: { canViewPlan: true, isOperator: false, canManageFeedback: true },
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) =>
    (permissionState.canViewPlan && action === 'view' && entity === 'user') ||
    (permissionState.canManageFeedback && action === 'manage' && entity === 'orgFeedback'),
}));

vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => permissionState.isOperator,
}));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgFeature: {
      getOwnPlan: () => api.getOwnPlan(),
      listOwn: () => api.listOwn(),
      setFeedbackSurveys: (enabled: boolean) => api.setFeedbackSurveys(enabled),
    },
  },
}));

import YourPlan from './YourPlan';

const makeQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderPage = () =>
  render(
    <QueryClientProvider client={makeQc()}>
      <ToastProvider><YourPlan /></ToastProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  permissionState.canViewPlan = true;
  permissionState.isOperator = false;
  permissionState.canManageFeedback = true;
  api.getOwnPlan.mockResolvedValue({
    planId: 'starter',
    name: 'Starter',
    seatLimit: 10,
    projectLimit: 25,
    aiMonthlyMessages: 300,
  });
  api.listOwn.mockResolvedValue({
    display: { crm: true, stock: false, incidents: true, feedback_surveys: true },
    states: {
      crm: { enabled: true, displayEnabled: true, source: 'plan' },
      stock: { enabled: false, displayEnabled: false, source: 'plan' },
      incidents: { enabled: true, displayEnabled: true, source: 'override' },
      feedback_surveys: { enabled: true, displayEnabled: true, source: 'plan' },
    },
  });
  api.setFeedbackSurveys.mockResolvedValue(undefined);
});

describe('AC-PLN-013 — Your plan details and General settings', () => {
  it('AC-PLN-013: lists the plan name, the limits and each limit’s usage state', async () => {
    renderPage();
    expect(await screen.findByText('Starter')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    // One honest line for all three limits: usage is not metered yet (S5 owns the meters).
    expect(screen.getAllByText(/usage not tracked yet/i)).toHaveLength(1);
  });

  it('AC-PLN-013: lists which switches are on, from the resolved set', async () => {
    renderPage();
    // On is plain text (read as ": On"); only an Off feature carries a mark, so a full plan repeats nothing.
    const crm = (await screen.findByText('CRM (Sales Pipeline, Companies, Contacts)')) as HTMLElement;
    expect(crm).toHaveTextContent(': On');
    expect(within(crm).queryByText('Off')).toBeNull();
    const stock = screen.getByText('Stock') as HTMLElement;
    expect(within(stock).getByText('Off')).toBeInTheDocument();
  });

  it('AC-PLN-013: keeps plan details read-only and places the feedback switch under General', async () => {
    renderPage();
    await screen.findByText('Starter');
    const general = screen.getByRole('region', { name: 'General' });
    const feedbackSwitch = within(general).getByRole('switch', { name: /feedback and surveys/i });
    expect(feedbackSwitch).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    fireEvent.click(feedbackSwitch);
    await waitFor(() => expect(api.setFeedbackSurveys).toHaveBeenCalledWith(false));
  });

  it('AC-PLN-013: a failed plan read shows the retry state, not an invented plan', async () => {
    api.getOwnPlan.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText('Starter')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    await waitFor(() => expect(api.getOwnPlan).toHaveBeenCalled());
  });

  it('AC-PLN-013: a non-admin viewer without the Operator role is told who can see it', async () => {
    permissionState.canViewPlan = false;
    permissionState.isOperator = false;
    renderPage();
    expect(await screen.findByText(/visible to the organisation/i)).toBeInTheDocument();
  });
});
