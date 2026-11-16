/** #2353 — the pending-approvals count sits on the Approvals icon, not beside its label. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { PhoneNavBar } from '../PhoneNavBar';

vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => true }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { revenue: true, procurement: true, timesheets: true }, isPending: false, isError: false }),
}));
vi.mock('../ApprovalsNavCount', () => ({ ApprovalsNavCount: () => <span data-testid="count">7</span> }));

describe('#2353 approvals count placement', () => {
  it('puts the count inside the icon wrapper of the Approvals tab', () => {
    render(
      <MemoryRouter><PhoneNavBar onOpenMore={vi.fn()} onOpenSearch={vi.fn()} /></MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Approvals/ });
    const icon = within(link).getByTestId('phone-nav-icon');
    expect(within(icon).getByTestId('count')).toBeInTheDocument();
  });
});
