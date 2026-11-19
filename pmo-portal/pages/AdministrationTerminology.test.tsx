import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const save = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/db/orgTerminology', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/db/orgTerminology')>()),
  listOrgTerminology: vi.fn().mockResolvedValue({ en: { workOrder: { singular: 'Job card', plural: 'Job cards' } } }),
  saveOrgTerm: (...a: unknown[]) => save(...a),
  resetOrgTerm: (...a: unknown[]) => reset(...a),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));

import AdministrationTerminology from './AdministrationTerminology';

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <AdministrationTerminology />
      </ToastProvider>
    </QueryClientProvider>,
  );

describe('AC-TERM-004 Administration › Terminology', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows the saved override and saves an edit for one language', async () => {
    wrap();
    const row = await screen.findByTestId('term-row-workOrder-en');
    const singular = row.querySelector('input') as HTMLInputElement;
    await waitFor(() => expect(singular.value).toBe('Job card'));
    await userEvent.clear(singular);
    await userEvent.type(singular, 'Ticket');
    await userEvent.click(row.querySelectorAll('button')[0]);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ key: 'workOrder', locale: 'en', singular: 'Ticket' })));
  });
  it('resets one row back to the default wording', async () => {
    wrap();
    const row = await screen.findByTestId('term-row-workOrder-en');
    await waitFor(() => expect((row.querySelector('input') as HTMLInputElement).value).toBe('Job card'));
    await userEvent.click(row.querySelectorAll('button')[1]);
    await waitFor(() => expect(reset).toHaveBeenCalledWith('workOrder', 'en'));
  });
});
