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
  it.each([0.01, -0.01, 0.001])('shows a non-zero fractional version total and comparison change (%s)', async (amount) => {
    const user = userEvent.setup();
    const fractional = { ...increase, total: amount, line_items: [{ ...increase.line_items[0], budgeted_amount: amount }] };
    render(<BudgetVersionsDrawer open onClose={() => {}} versions={[original, fractional]} fallbackCurrency="USD" canWrite={false} hasDraft={false} onArchive={() => {}} onClone={() => {}} onDeleteDraft={() => {}} />);
    expect(screen.getByRole('list', { name: 'Budget versions' })).toHaveTextContent(`USD ${amount}`);
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    const cells = within(screen.getByRole('row', { name: /Labor/ })).getAllByRole('cell');
    expect(cells[cells.length - 1]).toHaveTextContent(`${amount > 0 ? '+' : ''}USD ${amount}`);
  });

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

  it('changing Version A keeps the selected value and updates the comparison', async () => {
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
    expect(screen.getByRole('row', { name: /Labor/ })).toHaveTextContent('+USD 4,500,000');

    const versionA = screen.getByRole('combobox', { name: 'Version A' });
    await user.selectOptions(versionA, 'version-2');

    expect(versionA).toHaveValue('version-2');
    expect(screen.getByRole('row', { name: /Labor/ })).toHaveTextContent('-USD 4,500,000');
  });
});
