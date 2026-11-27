import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => true }));
vi.mock('@/src/auth/impersonation', () => ({ useOptionalRealRole: () => 'Admin' }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => ({ isResolved: true, currency: 'IDR' }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { imprest: { getProcurementLimit: h.read, setProcurementLimit: h.write } } }));
import OrgImprestLimit from './OrgImprestLimit';
it('requires a successful limit read before an administrator can edit and offers retry', async () => {
  h.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(500);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrgImprestLimit /></QueryClientProvider>);
  expect(screen.getByLabelText('Limit per spend')).toBeDisabled();
  await userEvent.click(await screen.findByRole('button', { name: /Retry/i }));
  expect(await screen.findByDisplayValue('500')).toBeEnabled();
});
