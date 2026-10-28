import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../DataTable';

interface Row {
  id: string;
  name: string;
  group: string;
}

const rows: Row[] = [
  { id: 'invoice-1', name: 'Invoice 1', group: 'Client A' },
  { id: 'invoice-2', name: 'Invoice 2', group: 'Client B' },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Invoice', cell: (row) => row.name },
  { key: 'group', header: 'Client', cell: (row) => row.group },
];

function mockViewport(isDesktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop && query.includes('min-width: 768px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('DataTable row selection', () => {
  it('selects a row by its accessible name without activating the row', async () => {
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();

    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowLabel={(row) => `Open ${row.name}`}
        onActivate={onActivate}
        selection={{ selectedIds: new Set(), onChange: onSelectionChange }}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Invoice 1' }));

    expect(onSelectionChange).toHaveBeenCalledOnce();
    expect([...onSelectionChange.mock.calls[0][0]]).toEqual(['invoice-1']);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('select all affects only visible rows and preserves hidden selections', async () => {
    const onSelectionChange = vi.fn();

    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        selection={{ selectedIds: new Set(['invoice-1']), onChange: onSelectionChange }}
        groupBy={(row) => row.group}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Client A/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));

    expect([...onSelectionChange.mock.calls[0][0]].sort()).toEqual(['invoice-1', 'invoice-2']);
  });

  it('uses a mixed state when some visible rows are already selected', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        selection={{ selectedIds: new Set(['invoice-1']), onChange: vi.fn() }}
      />,
    );

    expect(screen.getByRole('checkbox', { name: 'Select all rows' })).toHaveAttribute('aria-checked', 'mixed');
  });

  it('renders a group balance computed from that group’s rows', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        groupBy={(row) => row.group}
        groupHeader={(label, groupRows) => `Open balance ${label}: ${groupRows.length * 25}`}
      />,
    );

    expect(screen.getByText('Open balance Client A: 25')).toBeInTheDocument();
    expect(screen.getByText('Open balance Client B: 25')).toBeInTheDocument();
  });

  it('keeps row selection available in the phone card layout', async () => {
    mockViewport(false);
    const onSelectionChange = vi.fn();
    const onActivate = vi.fn();

    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        rowLabel={(row) => `Open ${row.name}`}
        onActivate={onActivate}
        selection={{ selectedIds: new Set(), onChange: onSelectionChange }}
      />,
    );

    expect(document.querySelector('[data-testid="dt-card-branch"]')).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Invoice 2' }));

    expect([...onSelectionChange.mock.calls[0][0]]).toEqual(['invoice-2']);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('uses a compact phone row when the caller supplies mobile title and details', () => {
    mockViewport(false);

    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        mobileCardTitle={(row) => <span>{row.group} · {row.name}</span>}
        mobileCardDetails={(row) => <div>{row.group} status · due today · $25 of $40</div>}
      />,
    );

    expect(screen.getByText('Client A · Invoice 1')).toBeInTheDocument();
    expect(screen.getByText('Client A status · due today · $25 of $40')).toBeInTheDocument();
    expect(screen.queryByText('Client')).not.toBeInTheDocument();
    expect(screen.queryByText('Group')).not.toBeInTheDocument();
  });
});
