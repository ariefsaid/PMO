import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { CrewsLink } from './CrewsLink';
const h = vi.hoisted(() => ({ readsAll: true, punctuality: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.readsAll }));
vi.mock('@/src/lib/repositories/siteCheckpoints', () => ({ siteCheckpointRepository: { punctuality: h.punctuality } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><CrewsLink /></MemoryRouter></QueryClientProvider>);
  return client;
}
it('shows the doorway without an aggregate request when permission answers it', async () => {
  h.readsAll = true;
  h.punctuality.mockResolvedValue({ crews: [] });
  const client = view();
  expect(screen.getByTestId('crews-link')).toBeVisible();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.punctuality).toHaveBeenCalledTimes(0);
  client.clear();
});
it('requests one aggregate for a restricted viewer and shows the doorway when rows exist', async () => {
  h.readsAll = false;
  h.punctuality.mockResolvedValue({ crews: [{ id: 'crew' }] });
  const client = view();
  await waitFor(() => expect(screen.getByTestId('crews-link')).toBeVisible());
  expect(h.punctuality).toHaveBeenCalledTimes(1);
  client.clear();
});
