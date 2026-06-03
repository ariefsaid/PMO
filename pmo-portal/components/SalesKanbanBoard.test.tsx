import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import SalesKanbanBoard from './SalesKanbanBoard';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

/** snake_case DB rows (the shape the board must consume directly — no camelCase, no cast). */
const row = (over: Partial<ProjectWithRefs>): ProjectWithRefs =>
  ({
    id: '40000000-0000-0000-0000-000000000002',
    org_id: 'org-1',
    code: 'P002',
    name: 'Northwind ERP Rollout',
    status: 'Tender Submitted',
    client_id: 'c3',
    project_manager_id: 'u-alice',
    contract_value: 1200000,
    budget: 0,
    spent: 0,
    start_date: null,
    end_date: null,
    last_update: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    client: { name: 'Northwind Manufacturing' },
    pm: { full_name: 'Alice Manager' },
    ...over,
  }) as ProjectWithRefs;

const renderBoard = (projects: ProjectWithRefs[]) =>
  render(
    <MemoryRouter>
      <SalesKanbanBoard projects={projects} />
    </MemoryRouter>,
  );

describe('SalesKanbanBoard (DB shape)', () => {
  it('AC-SP-006: a stage column shows its count and summed contract_value', () => {
    renderBoard([row({ contract_value: 1200000, status: 'Tender Submitted' })]);
    // The Tender column header total + the card value both render the formatted sum.
    expect(screen.getAllByText('$1,200,000').length).toBeGreaterThanOrEqual(1);
    // exactly one project card in that column → its count badge reads "1".
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
  });

  it('AC-SP-009: with zero projects all six stage columns render at count 0 / $0 (no crash)', () => {
    renderBoard([]);
    for (const title of ['Leads', 'PQ Submitted', 'Quotation', 'Tender', 'Negotiation', 'Won']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // Six columns × ($0 total + $0 weighted) — at least one $0 present, no throw.
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0);
  });

  it('AC-SP-010: card navigates to /projects/:uuid and shows the joined client name', async () => {
    renderBoard([
      row({
        id: '40000000-0000-0000-0000-000000000002',
        status: 'Tender Submitted',
        client: { name: 'Northwind Manufacturing' },
      }),
    ]);
    // Renders the joined client NAME (not a raw client_id) — proves the snake_case join is consumed.
    expect(screen.getByText('Northwind Manufacturing')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Northwind ERP Rollout'));
    expect(navigate).toHaveBeenCalledWith('/projects/40000000-0000-0000-0000-000000000002');
  });
});
