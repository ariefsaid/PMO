/**
 * AC-JR-W1-04: ProcurementBoard card — project name is a <ProjectNameLink>
 * (link to /projects/:project_id), not inert text.
 *
 * (census violation E, ProcurementBoard.tsx:46)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ProcurementBoard from '../ProcurementBoard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

const row = (over: Partial<ProcurementWithRefs> = {}): ProcurementWithRefs =>
  ({
    id: 'p1',
    code: 'PR-2606040001',
    title: 'Structural Steel',
    status: 'Ordered',
    total_value: 842000,
    project_id: 'proj-001',
    requested_by_id: 'u1',
    vendor_id: null,
    created_at: '2026-02-05T00:00:00Z',
    project: { name: 'Eastfield Phase 2', code: 'PRJ-001' },
    vendor: null,
    requested_by: { full_name: 'Desmond Achebe' },
    ...over,
  }) as ProcurementWithRefs;

const wrap = (procurements: ProcurementWithRefs[]) =>
  render(
    <MemoryRouter>
      <ProcurementBoard procurements={procurements} onOpen={vi.fn()} />
    </MemoryRouter>,
  );

describe('AC-JR-W1-04: ProcurementBoard card project name links', () => {
  it('AC-JR-W1-04: project name on board card is a link to /projects/:project_id', () => {
    wrap([row()]);
    const link = screen.getByRole('link', { name: 'Open Eastfield Phase 2' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/projects/proj-001');
  });

  it('AC-JR-W1-04: renders em-dash when project is null (no link)', () => {
    wrap([row({ project: null, project_id: null })]);
    // The em-dash placeholder renders as text, no link
    expect(screen.queryByRole('link', { name: /Open /i })).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
