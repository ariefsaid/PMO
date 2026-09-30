import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ExportButton } from '../ExportButton';
import type { Column } from '@/src/components/ui';

const exportXlsx = vi.fn();
vi.mock('../useExport', () => ({ useExport: () => ({ exportXlsx, busy: false }) }));

type R = { name: string };
const cols: Column<R>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, exportValue: (r) => r.name },
];

describe('ExportButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AC-EXP-006: clicking exports the page rows, columns, and entity', async () => {
    const rows = [{ name: 'Acme' }];
    render(<ExportButton rows={rows} columns={cols} entity="Companies" />);
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(exportXlsx).toHaveBeenCalledWith(rows, cols, 'Companies');
  });

  it('AC-EXP-007: an empty visible list disables Export', () => {
    render(<ExportButton rows={[]} columns={cols} entity="Companies" />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('AC-EXP-007: an explicit disabled prop also disables Export', () => {
    render(<ExportButton rows={[{ name: 'Acme' }]} columns={cols} entity="Companies" disabled />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('AC-PRJUX-001: a custom label renders instead of the default Export', () => {
    render(<ExportButton rows={[{ name: 'Acme' }]} columns={cols} entity="Projects" label="Ekspor" />);
    expect(screen.getByRole('button', { name: /ekspor/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^export$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJUX-001: onExport fires when Export dispatches', async () => {
    const onExport = vi.fn();
    const rows = [{ name: 'Acme' }];
    render(<ExportButton rows={rows} columns={cols} entity="Companies" onExport={onExport} />);
    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(exportXlsx).toHaveBeenCalledWith(rows, cols, 'Companies');
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
