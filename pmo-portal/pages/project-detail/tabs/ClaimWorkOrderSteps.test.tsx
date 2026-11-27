import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const h = vi.hoisted(() => ({ error: true, retry: vi.fn() }));
vi.mock('@/src/auth/AuthContext', async () => ({ AuthContext: (await import('react')).createContext({}) }));
vi.mock('@/src/hooks/useBillingSteps', () => ({ useWorkOrderSteps: () => ({ isError: h.error, isPending: false, refetch: h.retry, data: [] }) }));
import { ClaimWorkOrderSteps } from './ClaimWorkOrderSteps';
describe('Claim work order steps', () => {
  it('offers retry for failed steps and keeps genuine empty results empty', () => {
    const content = <QueryClientProvider client={new QueryClient()}><MemoryRouter><ClaimWorkOrderSteps workOrderId="wo1" /></MemoryRouter></QueryClientProvider>;
    const view = render(content);
    fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
    expect(h.retry).toHaveBeenCalled();
    h.error = false;
    view.rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ClaimWorkOrderSteps workOrderId="wo1" /></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByTestId('claim-wo-steps')).not.toBeInTheDocument();
  });
});
