/**
 * AC-EXP-005: ExportButton renders an enabled "Export" button when rows are present.
 * AC-EXP-006: ExportButton renders a disabled "Export" button when rows is empty.
 * AC-EXP-007: ExportButton shows a loading spinner while export is in-flight.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ExportButton } from '../ExportButton';

// Mock the export utility so tests don't actually call exceljs
vi.mock('@/src/lib/export/exportToXlsx', () => ({
  exportToXlsx: vi.fn().mockResolvedValue(undefined),
}));

const baseProps = {
  rows: [{ id: '1', name: 'Alpha' }],
  columns: [
    { key: 'name', header: 'Name', cell: (r: { id: string; name: string }) => r.name, exportValue: (r: { id: string; name: string }) => r.name },
  ] as Parameters<typeof ExportButton>[0]['columns'],
  filename: 'test-export',
};

describe('ExportButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-EXP-005: renders an enabled Export button when rows are present', () => {
    render(<ExportButton {...baseProps} />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it('AC-EXP-006: renders a disabled Export button when rows is empty', () => {
    render(<ExportButton {...baseProps} rows={[]} />);
    const btn = screen.getByRole('button', { name: /export/i });
    expect(btn).toBeDisabled();
  });

  it('AC-EXP-007: calls exportToXlsx with rows, columns, and filename on click', async () => {
    const { exportToXlsx } = await import('@/src/lib/export/exportToXlsx');
    render(<ExportButton {...baseProps} />);
    const btn = screen.getByRole('button', { name: /export/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(exportToXlsx).toHaveBeenCalledWith(
        baseProps.rows,
        baseProps.columns,
        baseProps.filename,
      );
    });
  });

  it('AC-EXP-007: button shows loading state while export is in-flight', async () => {
    // Delay the mock so we can observe the loading state
    let resolveExport!: () => void;
    const { exportToXlsx } = await import('@/src/lib/export/exportToXlsx');
    vi.mocked(exportToXlsx).mockReturnValueOnce(
      new Promise<void>((res) => { resolveExport = res; }),
    );

    render(<ExportButton {...baseProps} />);
    const btn = screen.getByRole('button', { name: /export/i });
    fireEvent.click(btn);

    // While in-flight the button should be disabled (loading)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
    });

    resolveExport();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export/i })).not.toBeDisabled();
    });
  });
});
