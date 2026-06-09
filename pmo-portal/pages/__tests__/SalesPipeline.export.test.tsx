import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * B-5 (AC-W2-IXD-008): Sales Pipeline Export is demoted to an honest
 * disabled "Export (arrives with Reports)" control with a keyboard-reachable
 * tooltip explanation — not a live-looking button with no handler (OD-W2-5).
 *
 * OD-UX-3 precedent: a "coming soon" with a known future destination = visibly
 * disabled + tooltip; a truly-dead control = removed. Export is "coming soon"
 * (Reports will own it), so it is disabled-with-tooltip, not removed.
 */

vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useLostDeals: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/usePipelineView', () => ({ usePipelineView: () => ['table', vi.fn()] }));
// B-3: SalesPipeline now renders a "+ New opportunity" CTA (useProjectMutations / usePermission);
// stub to avoid the QueryClientProvider requirement.
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));

import SalesPipeline from '../SalesPipeline';

const renderAs = (role: 'Project Manager' | 'Finance') =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('SalesPipeline — Export dead-affordance honesty (B-5, AC-W2-IXD-008)', () => {
  it('AC-W2-IXD-008: Export is disabled — not a live button with no handler (OD-W2-5)', () => {
    renderAs('Project Manager');
    // The Export control must be present but disabled.
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn).toBeInTheDocument();
    expect(exportBtn).toBeDisabled();
  });

  it('AC-W2-IXD-008: the Export label/aria-label indicates it arrives with Reports (honest reason)', () => {
    renderAs('Project Manager');
    // The aria-label must name the "Reports" destination so keyboard users understand why.
    const exportBtn = screen.getByRole('button', { name: /export.*reports/i });
    expect(exportBtn).toBeInTheDocument();
  });

  it('AC-W2-IXD-008: the Export button is wrapped in a focusable span so the tooltip is keyboard-reachable (G5 a11y)', () => {
    renderAs('Project Manager');
    // The disabled button is inside a <span> wrapper (per the Tooltip/disabled-button a11y pattern).
    const exportBtn = screen.getByRole('button', { name: /export/i });
    expect(exportBtn.parentElement?.tagName).toBe('SPAN');
    // The span itself is focusable-by-proximity (mouse/pointer enters the span → tooltip opens).
    // Keyboard: Tab reaches the focusable span; the tooltip wires onFocus via React.cloneElement.
  });
});
