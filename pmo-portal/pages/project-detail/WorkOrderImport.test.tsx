import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: true,
  currentUserId: 'pm-1',
  projectManagerId: 'pm-1',
  permissions: { workOrder: true, workOrderImport: true },
  listBoq: vi.fn(async () => []),
  listWorkOrders: vi.fn(async () => []),
  listProjectLines: vi.fn(),
  lineReadCount: 0,
  importDescriptor: vi.fn(() => ({ id: 'descriptor' })),
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (_action: string, entity: string, ctx?: { record?: { project_manager_id?: string } }) => {
    if (entity === 'workOrderImport') return state.enabled && state.permissions.workOrderImport && ctx?.record?.project_manager_id === state.currentUserId;
    return state.permissions.workOrder;
  },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: state.currentUserId, org_id: 'org-1' } }) }));
vi.mock('@/src/hooks/useSetupWorkflows', () => ({ useSetupWorkflows: () => ({ enabled: state.enabled }) }));
vi.mock('@/src/hooks/useWorkOrderLists', () => ({ useWorkOrderLists: () => ({ liveAreas: [] }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: {
  progressBilling: { listBoq: state.listBoq },
  workOrder: { list: state.listWorkOrders },
  workOrderAcceptance: { listProjectLines: state.listProjectLines },
} }));
vi.mock('@/src/lib/import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/import')>()),
  makeWorkOrderImportDescriptor: state.importDescriptor,
}));
vi.mock('@/src/components/import', () => ({
  ImportWizard: ({ onClose }: { onClose: (didImport: boolean) => void }) => <button type="button" onClick={() => onClose(true)}>Complete import</button>,
}));

import { WorkOrderImport } from './WorkOrderImport';
import { useProjectWorkOrderLines } from '@/src/hooks/useWorkOrderAcceptances';

const AllocationObserver: React.FC = () => {
  const lines = useProjectWorkOrderLines('p1');
  return <span data-testid="allocation-read">{lines.data?.[0]?.id ?? 'loading'}</span>;
};

function renderImport(withAllocation = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}>{withAllocation && <AllocationObserver />}<WorkOrderImport projectId="p1" currency="USD" projectManagerId={state.projectManagerId} /></QueryClientProvider>);
  return { invalidate };
}

beforeEach(() => {
  state.enabled = true;
  state.currentUserId = 'pm-1';
  state.projectManagerId = 'pm-1';
  state.permissions = { workOrder: true, workOrderImport: true };
  state.listBoq.mockClear();
  state.listWorkOrders.mockClear();
  state.lineReadCount = 0;
  state.listProjectLines.mockReset().mockImplementation(async () => {
    state.lineReadCount += 1;
    return [{ id: state.lineReadCount === 1 ? 'existing-line' : 'imported-line' }];
  });
  state.importDescriptor.mockClear();
});

describe('work-order import gate and refresh (FR-WOI-005)', () => {
  it('AC-WOI-006 hides import while the organisation switch is off', () => {
    state.enabled = false;
    renderImport();
    expect(screen.queryByRole('button', { name: /Import work orders/ })).toBeNull();
    expect(state.listBoq).not.toHaveBeenCalled();
  });

  it('AC-WOI-005 only shows the bulk action to an Admin or the project’s own PM', () => {
    state.projectManagerId = 'pm-other';
    renderImport();
    expect(screen.queryByRole('button', { name: /Import work orders/ })).toBeNull();
  });

  it('AC-WOI-007 a successful import refreshes allocation and billing reads', async () => {
    const { invalidate } = renderImport(true);
    await waitFor(() => expect(screen.getByTestId('allocation-read')).toHaveTextContent('existing-line'));
    fireEvent.click(screen.getByRole('button', { name: /Import work orders/ }));
    await screen.findByRole('button', { name: 'Complete import' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Complete import' })); });
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('allocation-read')).toHaveTextContent('imported-line'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-orders', 'org-1', 'p1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project-drawdown', 'org-1', 'p1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project-billing', 'org-1', 'p1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-order-lines', 'org-1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-order-acceptances', 'org-1', 'p1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['work-order-billing', 'org-1', 'p1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['unbilled-work-orders', 'org-1'] });
  });
});
