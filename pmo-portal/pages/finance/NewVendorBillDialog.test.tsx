import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  data: [
    { id: 'p-ordered', code: 'PR-001', title: 'Pipes', status: 'Ordered', vendor: { name: 'Toko Baja' } },
    { id: 'p-draft', code: 'PR-002', title: 'Draft only', status: 'Draft', vendor: null },
    { id: 'p-paid', code: 'PR-003', title: 'Already paid', status: 'Paid', vendor: null },
  ],
}));
vi.mock('react-router', async (orig) => ({ ...(await orig<typeof import('react-router')>()), useNavigate: () => h.navigate }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: h.data, isPending: false, isError: false, refetch: vi.fn() }) }));

import { NewVendorBillDialog } from './NewVendorBillDialog';

beforeEach(() => h.navigate.mockReset());

describe('JOB-PU23 New vendor bill from the payables list', () => {
  it('offers only purchases that can take a bill and opens the bill form on the chosen one', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MemoryRouter><NewVendorBillDialog onClose={onClose} /></MemoryRouter>);
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Continue to the bill' });
    expect(submit).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: /Purchase/ }));
    expect(await screen.findByRole('option', { name: /PR-001/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /PR-002/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /PR-003/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: /PR-001/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Continue to the bill' }));
    expect(h.navigate).toHaveBeenCalledWith('/procurement/p-ordered/timeline?record=invoice', expect.anything());
    expect(onClose).toHaveBeenCalled();
  });
});
