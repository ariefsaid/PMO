import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { setOrgTerms } from '@/src/lib/i18n/orgTerms';
import { setOrgRoleNames } from '@/src/hooks/useOrgRoleNames';

import i18nextRuntime from 'i18next';
import { orgTermsPlugin } from '@/src/lib/i18n';
import procEn from '@/public/locales/en/procurement.json';
const h = vi.hoisted(() => ({
  procurement: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  poSettings: {
    data: {
      enabled: true,
      signatureBlocks: ['Prepared by', 'Approved by', 'Vendor acceptance'],
      authorisedCollectors: ['Alice Smith', 'Bob Jones'],
    },
    isPending: false,
    isError: false,
  },
  orgName: 'PT Global Konstruksi',
  navigate: vi.fn(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => h.navigate,
  };
});

vi.mock('@/src/hooks/usePurchaseOrderSettings', () => ({
  usePurchaseOrderSettings: () => h.poSettings,
}));

vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => h.procurement,
}));

vi.mock('@/src/hooks/useOrgName', () => ({
  useOrgName: () => h.orgName,
}));

vi.mock('@/src/hooks/useWorkOrderRecord', () => ({
  useWorkOrder: () => ({
    data: { id: 'wo-1', wo_number: 'WO-2026-101', title: 'Main Highway Overpass' },
  }),
}));

import PurchaseOrderPrintPage from './PurchaseOrderPrint';

// The shipped runtime registers this plugin at boot; the test instance does not, so attach it here.
orgTermsPlugin.init(i18nextRuntime);
i18nextRuntime.addResourceBundle('en', 'procurement', procEn, true, true);

const mockProcurementWithPo = {
  id: 'proc-100',
  code: 'PR-2026-0099',
  title: 'Structural Steel Procurement',
  status: 'Ordered',
  currency: 'IDR',
  total_value: 25000000,
  project_id: 'proj-1',
  vendor_id: 'ven-1',
  vendor: { id: 'ven-1', name: 'PT Baja Nusantara' },
  project: { id: 'proj-1', name: 'Toll Road Bridge Package', code: 'TRB-01', short_name: null },
  work_order_id: 'wo-1',
  items: [
    {
      id: 'item-1',
      procurement_id: 'proc-100',
      name: 'Wide Flange Beam 200x100',
      description: 'Grade SS400 standard length',
      quantity: 10,
      rate: 1500000,
      amount: 15000000,
    },
    {
      id: 'item-2',
      procurement_id: 'proc-100',
      name: 'High Strength Bolts M20',
      description: 'Grade 8.8 with washer and nut',
      quantity: 100,
      rate: 100000,
      amount: 10000000,
    },
  ],
  purchase_orders: [
    {
      id: 'po-1',
      procurement_id: 'proc-100',
      po_number: 'PO-2026-0042',
      reference_number: 'REF-BAJA-99',
      status: 'Issued',
      date: '2026-11-21',
      amount: 25000000,
      currency: 'IDR',
      work_order_id: 'wo-1',
      created_at: '2026-11-21T08:00:00Z',
    },
  ],
};

