import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FxRateRow, FxRatePage } from '@/src/lib/repositories/types';

/**
 * Floor test for the exchange-rates row menu (floor-tests/admin-exchange-rates.md 3):
 * "Edit rate" opens the form with the date fixed and a changed rate saves for that date.
 * The other rows of this screen are driven by AdministrationExchangeRates.test.tsx.
 */
const h = vi.hoisted(() => ({
  list: vi.fn<(before?: string) => Promise<FxRatePage>>(),
  orgDay: vi.fn(),
  users: vi.fn(),
  role: 'Admin',
  effectiveRole: 'Admin',
  context: vi.fn(),
  upsert: vi.fn(),
  existing: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1', role: h.role }, role: h.role }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.effectiveRole }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string, context?: { record?: { viewOnly?: boolean } }) => {
    if (entity !== 'fxRate') return false;
    if (action === 'view' || action === 'upload') return (h.role === 'Admin' || h.role === 'Finance') && context?.record?.viewOnly !== true;
    return h.role === 'Admin';
  },
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    fxRates: { list: h.list, context: h.context, upsert: h.upsert, existing: h.existing },
  },
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => h.orgDay() }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => h.users() }));

import AdministrationExchangeRates from '../AdministrationExchangeRates';
import { ToastProvider } from '@/src/components/ui';

const fxRow = (index: number): FxRateRow => ({
  id: `rate-${index}`,
  org_id: 'org-1',
  rate_date: new Date(Date.UTC(2026, 9, 31 - index)).toISOString().slice(0, 10),
  rate: 16000 + index,
  base_currency: 'USD',
  quote_currency: 'IDR',
  source: 'JISDOR',
  created_by: null,
  updated_by: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});
const rows = Array.from({ length: 5 }, (_, i) => fxRow(i));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AdministrationExchangeRates />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.role = 'Admin';
  h.effectiveRole = 'Admin';
  h.list.mockReset();
  h.orgDay.mockReset();
  h.orgDay.mockReturnValue({ day: '2026-10-31', isPending: false, isError: false, retry: vi.fn() });
  h.list.mockResolvedValue({ rows, nextCursor: null, total: rows.length });
  h.context.mockResolvedValue({ currency: 'IDR', timezone: 'Asia/Jakarta' });
  h.users.mockReset();
  h.users.mockReturnValue({
    data: [
      { id: 'user-1', full_name: 'Ana Admin', role: 'Admin' },
      { id: 'user-2', full_name: 'Renata Halloway', role: 'Finance' },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(async () => undefined),
  });
  h.upsert.mockReset();
  h.upsert.mockResolvedValue({ new: 0, changed: 1, unchanged: 0 });
  h.existing.mockReset();
  h.existing.mockResolvedValue([]);
  vi.setSystemTime(new Date('2026-10-31T09:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Exchange rates — floor', () => {
  it('floor: Edit rate opens the form with the date fixed and saves a changed rate for that date (floor-tests/admin-exchange-rates.md 3)', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row').find((candidate) => candidate.textContent?.includes('31 Oct'));
    expect(row).toBeDefined();

    fireEvent.click(within(row!).getByRole('button', { name: 'Row actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit rate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit rate' });
    const date = within(dialog).getByLabelText(/Publication date/, { selector: 'input' });
    expect(date).toBeDisabled();
    expect(date).toHaveValue('2026-10-31');

    fireEvent.change(within(dialog).getByLabelText(/IDR per USD/, { selector: 'input, select, textarea' }), { target: { value: '16500' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save rate' }));

    await waitFor(() => expect(h.upsert).toHaveBeenCalledWith([{ rate_date: '2026-10-31', rate: 16500 }]));
  });
});
