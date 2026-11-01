import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';

const rows = [1, 2, 3].map((n) => ({ id: `r${n}`, external_id: String(n), code: `C-${n}`, name: `Item ${n}`, parent_external_id: null, active: true, tombstoned_at: null, attrs: {}, as_of: '' }));
vi.mock('@/src/hooks/useOdoo', () => ({
  useMasterRecordsInfinite: () => ({ data: { pages: [{ rows, total: 9 }] }, isPending: false, isError: false, hasNextPage: true, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() }),
}));
import { OdooItemPicker } from './OdooItemPicker';

afterEach(cleanup);

it('AC-ODC-084 the open picker (rows and Show more) has no axe violations', async () => {
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('combobox'));
  expect(await screen.findByRole('listbox')).toBeInTheDocument();
  expect((await axe(document.body, { rules: { region: { enabled: false } } })).violations).toEqual([]);
});
