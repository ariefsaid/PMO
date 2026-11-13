import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));

import WorkOrderAcceptances from './WorkOrderAcceptances';

const draft = {
  id: 'acceptance-1',
  acceptance_date: '2026-11-13',
  prepared_at: '2026-11-13T00:00:00.000Z',
  prepared_by: 'u-pm',
  status: 'Draft',
  is_final: false,
  document_id: null,
  note: null,
  lines: [],
} as unknown as WorkOrderAcceptanceWithLines;

const renderAcceptances = (onPrepare = vi.fn(), onConfirm = vi.fn()) => {
  render(
    <WorkOrderAcceptances
      workOrder={{ id: 'wo-1', status: 'Issued' }}
      boqItems={[]}
      documents={[]}
      acceptances={[draft]}
      state="ready"
      onRetry={vi.fn()}
      currentUserId="u-finance"
      projectManagerId="u-pm"
      hasAllocations
      onPrepare={onPrepare}
      onEdit={vi.fn()}
      onWithdraw={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return { onPrepare, onConfirm };
};

describe('WorkOrderAcceptances C21 primary actions', () => {
  it('keeps Confirm BAST and Prepare BAST available and each starts its existing action', async () => {
    const user = userEvent.setup();
    const { onPrepare, onConfirm } = renderAcceptances();

    const confirm = screen.getByRole('button', { name: 'Confirm BAST' });
    const prepare = screen.getByRole('button', { name: 'Prepare BAST' });
    expect(confirm).toBeInTheDocument();
    expect(prepare).toBeInTheDocument();

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(draft);
    await user.click(prepare);
    expect(onPrepare).toHaveBeenCalledOnce();
  });
});
