import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import BudgetVersionsDrawer from './BudgetVersionsDrawer';

vi.mock('@/src/components/m365/BudgetDocumentLinks', () => ({ BudgetDocumentLinks: () => null }));

const original = {
  id: 'version-1', version: 1, name: 'Original', status: 'Archived', currency: 'USD', total: 0,
  line_items: [], editor_ids: [],
} as unknown as BudgetVersionWithItems;
const increase = {
  id: 'version-2', version: 2, name: 'Increase', status: 'Active', currency: 'USD', total: 4_500_000,
  line_items: [{ category: 'Labor', description: null, budgeted_amount: 4_500_000 }], editor_ids: [],
} as unknown as BudgetVersionWithItems;

describe('BudgetVersionsDrawer', () => {
  it('R2-P1b #13 renders an increase in neutral text, not as an overrun', async () => {
    const user = userEvent.setup();
    render(
      <BudgetVersionsDrawer
        open
        onClose={() => {}}
        versions={[original, increase]}
        fallbackCurrency="USD"
        canWrite={false}
        hasDraft={false}
        onArchive={() => {}}
        onClone={() => {}}
        onDeleteDraft={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Compare' }));

    const row = screen.getByRole('row', { name: /Labor/ });
    const change = within(row).getByText('+USD 4,500,000');
    expect(change).not.toHaveClass('text-destructive-text');
  });
});
