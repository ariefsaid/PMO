import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@/src/hooks/useBillingSteps', () => ({ useOverdueClaimSteps: () => ({ data: h.data }) }));
import { ClaimOverdueMarker } from '../ClaimOverdueMarker';

const withClient = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe('ClaimOverdueMarker (AC-CBS-013)', () => {
  it('names the overdue step and the days over on the claim that has one', () => {
    h.data = [{ claimId: 'c1', stepName: 'Client review', daysOver: 7 }];
    render(withClient(<ClaimOverdueMarker claimId="c1" projectId="p1" />));
    expect(screen.getByText('Client review overdue by 7 days')).toBeInTheDocument();
  });

  it('shows nothing on a claim with no overdue step', () => {
    h.data = [{ claimId: 'other', stepName: 'Client review', daysOver: 7 }];
    const { container } = render(withClient(<ClaimOverdueMarker claimId="c1" projectId="p1" />));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing while unread or when the read failed', () => {
    h.data = undefined;
    const { container } = render(withClient(<ClaimOverdueMarker claimId="c1" projectId="p1" />));
    expect(container).toBeEmptyDOMElement();
  });
});
