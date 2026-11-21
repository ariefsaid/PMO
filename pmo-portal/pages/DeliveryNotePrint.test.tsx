import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { setOrgTerms } from '@/src/lib/i18n/orgTerms';

const h = vi.hoisted(() => ({
  req: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  dnSettings: { data: { enabled: true, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] }, isPending: false, isError: false },
  orgName: 'PT Mega Konstruksi',
  navigate: vi.fn(),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => h.navigate,
  };
});

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: () => h.req,
  useDeliveryNoteSettings: () => h.dnSettings,
}));

vi.mock('@/src/hooks/useOrgName', () => ({
  useOrgName: () => h.orgName,
}));

vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => ({
    data: [
      { id: 'item-1', code: 'STEEL-01', name: 'Reinforcement Steel 12mm', unit_id: 'unit-bar' },
      { id: 'item-2', code: 'CEMENT-01', name: 'Portland Composite Cement', unit_id: 'unit-bag' },
    ],
  }),
  useStockUnits: () => ({
    data: [
      { id: 'unit-bar', code: 'bar', name: 'Bar' },
      { id: 'unit-bag', code: 'bag', name: 'Bag' },
    ],
  }),
  useStockWarehouses: () => ({
    data: [
      { id: 'wh-staging', code: 'STG-01', name: 'Site Staging Yard', kind: 'project_site', archived_at: null },
    ],
  }),
}));

vi.mock('@/src/hooks/useWorkOrderRecord', () => ({
  useWorkOrder: () => ({
    data: { id: 'wo-1', wo_number: 'WO-2026-088', title: 'Foundation Piling' },
  }),
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({
    data: [{ id: 'proj-1', name: 'Harbour Logistics Terminal', short_name: null, code: 'HLT' }],
  }),
}));

import DeliveryNotePrintPage from './DeliveryNotePrint';

const mockApprovedRequest = {
  id: 'mrq-1',
  number: 'MRQ-2026-0042',
  workOrderId: 'wo-1',
  projectId: 'proj-1',
  toWarehouseId: 'wh-staging',
  neededBy: '2026-11-28',
  note: 'Deliver before 10 AM to Gate 3',
  status: 'approved',
  round: 1,
  createdBy: 'user-1',
  createdAt: '2026-11-21T08:00:00Z',
  submittedAt: '2026-11-21T08:30:00Z',
  transferDocumentId: 'trans-1',
  transferCancelled: false,
  lines: [
    {
      id: 'line-1',
      lineNo: 1,
      itemId: 'item-1',
      quantity: 50,
      planQty: 40,
      priorQty: 0,
      overPlanReason: 'Extra piles required',
    },
    {
      id: 'line-2',
      lineNo: 2,
      itemId: 'item-2',
      quantity: 100,
      planQty: 100,
      priorQty: 0,
      overPlanReason: null,
    },
  ],
  steps: [],
  events: [],
};

const renderPage = (requestId = 'mrq-1') =>
  render(
    <MemoryRouter initialEntries={[`/material-requests/${requestId}/delivery-note`]}>
      <ToastProvider>
        <Routes>
          <Route path="/material-requests/:requestId/delivery-note" element={<DeliveryNotePrintPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

describe('DeliveryNotePrintPage (#2687)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOrgTerms({});
    h.dnSettings = {
      data: { enabled: true, signatureBlocks: ['Dispatched by', 'Delivered by', 'Received by'] },
      isPending: false,
      isError: false,
    };
    h.req = {
      data: mockApprovedRequest,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it('AC-DNP-003 shows disabled alert when delivery note setting is disabled', () => {
    h.dnSettings = {
      data: { enabled: false, signatureBlocks: [] },
      isPending: false,
      isError: false,
    };

    renderPage();
    expect(screen.getByTestId('delivery-note-disabled-state')).toBeInTheDocument();
    expect(
      screen.getByText(/Delivery note is not enabled or this request is not approved yet/i),
    ).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /Back to request/i });
    fireEvent.click(backBtn);
    expect(h.navigate).toHaveBeenCalledWith('/material-requests/mrq-1');
  });

  it('AC-DNP-003 shows disabled alert when request is in pending status', () => {
    h.req = {
      data: { ...mockApprovedRequest, status: 'pending' },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };

    renderPage();
    expect(screen.getByTestId('delivery-note-disabled-state')).toBeInTheDocument();
  });

  it('AC-DNP-005 renders approved delivery note with header, line items, and signature blocks', () => {
    renderPage();

    expect(screen.getByTestId('delivery-note-page')).toBeInTheDocument();
    expect(screen.getByText('PT Mega Konstruksi')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Delivery note');
    expect(screen.getByTestId('print-document-number')).toHaveTextContent('MRQ-2026-0042');

    // Metadata
    expect(screen.getByText('WO-2026-088 · Foundation Piling')).toBeInTheDocument();
    expect(screen.getByText('STG-01 · Site Staging Yard')).toBeInTheDocument();
    expect(screen.getByText('Deliver before 10 AM to Gate 3')).toBeInTheDocument();

    // Line items in table
    expect(screen.getByText('STEEL-01')).toBeInTheDocument();
    expect(screen.getByText('Reinforcement Steel 12mm')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('bar')).toBeInTheDocument();
    expect(screen.getByText('Extra piles required')).toBeInTheDocument();

    expect(screen.getByText('CEMENT-01')).toBeInTheDocument();
    expect(screen.getByText('Portland Composite Cement')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('bag')).toBeInTheDocument();

    // Signature blocks
    expect(screen.getByText('Dispatched by')).toBeInTheDocument();
    expect(screen.getByText('Delivered by')).toBeInTheDocument();
    expect(screen.getByText('Received by')).toBeInTheDocument();
  });

  it('AC-DNP-004 updates document title when organization terminology is overridden', () => {
    setOrgTerms({
      en: {
        deliveryNote: { singular: 'dispatch docket', plural: 'dispatch dockets' },
      },
    });

    renderPage();

    // H1 and action bar should reflect the terminology rewrite
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dispatch docket');
    expect(screen.getByText(/Dispatch docket MRQ-2026-0042/i)).toBeInTheDocument();
  });

  it('AC-DNP-008 invokes window.print when print button is clicked', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    renderPage();

    const printBtn = screen.getByRole('button', { name: 'Print' });
    fireEvent.click(printBtn);

    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});
