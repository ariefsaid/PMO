import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabStrip } from '../TabStrip';
import type { WorkspaceContextValue } from '../WorkspaceTabsProvider';
import type { WorkspaceTab } from '../workspaceTabs';

const tabs: WorkspaceTab[] = [
  { id: 'dashboard', kind: 'module', path: '/', icon: 'grid', label: 'Dashboard', module: 'dashboard' },
  { id: 'sales', kind: 'module', path: '/sales', icon: 'pipe', label: 'Sales', module: 'sales' },
  {
    id: 'projects:PRJ-1',
    kind: 'record',
    path: '/projects/PRJ-1',
    icon: 'folder',
    label: 'Alpha',
    code: 'PRJ-1',
    dirty: true,
    module: 'projects',
  },
];

function makeWs(over: Partial<WorkspaceContextValue> = {}): WorkspaceContextValue {
  return {
    tabs,
    activeId: 'sales',
    openModule: vi.fn(),
    openRecord: vi.fn(),
    closeTab: vi.fn(),
    selectTab: vi.fn(),
    setDirty: vi.fn(),
    ...over,
  };
}

describe('TabStrip', () => {
  it('renders one [role=tab] per tab with aria-selected on the active one', () => {
    render(<TabStrip ws={makeWs()} onOpenPalette={vi.fn()} />);
    const allTabs = screen.getAllByRole('tab');
    expect(allTabs).toHaveLength(3);
    expect(screen.getByRole('tab', { name: /Sales/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the open-palette (+) button', () => {
    const onOpenPalette = vi.fn();
    render(<TabStrip ws={makeWs()} onOpenPalette={onOpenPalette} />);
    const plus = screen.getByRole('button', { name: /command palette/i });
    expect(plus).toBeInTheDocument();
  });

  it('module tabs render NO close button; record tabs do', () => {
    render(<TabStrip ws={makeWs()} onOpenPalette={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Close Dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Alpha' })).toBeInTheDocument();
  });

  it('clicking a tab calls selectTab; clicking close calls closeTab', async () => {
    const ws = makeWs();
    render(<TabStrip ws={ws} onOpenPalette={vi.fn()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Dashboard/ }));
    expect(ws.selectTab).toHaveBeenCalledWith('dashboard');
    await userEvent.click(screen.getByRole('button', { name: 'Close Alpha' }));
    expect(ws.closeTab).toHaveBeenCalledWith('projects:PRJ-1');
  });

  it('ArrowRight moves roving focus to the next tab', async () => {
    render(<TabStrip ws={makeWs({ activeId: 'dashboard' })} onOpenPalette={vi.fn()} />);
    const dash = screen.getByRole('tab', { name: /Dashboard/ });
    dash.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Sales/ })).toHaveFocus();
  });

  it('Enter on a focused tab selects it', async () => {
    const ws = makeWs({ activeId: 'dashboard' });
    render(<TabStrip ws={ws} onOpenPalette={vi.fn()} />);
    const sales = screen.getByRole('tab', { name: /Sales/ });
    sales.focus();
    await userEvent.keyboard('{Enter}');
    expect(ws.selectTab).toHaveBeenCalledWith('sales');
  });

  it('dirty record tab shows the amber dirty dot', () => {
    render(<TabStrip ws={makeWs()} onOpenPalette={vi.fn()} />);
    expect(screen.getByTestId('dirty-projects:PRJ-1')).toBeInTheDocument();
  });
});
