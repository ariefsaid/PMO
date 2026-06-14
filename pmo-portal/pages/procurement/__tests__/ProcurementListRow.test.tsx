/**
 * AC-JR-W1-03: ProcurementListRow — project name in meta renders as a
 * <ProjectNameLink> (link to /projects/:project_id), not inert text.
 *
 * (census violation E, ProcurementListRow.tsx:162)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// ── Mock useProcurementDetail (ExpandedPanel fetches on mount, not relevant here) ──
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: () => ({
    data: null,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { ProcurementListRow } from '../ProcurementListRow';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const makeRow = (over: Partial<ProcurementWithRefs> = {}): ProcurementWithRefs =>
  ({
    id: 'pr-1',
    code: 'PR-0001',
    title: 'Crane Hire',
    status: 'Requested',
    total_value: 25000,
    created_at: '2026-06-01T00:00:00Z',
    project_id: 'project-xyz',
    requested_by_id: 'u1',
    project: { name: 'Harbour Bridge', code: 'HB-01' },
    requested_by: { full_name: 'Alice Engineer' },
    vendor: null,
    vendor_id: null,
    ...over,
  }) as ProcurementWithRefs;

const wrap = (row: ProcurementWithRefs) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProcurementListRow row={row} />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('AC-JR-W1-03: ProcurementListRow meta — project name links', () => {
  it('AC-JR-W1-03: project name in row meta is a link to /projects/:project_id', () => {
    wrap(makeRow());
    const link = screen.getByRole('link', { name: 'Open Harbour Bridge' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/projects/project-xyz');
  });

  it('AC-JR-W1-03: omits project link when project is null', () => {
    wrap(makeRow({ project: undefined, project_id: null }));
    // No project-name link; title link still present
    const links = screen.getAllByRole('link');
    const projectLinks = links.filter((l) =>
      l.getAttribute('aria-label')?.startsWith('Open '),
    );
    expect(projectLinks).toHaveLength(0);
  });
});