const renderPage = (procurementId = 'proc-100', orderId = 'po-1') =>
  render(
    <MemoryRouter
      initialEntries={[`/procurement/${procurementId}/purchase-orders/${orderId}/print`]}
    >
      <ToastProvider>
        <Routes>
          <Route
            path="/procurement/:procurementId/purchase-orders/:orderId/print"
            element={<PurchaseOrderPrintPage />}
          />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

describe('PurchaseOrderPrintPage (#2688)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOrgTerms({});
    setOrgRoleNames({});
    h.poSettings = {
      data: {
        enabled: true,
        signatureBlocks: ['Prepared by', 'Approved by', 'Vendor acceptance'],
        authorisedCollectors: ['Alice Smith', 'Bob Jones'],
      },
      isPending: false,
      isError: false,
    };
    h.procurement = {
      data: mockProcurementWithPo,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it('AC-TR-010 shows a renamed term in a label and a renamed role on the signature line', () => {
    setOrgTerms({ en: { workOrder: { singular: 'job card', plural: 'job cards' } } });
    setOrgRoleNames({ en: { buyer: 'Purchasing lead' } });
    h.poSettings = {
      data: { enabled: true, signatureBlocks: ['Buyer', 'Vendor acceptance'], authorisedCollectors: [] },
      isPending: false,
      isError: false,
    };
    renderPage();
    expect(screen.getByText('Job card')).toBeInTheDocument();
    expect(screen.queryByText('Work order')).not.toBeInTheDocument();
    expect(screen.getByText('Purchasing lead')).toBeInTheDocument();
    expect(screen.queryByText('Buyer')).not.toBeInTheDocument();
  });

  it('AC-POP-003 shows disabled state notice when purchase order printing is disabled', () => {
    h.poSettings = {
      data: { enabled: false, signatureBlocks: [], authorisedCollectors: [] },
      isPending: false,
      isError: false,
    };

    renderPage();
    expect(screen.getByTestId('po-disabled-state')).toBeInTheDocument();
    expect(
      screen.getByText(/Purchase order printing is not enabled for your organisation/i),
    ).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn);
    expect(h.navigate).toHaveBeenCalled();
  });

  it('AC-POP-007 renders complete purchase order layout with metadata, items table, and signature blocks', () => {
    renderPage();

    expect(screen.getByTestId('purchase-order-page')).toBeInTheDocument();
    expect(screen.getByText('PT Global Konstruksi')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Purchase order/i);
    expect(screen.getByTestId('print-document-number')).toHaveTextContent('PO-2026-0042');

    // Procurement reference, vendor, project, work order, currency
    expect(screen.getByText('PR-2026-0099')).toBeInTheDocument();
    expect(screen.getByText('PT Baja Nusantara')).toBeInTheDocument();
    expect(screen.getByText('TRB-01 · Toll Road Bridge Package')).toBeInTheDocument();
    expect(screen.getByText('WO-2026-101 · Main Highway Overpass')).toBeInTheDocument();
    expect(screen.getByText('IDR')).toBeInTheDocument();

    // Line items with quantity, unit rate and amount
    const beamRow = screen.getByText('Wide Flange Beam 200x100').closest('tr') as HTMLElement;
    expect(beamRow).toHaveTextContent('10');
    expect(beamRow).toHaveTextContent('1,500,000');
    expect(beamRow).toHaveTextContent('15,000,000');
    expect(screen.getByText('High Strength Bolts M20')).toBeInTheDocument();

    // Order total comes from the purchase order's own amount
    const totalLine = screen.getByText(/Order total/i).closest('div') as HTMLElement;
    expect(totalLine).toHaveTextContent('25,000,000');

    // Signature blocks, each with a printed-name and a date line
    expect(screen.getByText('Prepared by')).toBeInTheDocument();
    expect(screen.getByText('Approved by')).toBeInTheDocument();
    expect(screen.getByText('Vendor acceptance')).toBeInTheDocument();
    expect(screen.getAllByText('Name:').length).toBe(3);
    expect(screen.getAllByText('Date:').length).toBe(3);
  });

  it('AC-POP-004 displays configured named collectors on the authorised-to-collect line', () => {
    renderPage();

    const section = screen.getByTestId('authorised-to-collect-section');
    expect(section).toBeInTheDocument();
    expect(screen.getByTestId('authorised-collectors-list')).toHaveTextContent(
      'Alice Smith, Bob Jones',
    );
  });

  it('AC-POP-005 updates the authorised-to-collect line when a specific collector is selected', () => {
    renderPage();

    const select = screen.getByTestId('collector-picker-select');
    fireEvent.change(select, { target: { value: 'Bob Jones' } });

    expect(screen.getByTestId('authorised-collectors-list')).toHaveTextContent('Bob Jones');
    expect(screen.getByTestId('authorised-collectors-list')).not.toHaveTextContent('Alice Smith');
  });

  it('AC-POP-006 renders an open collection line when no collectors are configured', () => {
    h.poSettings = {
      data: {
        enabled: true,
        signatureBlocks: ['Prepared by', 'Approved by'],
        authorisedCollectors: [],
      },
      isPending: false,
      isError: false,
    };

    renderPage();

    expect(screen.getByTestId('authorised-collectors-list')).toHaveTextContent(/___/);
  });

  it('AC-POP-008 invokes window.print when the print button is clicked', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    renderPage();

    const printBtn = screen.getByTestId('print-trigger-button');
    fireEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});
