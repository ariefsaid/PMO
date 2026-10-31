/**
 * AC-PHO-101 — Administration > Features carries one Admin-owned switch for feedback and surveys.
 * An Admin sees a real switch and flipping it calls the Admin RPC path; any other role sees a status
 * pill only. The Operator-only toggles above it are untouched (AC-ENT-004 keeps its own file).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const state = vi.hoisted(() => ({ features: {} as Record<string, boolean | undefined>, setMock: vi.fn() }));

vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: state.features }) }));
vi.mock('@/src/lib/analytics/config', () => ({ getAnalyticsConfig: () => ({ demoMode: false }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    orgFeature: { listOwn: vi.fn(), toggle: vi.fn(), setFeedbackSurveys: (v: boolean) => state.setMock(v) },
  },
}));

import { FeedbackSurveysSetting } from './FeedbackSurveysSetting';

const renderAs = (realRole: 'Admin' | 'Finance') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ImpersonationProvider realRole={realRole}>
        <MemoryRouter>
          <ToastProvider>
            <FeedbackSurveysSetting />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.features = {};
  state.setMock = vi.fn().mockResolvedValue(undefined);
});

describe('AC-PHO-101 Admin switch for feedback and surveys', () => {
  it('an Admin sees it on by default and can switch it off', async () => {
    renderAs('Admin');
    const sw = screen.getByRole('switch', { name: /feedback and surveys/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(state.setMock).toHaveBeenCalledWith(false));
  });

  it('a stored off row shows off and flips back on', async () => {
    state.features = { feedback_surveys: false };
    renderAs('Admin');
    const sw = screen.getByRole('switch', { name: /feedback and surveys/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(state.setMock).toHaveBeenCalledWith(true));
  });

  it('a non-Admin sees the state as text with no control', () => {
    renderAs('Finance');
    expect(screen.queryByRole('switch', { name: /feedback and surveys/i })).toBeNull();
    expect(screen.getByText(/feedback and surveys/i)).toBeInTheDocument();
  });
});
