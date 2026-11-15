import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import BudgetLineItemEditor from './BudgetLineItemEditor';

const line = { id: 'li1', category: 'Labor', description: 'Crew', budgeted_amount: 100, fiscal_year: null } as never;

function setup(over: Record<string, unknown> = {}) {
  const props = {
    lineItems: [line],
    currency: 'IDR',
    onCreateLineItem: vi.fn().mockResolvedValue(undefined),
    onDeleteLineItem: vi.fn(),
    onUpdateLineItem: vi.fn().mockResolvedValue(undefined),
    onSaveSuccess: vi.fn(),
    onOpenBuffersChange: vi.fn(),
    onDirtyChange: vi.fn(),
    ...over,
  };
  render(<BudgetLineItemEditor {...(props as unknown as React.ComponentProps<typeof BudgetLineItemEditor>)} />);
  return props;
}

describe('#2081 BudgetLineItemEditor keyboard', () => {
  it('Enter in an edited row saves it; Esc cancels without saving', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: /^edit/i }));
    const desc = screen.getByRole('textbox', { name: /description/i });
    await user.type(desc, ' more{Enter}');
    await waitFor(() => expect(props.onUpdateLineItem).toHaveBeenCalledWith('li1', expect.objectContaining({ description: 'Crew more' })));

    await user.click(screen.getByRole('button', { name: /^edit/i }));
    await user.type(screen.getByRole('textbox', { name: /description/i }), 'zzz{Escape}');
    expect(screen.queryByRole('textbox', { name: /description/i })).not.toBeInTheDocument();
    expect(props.onUpdateLineItem).toHaveBeenCalledTimes(1);
  });

  it('Enter in the add row saves; a bad amount focuses the amount field', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: /add budget line item|add line item/i }));
    const amount = screen.getByLabelText(/line item amount/i);
    await user.type(amount, '1.234{Enter}');
    expect(props.onCreateLineItem).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText(/line item amount/i)).toHaveFocus());
    await user.clear(amount);
    await user.type(amount, '500{Enter}');
    await waitFor(() => expect(props.onCreateLineItem).toHaveBeenCalledTimes(1));
  });

  it('Esc closes an untouched add row', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /add budget line item|add line item/i }));
    screen.getByLabelText(/line item description/i).focus();
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText(/line item amount/i)).not.toBeInTheDocument();
  });
});
