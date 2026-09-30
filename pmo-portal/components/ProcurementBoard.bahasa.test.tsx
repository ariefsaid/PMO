/**
 * Discover 2026-09-30 — the /procurement Board's column titles (Purchase Request, Vendor Quotation,
 * …) were hard-coded English in Bahasa. Stage keys ('pr' | 'vq' | …) and status enums stay data;
 * only the displayed labels translate.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { BahasaProvider } from '@/test/bahasa';
import ProcurementBoard from './ProcurementBoard';

const renderBoard = () =>
  render(
    <BahasaProvider>
      <MemoryRouter>
        <ProcurementBoard procurements={[]} onOpen={vi.fn()} />
      </MemoryRouter>
    </BahasaProvider>,
  );

describe('ProcurementBoard in Bahasa', () => {
  it('column titles are Bahasa, not the English stage names', () => {
    renderBoard();
    const titleIn = (key: string, name: string) =>
      within(screen.getByTestId(`prstage-${key}`)).getByText(name, { exact: true });
    expect(titleIn('pr', 'Permintaan Pembelian')).toBeInTheDocument();
    expect(titleIn('vq', 'Penawaran Vendor')).toBeInTheDocument();
    expect(titleIn('po', 'Purchase Order')).toBeInTheDocument();
    expect(titleIn('gr', 'Penerimaan Barang')).toBeInTheDocument();
    expect(titleIn('vi', 'Invoice Vendor')).toBeInTheDocument();
    expect(titleIn('paid', 'Pembayaran')).toBeInTheDocument();
    for (const en of ['Purchase Request', 'Vendor Quote', 'Goods Receipt', 'Vendor Invoice', 'Payment']) {
      expect(screen.queryByText(en, { exact: true })).toBeNull();
    }
  });

  it('the empty-column message names the stage in Bahasa', () => {
    renderBoard();
    expect(screen.getByText('Tidak ada permintaan pada tahap Penawaran Vendor')).toBeInTheDocument();
    expect(screen.queryByText(/No requests at/)).toBeNull();
  });
});
