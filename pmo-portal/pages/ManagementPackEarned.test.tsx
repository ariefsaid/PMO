import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** #2733 AC-EBR-012 — the pack shows earned, billed, gap and margin on both bases from the project tab's own roll-up. */
vi.unmock('@/pages/ManagementPackEarned'); // test/setup.ts stubs it for the pack suites
const h = vi.hoisted(() => ({ setting: { data: true }, rpc: vi.fn(), role: 'Finance' }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => h.setting }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await import('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never) => can(action, entity, { realRole: h.role as never }) };
});

import ManagementPackEarned from './ManagementPackEarned';

const row = (extra: Record<string, unknown> = {}) => ({
  project_id: 'p1', project_name: 'Fixture project', currency: 'USD', earned: 100,
  billed: '60.00', cost: '70.00', comparable: true, restricted: false,
  unrated_lines: 0, work_orders: 1, work_orders_without_progress: 0, ...extra,
});

function setData(rows: unknown[]) {
  h.rpc.mockResolvedValue({ data: rows, error: null });
}

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ManagementPackEarned /></QueryClientProvider>);
}

beforeEach(() => { h.setting = { data: true }; h.role = 'Finance'; h.rpc.mockReset(); });

describe('ManagementPackEarned', () => {
  it('AC-EBR-012 shows earned, billed, gap and margin on each basis per project, equal to the tab', async () => {
    setData([row()]);
    renderReport();
    await screen.findByTestId('pack-earned-row-p1-USD-earned');
    expect(screen.getByTestId('pack-earned-row-p1-USD-earned').textContent).toMatch(/100/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-billed').textContent).toMatch(/60/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-gap').textContent).toMatch(/40/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-marginEarned').textContent).toMatch(/30/);
    expect(screen.getByTestId('pack-earned-row-p1-USD-marginBilled').textContent).toMatch(/^Loss of .*10/);
  });

  it('AC-EBR-004 a project with work orders lacking progress reads incomplete in words', async () => {
    setData([row({ work_orders: 2, work_orders_without_progress: 1 })]);
    renderReport();
    await screen.findByTestId('pack-earned-row-p1-USD-earned');
    expect(screen.getByTestId('pack-earned-row-p1-USD-earned').textContent).toMatch(/^Incomplete/);
  });

  it.each([1, 30])('AC-RR-003 loads %i projects with one totals request', async (count) => {
    setData(Array.from({ length: count }, (_, index) => row({ project_id: `p${index + 1}` })));
    renderReport();
    await screen.findByTestId(`pack-earned-row-p${count}-USD-earned`);
    expect(screen.getAllByTestId(/-USD-earned$/)).toHaveLength(count);
    expect(h.rpc.mock.calls).toEqual([['management_pack_project_totals']]);
  });

  it('AC-EBR-001 renders nothing while the setting is off or the role cannot read work-order money', async () => {
    setData([row()]);
    h.setting = { data: false };
    expect(renderReport().container.textContent).toBe('');
    h.setting = { data: true }; h.role = 'Engineer';
    expect(renderReport().container.textContent).toBe('');
    await waitFor(() => expect(h.rpc).not.toHaveBeenCalled());
  });
});
