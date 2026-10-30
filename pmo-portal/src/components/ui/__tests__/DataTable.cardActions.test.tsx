import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DataTable, MenuButton, type Column } from '../DataTable';

interface Row { id: string; name: string; value: number }

const rows: Row[] = [{ id: 'R-1', name: 'Alpha Corp', value: 125000 }];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Project', kind: 'primary', cell: (row) => row.name },
  { key: 'value', header: 'Contract', align: 'num', cell: (row) => row.value },
  {
    key: 'actions',
    header: <span className="sr-only">Actions</span>,
    kind: 'actions',
    cell: (row) => <MenuButton ariaLabel={`Actions for ${row.name}`} items={[{ label: 'Open project', onClick: () => {} }]} />,
  },
];

function phoneViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('DataTable phone card actions', () => {
  it('N10: an actions column sits in the card title row (top-right), not as a trailing line under the figures', () => {
    phoneViewport();
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} accessibleName="Projects" />);

    const card = within(screen.getByTestId('dt-card-branch')).getByRole('listitem');
    const menu = within(card).getByRole('button', { name: 'Actions for Alpha Corp' });
    const titleRow = card.firstElementChild as HTMLElement;
    expect(titleRow).toContainElement(menu);
    expect(titleRow).toHaveTextContent('Alpha Corp');
    // The figures list keeps its data and loses the empty "Actions" line.
    const figures = card.querySelector('dl') as HTMLElement;
    expect(figures).toHaveTextContent('Contract');
    expect(figures).not.toContainElement(menu);
    expect(within(figures).queryByText('Actions')).not.toBeInTheDocument();
  });

  it('keeps the actions column as its own table column on desktop', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(row) => row.id} accessibleName="Projects" />);
    const row = within(screen.getByRole('table', { name: 'Projects' })).getAllByRole('row')[1] as HTMLElement;
    expect(within(row).getByRole('button', { name: 'Actions for Alpha Corp' })).toBeInTheDocument();
  });
});
