import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * AC-SETUP-001: winning a project on a connected org links or creates its ERP Project. "Mark won"
 * on the pipeline record is the primary win path, so it must run the same ERP synchronisation as
 * the status control — and a native win must stay successful when ERP linking needs a retry.
 */
const { transitionProject, synchronizeErpProject } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
  synchronizeErpProject: vi.fn(),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject };
});
vi.mock('@/src/lib/repositories/projectErpSetup', () => ({ synchronizeErpProject }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] } }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import PipelineLens from '../PipelineLens';

const dealRow = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: 1200000,
  currency: 'USD',
  budget: 0,
  spent: 0,
  start_date: null,
  end_date: null,
  contract_date: null,
  decided_at: null,
  customer_contract_ref: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

async function markWon() {
  render(
    <ImpersonationProvider realRole="Project Manager">
      <ToastProvider>
        <PipelineLens project={dealRow} />
      </ToastProvider>
    </ImpersonationProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: /Mark won/i }));
  await userEvent.type(screen.getByLabelText(/Customer contract reference/i), 'CPO-1');
  await userEvent.type(screen.getByLabelText(/Contract date/i), '2026-03-01');
  await userEvent.click(screen.getByRole('button', { name: /Confirm won/i }));
}

beforeEach(() => {
  transitionProject.mockClear();
  synchronizeErpProject.mockReset();
});

describe('PipelineLens mark-won links the ERP Project (AC-SETUP-001)', () => {
  it('AC-SETUP-001 a successful win synchronises that project with ERPNext', async () => {
    synchronizeErpProject.mockResolvedValue('linked');
    await markWon();
    await waitFor(() => expect(synchronizeErpProject).toHaveBeenCalledWith('d1', 'org-1'));
  });
  it('AC-SETUP-001 a win stays successful and says ERP linking needs a retry when it fails', async () => {
    synchronizeErpProject.mockResolvedValue('pending');
    await markWon();
    expect(await screen.findByText(/ERP linking needs attention/i)).toBeInTheDocument();
    expect(transitionProject).toHaveBeenCalledTimes(1);
  });
});
