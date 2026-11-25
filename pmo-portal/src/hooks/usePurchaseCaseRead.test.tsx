import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePurchaseCaseRead } from './usePurchaseCaseRead';
const gate = vi.hoisted(() => ({ read: vi.fn() }));
vi.unmock('@/src/hooks/usePurchaseCaseRead');
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'manager', org_id: 'org' } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurement: { mayReadPurchaseCases: gate.read } } }));

describe('purchase inspection scope', () => {
  it.each([true, false])('follows the server answer %s, failing closed until it arrives', async (answer) => {
    let resolve!: (allowed: boolean) => void;
    gate.read.mockReturnValue(new Promise<boolean>((done) => { resolve = done; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: React.PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(usePurchaseCaseRead, { wrapper });
    expect(result.current).toBe(false);
    resolve(answer);
    await waitFor(() => expect(client.getQueryState(['purchase-case-read', 'org'])?.status).toBe('success'));
    expect(result.current).toBe(answer);
    client.clear();
  });
  it('keeps a failed read closed', async () => {
    gate.read.mockRejectedValue(new Error('Unavailable'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: React.PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(usePurchaseCaseRead, { wrapper });
    await waitFor(() => expect(client.getQueryState(['purchase-case-read', 'org'])?.status).toBe('error'));
    expect(result.current).toBe(false);
    client.clear();
  });
});
