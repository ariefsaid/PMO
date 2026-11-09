import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

/**
 * The server-paged directories (#1989) hold ONE page of rows in memory; Export must still
 * deliver EVERY row matching the current filter/search. This button fetches the full set at
 * click time and hands it to the same XLSX writer as the plain ExportButton — never the page
 * slice alone, and it stays disabled over an empty set.
 */
const h = vi.hoisted(() => ({
  exportXlsx: vi.fn(),
}));

vi.mock('../useExport', () => ({
  useExport: () => ({ exportXlsx: h.exportXlsx, busy: false }),
}));

import { ExportAllButton } from '../ExportAllButton';

beforeEach(() => {
  h.exportXlsx.mockReset();
});

const columns = [
  { key: 'name', header: 'Name', cell: (r: { name: string }) => r.name },
] as never;

describe('ExportAllButton', () => {
  it('is disabled when the matching set is empty (same rule as the plain ExportButton)', () => {
    render(
      <ExportAllButton
        entity="Companies"
        columns={columns}
        hasRows={false}
        fetchRows={() => Promise.resolve([])}
      />,
    );
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
    expect(h.exportXlsx).not.toHaveBeenCalled();
  });

  it('on click fetches the FULL matching set and exports those rows', async () => {
    const user = userEvent.setup();
    const all = [{ id: 'c1', name: 'Atlas' }, { id: 'c2', name: 'Beta' }];
    render(
      <ExportAllButton
        entity="Companies"
        columns={columns}
        hasRows
        fetchRows={() => Promise.resolve(all)}
      />,
    );
    await user.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => expect(h.exportXlsx).toHaveBeenCalledTimes(1));
    expect(h.exportXlsx).toHaveBeenCalledWith(all, columns, 'Companies');
  });

  it('a failed fetch never writes a file', async () => {
    const user = userEvent.setup();
    render(
      <ExportAllButton
        entity="Companies"
        columns={columns}
        hasRows
        fetchRows={() => Promise.reject(new Error('boom'))}
      />,
    );
    await user.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => expect(h.exportXlsx).not.toHaveBeenCalled());
  });
});
