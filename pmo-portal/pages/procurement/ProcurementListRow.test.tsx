import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { BahasaProvider } from '@/test/bahasa';
import { ProcurementListRow } from './ProcurementListRow';

// The expanded panel reads the detail query; a settled, empty detail is enough to render the region.
const detailQuery = vi.hoisted(() => ({ data: null as unknown, isPending: false, isError: false, refetch: vi.fn() }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => detailQuery }));

const row = {
  id: 'procurement-selected-quote',
  code: 'PR-2026-004',
  title: 'Lighting package',
  status: 'Quote Selected',
  total_value: 148000,
  currency: 'USD',
  project_id: 'project-1',
  requested_by_id: 'requester-1',
  vendor_id: 'vendor-1',
  created_at: '2026-10-01T00:00:00.000Z',
  project: { name: 'Office fit-out', code: 'PRJ-1' },
  vendor: { name: 'Bright Supply' },
  requested_by: { full_name: 'Project Manager' },
} as ProcurementWithRefs;

describe('AC-S19-002: procurement daily row', () => {
  beforeEach(() => {
    detailQuery.data = null;
    detailQuery.isPending = false;
    detailQuery.isError = false;
    detailQuery.refetch.mockClear();
  });

  it('shows the localized state and useful next step while leaving the full lifecycle to detail', () => {
    render(
      <BahasaProvider locale="id">
        <MemoryRouter>
          <ProcurementListRow row={row} />
        </MemoryRouter>
      </BahasaProvider>,
    );

    expect(screen.getByText('Penawaran Dipilih')).toBeInTheDocument();
    expect(screen.getByText('Langkah berikutnya: Siapkan purchase order')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /Lifecycle:/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lighting package' })).toHaveAttribute(
      'href',
      '/procurement/procurement-selected-quote',
    );
  });

  it('#1155: the preview toggle and its region are announced in Bahasa, with no English label', async () => {
    const user = userEvent.setup();
    render(
      <BahasaProvider locale="id">
        <MemoryRouter>
          <ProcurementListRow row={row} />
        </MemoryRouter>
      </BahasaProvider>,
    );

    const toggle = screen.getByRole('button', { name: 'Tampilkan pratinjau untuk Lighting package' });
    expect(screen.queryByRole('button', { name: /Show preview/i })).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Pratinjau untuk Lighting package' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Preview for/i })).not.toBeInTheDocument();
  });

  it('reports a procurement-specific preview error', async () => {
    detailQuery.isError = true;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ProcurementListRow row={row} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /show preview for/i }));
    expect(screen.getByText("Couldn't load procurement details")).toBeInTheDocument();
  });
});
