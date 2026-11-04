import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { SubcontractPoPositionRow } from '@/src/lib/db/subcontracts';
import { AppError } from '@/src/lib/appError';
import enProcurement from '@/public/locales/en/procurement.json';

const h = vi.hoisted(() => ({ position: { data: [] as unknown[], isPending: false, isError: false } }));
vi.mock('@/src/hooks/useSubcontract', () => ({ usePoPosition: () => h.position }));

import { SubcontractBillLines } from './SubcontractBillLines';
import { classifySubcontractBillError } from './subcontractBillError';

const row = (o: Partial<SubcontractPoPositionRow>): SubcontractPoPositionRow => ({
  boq_item_id: 'e1', item_code: 'L1', description: 'Concrete', unit: 'm3', rate: 100000, po_qty: 100, revision: 1,
  verified: 120, verified_not_on_po: 20, verified_at: null, disputed: 0, billed: 100, payable: 0, ...o,
});

function setup(rows: SubcontractPoPositionRow[], error: string | null = null) {
  h.position = { data: rows, isPending: false, isError: false };
  const onChange = vi.fn();
  const i18n = createInstance();
  void i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['procurement'], defaultNS: 'procurement', interpolation: { escapeValue: false },
    resources: { en: { procurement: enProcurement } } });
  render(<I18nextProvider i18n={i18n}><SubcontractBillLines poId="po1" currency="IDR" onChange={onChange} error={error} /></I18nextProvider>);
  return { onChange, i18n };
}

describe('SubcontractBillLines', () => {
  it('FR-SCA-051 prefills payable per line, reports the pre-tax amount, and states the cap in words at zero', () => {
    const { onChange } = setup([row({}), row({ boq_item_id: 'e2', item_code: 'L2', rate: 40000, po_qty: 50, verified: 30, billed: 10, payable: 20 })]);
    expect(screen.getByLabelText(/L2/)).toHaveValue('20');
    expect(screen.getByLabelText(/L1/)).toHaveValue('0');
    expect(screen.getByText('L1: nothing payable — 120 verified, 100 on the PO, 100 already billed')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(
      [{ boqItemId: 'e2', quantity: 20, rate: 40000 }], 800000);
  });

  it('FR-SCA-051 typing above payable is clamped and announced', async () => {
    const user = userEvent.setup();
    const { onChange } = setup([row({ payable: 20, billed: 80, verified: 100 })]);
    const input = screen.getByLabelText(/L1/);
    await user.clear(input);
    await user.type(input, '35');
    expect(input).toHaveValue('20');
    expect(screen.getByRole('status')).toHaveTextContent(/L1.*20/);
    expect(onChange).toHaveBeenLastCalledWith([{ boqItemId: 'e1', quantity: 20, rate: 100000 }], 2000000);
  });

  it('FR-SCA-051 editing down recomputes the amount', async () => {
    const user = userEvent.setup();
    const { onChange } = setup([row({ payable: 20, billed: 80, verified: 100 })]);
    const input = screen.getByLabelText(/L1/);
    await user.clear(input);
    await user.type(input, '5');
    expect(onChange).toHaveBeenLastCalledWith([{ boqItemId: 'e1', quantity: 5, rate: 100000 }], 500000);
  });

  it('FR-SCA-020 a server SC001 renders the refusal naming the line', () => {
    const err = new AppError('line L1 cannot be billed: verified 120, PO 100, billed 100, this bill 5', 'SC001');
    const { i18n } = setup([row({})], classifySubcontractBillError(err, i18n_t())?.detail ?? null);
    expect(screen.getByRole('alert')).toHaveTextContent(/L1 cannot be billed/);
    expect(classifySubcontractBillError(err, i18n.t.bind(i18n))?.headline).toMatch(/more than the accepted work allows/i);
  });

  it('FR-SCA-021 SC002 is classified as no issued lines; other errors are not', () => {
    const i18n = createInstance();
    void i18n.init({ lng: 'en', ns: ['procurement'], defaultNS: 'procurement', resources: { en: { procurement: enProcurement } } });
    const t = i18n.t.bind(i18n);
    expect(classifySubcontractBillError(new AppError('x', 'SC002'), t)?.headline).toMatch(/no issued BoQ lines/i);
    expect(classifySubcontractBillError(new AppError('x', '42501'), t)).toBeNull();
  });
});

function i18n_t() {
  const i = createInstance();
  void i.init({ lng: 'en', ns: ['procurement'], defaultNS: 'procurement', resources: { en: { procurement: enProcurement } } });
  return i.t.bind(i);
}
