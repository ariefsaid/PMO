import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import BudgetPasteRowsDialog from './BudgetPasteRowsDialog';

const pasteState = vi.hoisted(() => ({
  results: [] as unknown[],
  isSaving: false,
  progress: { completed: 0, total: 0 },
  refreshError: null as string | null,
  validationError: null as string | null,
  save: vi.fn(),
  retryFailed: vi.fn(),
  acknowledgeAndStartNewSession: vi.fn(),
}));

vi.mock('@/src/hooks/useBudgetPasteRows', () => ({ useBudgetPasteRows: () => pasteState }));

beforeEach(() => {
  pasteState.results = [];
  pasteState.isSaving = false;
  pasteState.progress = { completed: 0, total: 0 };
  pasteState.refreshError = null;
  pasteState.validationError = null;
  pasteState.save.mockClear();
  pasteState.retryFailed.mockClear();
  pasteState.acknowledgeAndStartNewSession.mockClear();
});

describe('BudgetPasteRowsDialog controls', () => {
  it('keeps the selected amount mode and changes the preview calculation', async () => {
    const user = userEvent.setup();
    render(
      <FinanceI18nTestProvider>
        <BudgetPasteRowsDialog
          onClose={vi.fn()}
          onDirtyChange={vi.fn()}
          projectId="project-1"
          targetId="draft-1"
          selectedId="draft-1"
          isDraft
          canCreate
          canEdit
          currency="USD"
          versionLabel="Draft"
        />
      </FinanceI18nTestProvider>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Rows pasted from a spreadsheet' }), 'Labor\tInstall\t6\t2\t5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Quantity column' }), '3');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rate column' }), '4');
    const mode = screen.getByRole('combobox', { name: 'Amount mode' });
    await user.selectOptions(mode, 'quantity-rate');

    expect(mode).toHaveValue('quantity-rate');
    expect(within(screen.getByRole('region', { name: 'Preview' })).getByRole('row', { name: /Labor/ })).toHaveTextContent('$10.00');
  });
});
