import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

const row = (id: string, status: string) => ({
  id, code: `PR-${id}`, title: `Row ${id}`, status, total_value: 1_000, approved_total_value: null, currency: 'USD',
  project_id: 'p-1', budget_category: 'Materials', requested_by_id: 'u-2', vendor_id: null,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: null, requested_by: { full_name: 'Requester' },
});
const procState = { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const roleState = { role: 'Finance' };

vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: roleState.role, effectiveRole: roleState.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: roleState.role }) }));

const renderBlock = (projectId?: string) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><ToastProvider><ProcurementBlock projectId={projectId} /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

describe('ProcurementBlock craft rulings', () => {
  beforeEach(() => {
    roleState.role = 'Finance';
    procState.data = [];
  });

  it('N11: an Approved procurement is named Approved, so "Request" keeps one meaning (not yet approved)', () => {
    procState.data = [row('a', 'Approved'), row('b', 'Requested')];
    renderBlock();

    const approvedRow = screen.getByRole('button', { name: 'Open Row a' }).closest('tr') as HTMLElement;
    const requestedRow = screen.getByRole('button', { name: 'Open Row b' }).closest('tr') as HTMLElement;
    expect(within(approvedRow).getByText('Approved')).toBeInTheDocument();
    expect(within(approvedRow).queryByText('Request')).toBeNull();
    expect(within(requestedRow).getByText('Requested')).toBeInTheDocument();
  });

  it('N7: an engineer\'s empty project tab says they raised none, with no column headers over the void', () => {
    roleState.role = 'Engineer';
    renderBlock('p-1');

    expect(screen.getByText("You haven't raised a procurement on this project.")).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('N7: other roles keep the plain empty wording', () => {
    renderBlock('p-1');

    expect(screen.getByText('No procurement on this project yet.')).toBeInTheDocument();
  });

  // #1791: number and supplier share ONE clipped line; the full text is reachable on title.
  it('O10 the record number comes first, the supplier follows, and the whole line is reachable on title', () => {
    procState.data = [{ ...row('a', 'Requested'), code: 'PROC-2026-001', vendor: { name: 'RackMount Systems International' } }];
    renderBlock();

    const code = screen.getByText('PROC-2026-001');
    const line = code.parentElement as HTMLElement;
    expect(line.textContent?.startsWith('PROC-2026-001')).toBe(true);
    expect(line).toHaveTextContent('PROC-2026-001 · RackMount Systems International');
    expect(line).toHaveAttribute('title', 'PROC-2026-001 · RackMount Systems International');
  });

  it('one-type r3 a long supplier is cut on one line with its full name reachable, and the number is never cut', () => {
    procState.data = [{ ...row('a', 'Requested'), code: 'PROC-2026-001', vendor: { name: 'RackMount Systems International' } }];
    renderBlock();

    const code = screen.getByText('PROC-2026-001');
    const line = code.parentElement as HTMLElement;
    expect(line.className).toMatch(/\bline-clamp-1\b/); // the line clips, the number sits first so only the tail goes
    expect(line.title).toContain('RackMount Systems International');
    expect(code.className).not.toMatch(/\bline-clamp\b|\btruncate\b/);
    expect(code.className).not.toMatch(/\bfont-mono\b/); // one type family
  });

  it('one-type r4 number and supplier are told apart by the separator " · "', () => {
    procState.data = [{ ...row('a', 'Requested'), code: 'PROC-2026-001', vendor: { name: 'VoltEdge Inverters' } }];
    renderBlock();

    const line = screen.getByText('PROC-2026-001').parentElement as HTMLElement;
    expect(line.textContent).toBe('PROC-2026-001 · VoltEdge Inverters');
  });

  // #2434: the first column leaves room for the supplier beside the uncut number (1440).
  it('#2434 the procurement column is wide enough to show the supplier beside the number', () => {
    procState.data = [{ ...row('a', 'Requested'), code: 'PROC-2026-001', vendor: { name: 'VoltEdge Inverters' } }];
    renderBlock();
    const header = document.querySelector('th[data-col-key="procurement"]') as HTMLElement;
    expect(parseInt(header.style.minWidth, 10)).toBeGreaterThanOrEqual(208);
  });

  // The longest Bahasa category word, "Subkontraktor", is 80.1px at 14px (measured, Hanken Grotesk); the cell has
  // 16px inset each side, so the column must be at least 112.1px and the cell must wrap at spaces only.
  it('a category word is never cut mid-word: the column fits the longest word and the cell wraps at spaces', () => {
    procState.data = [{ ...row('a', 'Requested'), budget_category: 'Subcontractors' }];
    renderBlock();
    const header = document.querySelector('th[data-col-key="category"]') as HTMLElement;
    expect(parseInt(header.style.minWidth, 10)).toBeGreaterThanOrEqual(113);
    const cell = screen.getByTitle(/subcontractors/i);
    expect(cell.className).toContain('break-normal');
  });

  // #2434: on a phone card the owner's name takes its own line under the action, so it is never cut by the button.
  it('#2434 a phone card puts the owner name on its own line, apart from the action button', () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 639px'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    procState.data = [{ ...row('a', 'Approved'), requested_by: { full_name: 'Siti Rahmawati Kusumaningrum' } }];
    renderBlock();
    const action = screen.getByRole('button', { name: 'Get quotes or order' });
    const owners = screen.getAllByText('Siti Rahmawati Kusumaningrum');
    expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) {
      expect(action.parentElement).not.toContainElement(owner);
      expect(owner.className).not.toMatch(/\btruncate\b/);
    }
  });
});
