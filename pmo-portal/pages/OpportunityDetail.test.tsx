import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import OpportunityDetail from './OpportunityDetail';
import { formatCurrency } from '@/src/lib/format';

const pipelineState: {
  data: { stages: unknown[]; projects: Array<Record<string, unknown>> } | undefined;
  isPending: boolean;
  isError: boolean;
} = {
  data: {
    stages: [],
    projects: [
      { id: 'p2', name: 'Northwind ERP Rollout', client_name: 'Northwind', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 },
      { id: 'pw', name: 'Won Deal', client_name: 'Globex', status: 'Won, Pending KoM', contract_value: 2000000, win_probability: 1 },
    ],
  },
  isPending: false,
  isError: false,
};

const oppState: { data: Record<string, unknown> | null | undefined; isPending: boolean } = {
  data: {
    id: 'p2', name: 'Northwind ERP Rollout', code: 'OPP-0042', status: 'Tender Submitted',
    client_id: 'c1', project_manager_id: 'u1', contract_value: 1200000,
    customer_contract_ref: null, contract_date: null, decided_at: null,
    client: { name: 'Northwind' }, pm: { full_name: 'Dana PM' },
  },
  isPending: false,
};

const transitionProject = vi.fn().mockResolvedValue(undefined);
const invalidateQueries = vi.fn();
const openModule = vi.fn();
const openRecord = vi.fn();
const toast = vi.fn();

vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineState }));
vi.mock('@/src/lib/db/opportunity', () => ({ useOpportunity: () => oppState }));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject: (...a: unknown[]) => transitionProject(...a) };
});
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries }) };
});
vi.mock('@/src/components/shell', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useWorkspaceTabs: () => ({ openModule, openRecord, setDirty: vi.fn() }) };
});
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => ({ toast }) };
});

const renderAt = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/sales/${id}`]}>
      <Routes>
        <Route path="/sales/:opportunityId" element={<OpportunityDetail />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  transitionProject.mockClear().mockResolvedValue(undefined);
  invalidateQueries.mockClear();
  openModule.mockClear();
  openRecord.mockClear();
  toast.mockClear();
  pipelineState.isPending = false;
  pipelineState.isError = false;
  oppState.data = {
    id: 'p2', name: 'Northwind ERP Rollout', code: 'OPP-0042', status: 'Tender Submitted',
    client_id: 'c1', project_manager_id: 'u1', contract_value: 1200000,
    customer_contract_ref: null, contract_date: null, decided_at: null,
    client: { name: 'Northwind' }, pm: { full_name: 'Dana PM' },
  };
});

describe('OpportunityDetail (AC-SP-208)', () => {
  it('AC-SP-208 / I7: success render shows the header (no redundant in-page BackBar)', () => {
    renderAt('p2');
    expect(screen.getByRole('heading', { name: /Northwind ERP Rollout/i })).toBeInTheDocument();
    expect(screen.getByText('Tender Submitted')).toBeInTheDocument();
    expect(screen.getAllByText((t) => t.includes(formatCurrency(1200000))).length).toBeGreaterThan(0);
    // I7: the top-bar breadcrumb (Sales Pipeline > record) owns wayfinding —
    // the in-page BackBar is dropped from the success render.
    expect(screen.queryByRole('button', { name: /Back to Sales Pipeline/i })).toBeNull();
  });

  it('G2: an absent Owner reads "Not set" and an absent Decision reads "Pending" (no em-dash)', () => {
    oppState.data = { ...oppState.data!, pm: null, decided_at: null };
    renderAt('p2');
    expect(screen.getByText('Not set')).toBeInTheDocument(); // Owner
    expect(screen.getByText('Pending')).toBeInTheDocument(); // Decision
    // when present, real values still render
    expect(screen.queryByText('—')).toBeNull();
  });

  it('AC-SP-208: the deal-stage journey marks the current stage', () => {
    renderAt('p2');
    const journey = screen.getByLabelText('Deal stage journey');
    expect(journey).toBeInTheDocument();
  });

  it('AC-SP-207: hydrates the synthetic tab label to the human name on mount', () => {
    renderAt('p2');
    expect(openRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sales:p2', label: 'Northwind ERP Rollout' }),
    );
  });

  it('AC-SP-208: an unknown id (after load) shows not-found + BackBar', () => {
    oppState.data = null;
    pipelineState.data = { stages: [], projects: [] };
    renderAt('ghost');
    expect(screen.getByText(/Opportunity not found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back to Sales Pipeline/i })).toBeInTheDocument();
  });

  it('AC-SP-208 / I7: the not-found BackBar navigates back to the sales module', () => {
    // BackBar is retained on the not-found branch (the only escape route there);
    // it still navigates back to the sales module.
    oppState.data = null;
    pipelineState.data = { stages: [], projects: [] };
    renderAt('ghost');
    fireEvent.click(screen.getByRole('button', { name: /Back to Sales Pipeline/i }));
    expect(openModule).toHaveBeenCalledWith('sales');
  });
});

describe('OpportunityDetail win/loss transition (AC-SP-209)', () => {
  it('AC-SP-209: Mark won reveals the inline SoD fields (no modal)', async () => {
    renderAt('p2');
    await userEvent.click(screen.getByRole('button', { name: /Mark won/i }));
    expect(screen.getByLabelText(/Customer contract reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Contract date/i)).toBeInTheDocument();
  });

  it('AC-SP-209: submitting won calls transitionProject with the exact RPC contract', async () => {
    renderAt('p2');
    await userEvent.click(screen.getByRole('button', { name: /Mark won/i }));
    await userEvent.type(screen.getByLabelText(/Customer contract reference/i), 'CPO-2026-7');
    fireEvent.change(screen.getByLabelText(/Contract date/i), { target: { value: '2026-06-01' } });
    await userEvent.click(screen.getByRole('button', { name: /Confirm won/i }));
    await waitFor(() =>
      expect(transitionProject).toHaveBeenCalledWith('p2', 'Won, Pending KoM', {
        customerContractRef: 'CPO-2026-7',
        contractDate: '2026-06-01',
      }),
    );
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('AC-SP-209: a missing required field blocks submit with an inline error', async () => {
    renderAt('p2');
    await userEvent.click(screen.getByRole('button', { name: /Mark won/i }));
    await userEvent.click(screen.getByRole('button', { name: /Confirm won/i }));
    expect(transitionProject).not.toHaveBeenCalled();
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);
  });

  it('AC-SP-209: Mark lost calls transitionProject with Loss Tender', async () => {
    renderAt('p2');
    await userEvent.click(screen.getByRole('button', { name: /Mark lost/i }));
    await waitFor(() => expect(transitionProject).toHaveBeenCalledWith('p2', 'Loss Tender'));
  });

  it('AC-SP-209: a transition RPC error surfaces verbatim inline', async () => {
    transitionProject.mockRejectedValueOnce(new Error('P0001: customer contract ref required'));
    renderAt('p2');
    await userEvent.click(screen.getByRole('button', { name: /Mark lost/i }));
    await waitFor(() =>
      expect(screen.getByText(/P0001: customer contract ref required/)).toBeInTheDocument(),
    );
  });

  it('AC-SP-209: a terminal (won) deal hides Mark won / Mark lost', () => {
    oppState.data = { ...oppState.data!, id: 'pw', name: 'Won Deal', status: 'Won, Pending KoM', contract_value: 2000000 };
    renderAt('pw');
    expect(screen.queryByRole('button', { name: /Mark won/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark lost/i })).toBeNull();
  });
});
