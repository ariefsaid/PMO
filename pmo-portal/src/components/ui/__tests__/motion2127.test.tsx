// Issue #2127 slice M6: high-frequency surfaces snap. Precedent: motion1970.test.tsx —
// motion slices assert the CSS contract on the touched primitives. Table-row hover is the
// most frequent hover in the app and the sticky end cells already snap via group-hover, so
// the row base must not fade behind them; rail navigation and keyboard-driven view-toggle
// changes are state changes, not entrances — they change state on the same frame.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DataTable, type Column } from '../DataTable';
import { ViewToggle } from '../ViewToggle';
import { Rail } from '../../shell/Rail';

vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Admin' }),
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [], isPending: false }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: { crm: true } }) }));
vi.mock('@/src/lib/features', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...actual };
});

interface Row { id: string; name: string; hours: number }
const rows: Row[] = [{ id: 'r1', name: 'Alpha', hours: 8 }];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Project', stickyLeft: true, size: 200, cell: (r) => r.name },
  { key: 'hours', header: 'Hours', align: 'num', size: 100, cell: (r) => r.hours },
];
const opts = [
  { value: 'table', label: 'Table' },
  { value: 'board', label: 'Board' },
];

describe('#2127 motion: high-frequency surfaces snap', () => {
  it('table-row hover snaps: the body-row class string carries no colour transition', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} tableId="m2127-rows" />);
    const row = screen.getByText('Alpha').closest('tr')!;
    expect(row.className).not.toContain('transition-colors');
    // The sticky first cell must stay instant too (group-hover, no fade of its own).
    const stickyCell = screen.getByText('Alpha').closest('td')!;
    expect(stickyCell.className).not.toContain('transition-colors');
  });

  it('rail active state snaps: no nav item carries a colour transition', () => {
    render(
      <MemoryRouter>
        <Rail />
      </MemoryRouter>,
    );
    const navItems = [...screen.getByRole('complementary').querySelectorAll('a, button')];
    expect(navItems.length).toBeGreaterThan(0);
    for (const el of navItems) expect(el.className).not.toContain('transition-colors');
  });

  it('view-toggle selection snaps: option buttons carry no transition and no duration', () => {
    render(<ViewToggle options={opts} value="table" onChange={() => {}} ariaLabel="View" />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).not.toContain('transition-');
      expect(tab.className).not.toContain('duration-');
    }
  });
});
