import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestFloatChoices: () => ({ data: [] }) }));

import { ExpenseClaimFormModal } from './ExpenseClaimFormModal';

const OK = { isPending: false, isError: false, refetch: vi.fn() };

describe('#2080 closing the claim form while the receipt recovery is pending', () => {
  it('Close does not vanish silently: the dialog stays and says why', () => {
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <ExpenseClaimFormModal kind="claim" projectOptions={[]} advanceOptions={[]} advanceLoad={OK} projectLoad={OK}
          captureRecovery={{ claimId: 'c1', draftSaved: true, phase: 'attachment', attachment: null }}
          onClose={onClose} onSubmit={vi.fn()} />
      </ToastProvider>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/finish the receipt or open the saved draft/i);
  });
});
