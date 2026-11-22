import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  PrintDocument,
  PrintActionBar,
  PrintHeader,
  PrintTable,
  PrintSignatureBlocks,
} from './index';

describe('AC-DNP-009 / AC-DNP-008 Reusable Print Helper Components', () => {
  it('PrintDocument renders container with print styles and avoid-break markers', () => {
    render(
      <PrintDocument testId="custom-doc">
        <div>Document Body Content</div>
      </PrintDocument>,
    );

    const doc = screen.getByTestId('custom-doc');
    expect(doc).toBeInTheDocument();
    expect(doc).toHaveTextContent('Document Body Content');
    expect(doc.className).toContain('bg-card');
    expect(doc.className).toContain('print:border-none');
  });

  it('PrintActionBar renders title, back button, and print trigger', () => {
    const onBack = vi.fn();
    const onPrint = vi.fn();

    render(
      <PrintActionBar
        title="Delivery Note Preview"
        onBack={onBack}
        onPrint={onPrint}
        printLabel="Print Note"
        backLabel="Back to Request"
      />,
    );

    expect(screen.getByText('Delivery Note Preview')).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /Back to Request/i });
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalledTimes(1);

    const printBtn = screen.getByRole('button', { name: /Print Note/i });
    fireEvent.click(printBtn);
    expect(onPrint).toHaveBeenCalledTimes(1);

    const bar = screen.getByTestId('print-action-bar');
    expect(bar.className).toContain('print-hide');
  });

  it('PrintActionBar falls back to window.print when onPrint is omitted', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<PrintActionBar title="Preview" onBack={() => {}} />);

    const printBtn = screen.getByTestId('print-trigger-button');
    fireEvent.click(printBtn);
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });

  it('PrintHeader displays org name, document title, number and metadata grid', () => {
    render(
      <PrintHeader
        orgName="ACME Engineering Ltd."
        documentTitle="Delivery Note"
        documentNumber="MRQ-2026-0099"
        metaItems={[
          { label: 'Work Order', value: 'WO-101' },
          { label: 'Project', value: 'Expansion Plant' },
          { label: 'Date', value: '2026-11-21' },
        ]}
      />,
    );

    expect(screen.getByText('ACME Engineering Ltd.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Delivery Note');
    expect(screen.getByTestId('print-document-number')).toHaveTextContent('MRQ-2026-0099');
    expect(screen.getByText('WO-101')).toBeInTheDocument();
    expect(screen.getByText('Expansion Plant')).toBeInTheDocument();
    expect(screen.getByText('2026-11-21')).toBeInTheDocument();
  });

  it('PrintTable renders line items with columns and right-aligned quantities', () => {
    interface TestItem {
      id: string;
      code: string;
      name: string;
      qty: number;
      unit: string;
    }

    const items: TestItem[] = [
      { id: '1', code: 'C-01', name: 'Cement Bag', qty: 50, unit: 'bag' },
      { id: '2', code: 'S-02', name: 'Sand M3', qty: 10.5, unit: 'm3' },
    ];

    render(
      <PrintTable<TestItem>
        columns={[
          { key: 'code', header: 'Item Code', render: (row) => row.code },
          { key: 'name', header: 'Description', render: (row) => row.name },
          { key: 'qty', header: 'Quantity', align: 'right', render: (row) => `${row.qty} ${row.unit}` },
        ]}
        data={items}
        keyExtractor={(row) => row.id}
      />,
    );

    expect(screen.getByText('Item Code')).toBeInTheDocument();
    expect(screen.getByText('Cement Bag')).toBeInTheDocument();
    expect(screen.getByText('50 bag')).toBeInTheDocument();
    expect(screen.getByText('Sand M3')).toBeInTheDocument();
    expect(screen.getByText('10.5 m3')).toBeInTheDocument();
    expect(screen.getByTestId('print-table-row-0').className).toContain('break-inside-avoid');
  });

  it('PrintTable shows empty state when no items provided', () => {
    render(
      <PrintTable
        columns={[{ key: 'name', header: 'Name', render: (r: unknown) => String(r) }]}
        data={[]}
        keyExtractor={(_, i) => String(i)}
        emptyText="No line items on this document"
      />,
    );

    expect(screen.getByText('No line items on this document')).toBeInTheDocument();
  });

  it('PrintSignatureBlocks renders standard 3 signature blocks with name and date lines', () => {
    render(
      <PrintSignatureBlocks
        blocks={['Dispatched by', 'Delivered by', 'Received by']}
        nameLabel="Nama"
        dateLabel="Tanggal"
        signLabel="Tanda Tangan"
      />,
    );

    expect(screen.getByText('Dispatched by')).toBeInTheDocument();
    expect(screen.getByText('Delivered by')).toBeInTheDocument();
    expect(screen.getByText('Received by')).toBeInTheDocument();

    const section = screen.getByTestId('print-signature-blocks');
    expect(section.className).toContain('break-inside-avoid');

    const blocks = screen.getAllByTestId(/^signature-block-/);
    expect(blocks).toHaveLength(3);
    expect(screen.getAllByText('Nama:')).toHaveLength(3);
    expect(screen.getAllByText('Tanggal:')).toHaveLength(3);
  });

  it('PrintSignatureBlocks supports object definitions for ticket #2688 purchase order collector line', () => {
    render(
      <PrintSignatureBlocks
        blocks={[
          { title: 'Authorized by', note: 'Project Manager' },
          { title: 'Vendor acknowledgment', note: 'Supplier representative' },
          { title: 'Authorized to collect', note: 'ID card verified at warehouse', signLabel: 'Collector sign' },
        ]}
      />,
    );

    expect(screen.getByText('Authorized by')).toBeInTheDocument();
    expect(screen.getByText('Project Manager')).toBeInTheDocument();
    expect(screen.getByText('Authorized to collect')).toBeInTheDocument();
    expect(screen.getByText('ID card verified at warehouse')).toBeInTheDocument();
    expect(screen.getByText('(Collector sign)')).toBeInTheDocument();
  });
});
