import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemPicker } from './ItemPicker';

const h = vi.hoisted(() => ({
  items: { data: [] as unknown[], error: null as unknown },
}));

vi.mock('@/src/hooks/useStock', () => ({ useStockItems: () => h.items }));

describe('ItemPicker empty state', () => {
  beforeEach(() => {
    h.items = { data: [], error: null };
  });

  it('tells the user why no item can be selected and where to add one', async () => {
    const user = userEvent.setup();
    render(<ItemPicker label="Stock item" value={null} onChange={() => {}} />);

    await user.click(screen.getByRole('combobox', { name: 'Stock item' }));

    expect(await screen.findByText('No stock items yet: add one in Stock setup.')).toBeInTheDocument();
  });
});
