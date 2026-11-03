import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import enProcurement from '@/public/locales/en/procurement.json';
import idProcurement from '@/public/locales/id/procurement.json';
import type { SubcontractPoPositionRow } from '@/src/lib/db/subcontracts';

const h = vi.hoisted(() => ({
  route: { data: { route: 'project', reason: 'project route', approver_ids: ['u2'], line_budget: 100, line_used: 0 }, isPending: false, isError: false },
  users: { data: [{ id: 'u2', full_name: 'Project approver' }] },
}));
vi.mock('@/src/hooks/useSubcontract', () => ({ useVariationRoute: () => h.route }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => h.users }));

import PoVariationModal from './PoVariationModal';

const row: SubcontractPoPositionRow = {
  boq_item_id: 'boq-1', item_code: 'L1', description: 'Concrete', unit: 'm3', rate: 100000,
  po_qty: 100, revision: 1, verified: 120, verified_not_on_po: 20, verified_at: null,
  disputed: 0, billed: 100, payable: 0,
};

function renderModal(onSave: (input: unknown) => Promise<string> = vi.fn().mockResolvedValue('var-1')) {
  const i18n = createInstance();
  void i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['procurement'], defaultNS: 'procurement', interpolation: { escapeValue: false },
    resources: { en: { procurement: enProcurement }, id: { procurement: idProcurement } } });
  return render(<I18nextProvider i18n={i18n}><PoVariationModal row={row} origin="post_work" currency="IDR" onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></I18nextProvider>);
}

beforeEach(() => {
  h.route = { data: { route: 'project', reason: 'project route', approver_ids: ['u2'], line_budget: 100, line_used: 0 }, isPending: false, isError: false };
});

describe('PoVariationModal', () => {
  it('FR-SCA-034 requires a reason and refuses post-work quantity above verified excess', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue('var-1');
    renderModal(onSave);
    const dialog = screen.getByRole('dialog', { name: 'Request PO variation' });
    await user.click(within(dialog).getByRole('button', { name: 'Request variation' }));
    expect(await within(dialog).findByText('Give a reason for the variation.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    await user.type(within(dialog).getByLabelText(/Reason/), 'Verified additional work');
    await user.clear(within(dialog).getByLabelText(/additional quantity/i));
    await user.type(within(dialog).getByLabelText(/additional quantity/i), '21');
    await user.click(within(dialog).getByRole('button', { name: 'Request variation' }));
    expect(await within(dialog).findByText(/cannot exceed the 20 verified amount/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the server-resolved approval route after the variation is requested', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue('var-1');
    renderModal(onSave);
    const dialog = screen.getByRole('dialog', { name: 'Request PO variation' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Verified additional work');
    await user.click(within(dialog).getByRole('button', { name: 'Request variation' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Decided by Project approver');
    expect(onSave).toHaveBeenCalledWith({
      origin: 'post_work', reason: 'Verified additional work', lines: [{ boqItemId: 'boq-1', additionalQuantity: 20 }],
    });
  });
});
