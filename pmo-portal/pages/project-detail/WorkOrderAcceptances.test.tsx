import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  const ButtonWithVariant = (props: React.ComponentProps<typeof actual.Button>) => React.createElement(actual.Button, {
    ...props,
    'data-variant': props.variant ?? 'primary',
  });
  return { ...actual, Button: ButtonWithVariant };
});

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

const renderAcceptances = (
  acceptances: WorkOrderAcceptanceWithLines[] = [draft],
  onPrepare = vi.fn(),
  onConfirm = vi.fn(),
) => {
  render(
    <WorkOrderAcceptances
      workOrder={{ id: 'wo-1', status: 'Issued' }}
      boqItems={[]}
      documents={[]}
      acceptances={acceptances}
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
    expect(confirm).toHaveAttribute('data-variant', 'primary');
    expect(prepare).toHaveAttribute('data-variant', 'outline');

    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(draft);
    await user.click(prepare);
    expect(onPrepare).toHaveBeenCalledOnce();
  });

  it('keeps Prepare BAST as the named primary when no draft needs confirmation', () => {
    renderAcceptances([]);

    expect(screen.getByRole('button', { name: 'Prepare BAST' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.queryByRole('button', { name: 'Confirm BAST' })).not.toBeInTheDocument();
  });
});
