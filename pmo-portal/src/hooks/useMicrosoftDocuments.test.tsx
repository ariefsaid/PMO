import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { m365DocumentQueryKeys, useMicrosoftDocuments } from './useMicrosoftDocuments';
const mock = vi.hoisted(() => ({ user: { id: 'user-a', org_id: 'org-a' } as { id: string; org_id: string } | null, status: vi.fn(), defaultLibrary: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: mock.user }) }));
vi.mock('@/src/lib/m365/connectClient', () => ({ getM365ConnectionStatus: () => mock.status() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { m365DocumentSettings: { getDefaultLibrary: () => mock.defaultLibrary() } } }));
describe('useMicrosoftDocuments', () => {
  it('uses caller-specific connection and org-scoped default keys; settings failures remain distinct', async () => {
    mock.status.mockResolvedValue({ connected: true, status: 'active' });
    mock.defaultLibrary.mockRejectedValue(new Error('settings unavailable'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useMicrosoftDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.connection).toMatchObject({ connected: true });
    expect(result.current.defaultLibrary).toBeNull();
    expect(client.getQueryCache().find({ queryKey: m365DocumentQueryKeys.connection('org-a', 'user-a') })).toBeDefined();
    expect(m365DocumentQueryKeys.connection('org-a', 'user-a')).not.toEqual(m365DocumentQueryKeys.connection('org-a', 'user-b'));
  });
});
