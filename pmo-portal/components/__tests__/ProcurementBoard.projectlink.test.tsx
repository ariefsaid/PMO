/**
 * AC-JR-W1-04 (updated for C-PR-2/E-2 fix):
 * ProcurementBoard card — project name is rendered as INERT TEXT inside the
 * role=button KanbanCard, NOT as a nested <Link>. A nested interactive element
 * inside a role=button is invalid HTML and creates ambiguous activation (C-PR-2/E-2).
 *
 * Deliberate UX change (re-audit 2026-06-15, fix-wave-3 G3a):
 *   BEFORE: ProjectNameLink (<a>) nested inside role=button KanbanCard → invalid HTML.
 *   AFTER:  Project name as inert <span> — single activation target on the card.
 *   Goal-oracle unchanged: the project name must be visible on the card. Navigate to
 *   the project via the procurement detail page which links there.
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

describe('AC-JR-W1-04 / AC-C-PR-2: ProcurementBoard card — single activation target', () => {
  it('AC-C-PR-2: project name visible on board card (goal oracle: project context is shown)', () => {
    wrap([row()]);
    // The project name must be visible on the card
    expect(screen.getByText('Eastfield Phase 2')).toBeInTheDocument();
  });

  it('AC-C-PR-2: no nested <a> link inside the role=button card (no invalid HTML / single target)', () => {
    wrap([row()]);
    // There must be NO link wrapping the project name — the card is the single activation target
    const projectLinks = screen.queryAllByRole('link', { name: /Open Eastfield Phase 2/i });
    expect(projectLinks).toHaveLength(0);
  });

  it('AC-C-PR-2: card is the single role=button activation target', () => {
    wrap([row()]);
    // The KanbanCard is the role=button
    const cardBtn = screen.getByRole('button', { name: /Open Structural Steel/i });
    expect(cardBtn).toBeInTheDocument();
  });

  it('AC-C-PR-2: renders em-dash when project is null', () => {
    wrap([row({ project: null, project_id: null })]);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open /i })).toBeNull();
  });
});
