import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ToastProvider } from '@/src/components/ui';
import type { SubcontractPoPositionRow, SubcontractAcceptanceWithLines } from '@/src/lib/db/subcontracts';
import enProcurement from '@/public/locales/en/procurement.json';
import SubcontractAcceptanceModal from './SubcontractAcceptanceModal';

const rows: SubcontractPoPositionRow[] = [{
  boq_item_id: 'e1', item_code: 'L1', description: 'Concrete', unit: 'm3', rate: 100000, po_qty: 100, revision: 1,
  verified: 80, verified_not_on_po: 0, verified_at: null, disputed: 0, billed: 0, payable: 80,
}];
const confirmed = {
  id: 'a0', status: 'Confirmed', confirmed_at: '2026-10-01T00:00:00Z', acceptance_date: '2026-10-01', prepared_by: 'u1',
  document_id: null, note: null, confirm_basis: 'standard', lines: [{ acceptance_id: 'a0', boq_item_id: 'e1', quantity: 80 }],
} as unknown as SubcontractAcceptanceWithLines;
const draft = { ...confirmed, id: 'a1', status: 'Draft', confirmed_at: null, lines: [{ acceptance_id: 'a1', boq_item_id: 'e1', quantity: 90 }] } as unknown as SubcontractAcceptanceWithLines;

function renderModal(over: Partial<React.ComponentProps<typeof SubcontractAcceptanceModal>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const i18n = createInstance();
  void i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['procurement'], defaultNS: 'procurement', interpolation: { escapeValue: false },
    resources: { en: { procurement: enProcurement } } });
  render(
    <I18nextProvider i18n={i18n}><ToastProvider>
      <SubcontractAcceptanceModal rows={rows} acceptances={[confirmed]} documents={[]} draft={null} today="2026-11-02"
        onClose={vi.fn()} onSave={onSave} onError={vi.fn()} {...over} />
    </ToastProvider></I18nextProvider>,
  );
  return { onSave };
}

describe('SubcontractAcceptanceModal', () => {
  it('FR-SCA-014 the input refuses a value below the last confirmed', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();
    const input = screen.getByLabelText(/L1/);
    expect(input).toHaveValue('80');
    await user.clear(input);
    await user.type(input, '50');
    await user.click(screen.getByRole('button', { name: /prepare acceptance/i }));
    expect(await screen.findByText(/cannot be less than the last confirmed 80/i)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('FR-SCA-013 entering 120 on a 100 line shows the "verified, not on PO" hint and does not block', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();
    const input = screen.getByLabelText(/L1/);
    await user.clear(input);
    await user.type(input, '120');
    expect(screen.getByTestId('sc-over-e1')).toHaveTextContent(/verified, not on PO/i);
    await user.click(screen.getByRole('button', { name: /prepare acceptance/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ boqItemId: 'e1', quantity: 120 }] }));
  });

  it('FR-SCA-012 Confirm is hidden for the preparer unless the org has one active member', () => {
    renderModal({ draft, preparedByMe: true, canConfirm: true, soleOperator: false, onConfirm: vi.fn(), onWithdraw: vi.fn() });
    expect(screen.queryByRole('button', { name: /^confirm acceptance$/i })).toBeNull();
    expect(screen.getByText(/another admin or finance user must confirm/i)).toBeInTheDocument();
  });

  it('FR-SCA-012 the sole active member who prepared it can confirm', () => {
    renderModal({ draft, preparedByMe: true, canConfirm: true, soleOperator: true, onConfirm: vi.fn(), onWithdraw: vi.fn() });
    expect(screen.getByRole('button', { name: /^confirm acceptance$/i })).toBeInTheDocument();
  });

  it('FR-SCA-012 Confirm is hidden when the role may not confirm', () => {
    renderModal({ draft, preparedByMe: false, canConfirm: false, soleOperator: false, onConfirm: vi.fn(), onWithdraw: vi.fn() });
    expect(screen.queryByRole('button', { name: /^confirm acceptance$/i })).toBeNull();
  });

  it('FR-SCA-011 Withdraw on a draft calls onWithdraw with its id', async () => {
    const user = userEvent.setup();
    const onWithdraw = vi.fn().mockResolvedValue(undefined);
    renderModal({ draft, preparedByMe: false, canConfirm: true, onConfirm: vi.fn(), onWithdraw });
    await user.click(screen.getByRole('button', { name: /withdraw draft/i }));
    expect(onWithdraw).toHaveBeenCalledWith('a1');
  });
});
