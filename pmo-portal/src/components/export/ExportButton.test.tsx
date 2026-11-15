/**
 * ExportButton — the default label comes from the catalogue (#2345, fresh-eyes row 11): callers that
 * pass no `label` must get the catalogue's Export word ("Export" / "Ekspor"), not a hard-coded
 * English default. An explicit `label` still wins.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ExportButton } from './ExportButton';
import { BahasaProvider } from '@/test/bahasa';

const rows = [{ name: 'Acme' }];
const columns = [{ key: 'name', header: 'Name', cell: (row: { name: string }) => row.name }];

describe('ExportButton default label', () => {
  it('renders "Ekspor" under id when no label is passed (#2345 row 11)', () => {
    render(
      <ToastProvider>
        <BahasaProvider locale="id">
          <ExportButton rows={rows} columns={columns} entity="Things" />
        </BahasaProvider>
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Ekspor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('an explicit label still wins', () => {
    render(
      <ToastProvider>
        <ExportButton rows={rows} columns={columns} entity="Things" label="Export selected" />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Export selected' })).toBeInTheDocument();
  });
});
