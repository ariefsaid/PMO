import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import React from 'react';
import {
  workspaceReducer,
  INITIAL_STATE,
  STORAGE_KEY,
  type WorkspaceTab,
} from '../workspaceTabs';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '../WorkspaceTabsProvider';

const rec = (id: string): WorkspaceTab => ({
  id,
  kind: 'record',
  path: `/projects/${id.split(':')[1]}`,
  icon: 'folder',
  label: id,
  code: id,
  module: 'projects',
});

describe('workspaceReducer (AC: open/refocus/close/dirty/non-closable dashboard)', () => {
  it('starts with a single non-closable dashboard tab', () => {
    expect(INITIAL_STATE.tabs).toHaveLength(1);
    expect(INITIAL_STATE.tabs[0].id).toBe('dashboard');
  });

  it('open adds + activates; opening the same id refocuses (no dup)', () => {
    const sales: WorkspaceTab = {
      id: 'sales',
      kind: 'module',
      path: '/sales',
      icon: 'pipe',
      label: 'Sales',
      module: 'sales',
    };
    let s = workspaceReducer(INITIAL_STATE, { type: 'open', tab: sales });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe('sales');
    s = workspaceReducer(s, { type: 'select', id: 'dashboard' });
    s = workspaceReducer(s, { type: 'open', tab: sales });
    expect(s.tabs).toHaveLength(2); // refocus, not duplicate
    expect(s.activeId).toBe('sales');
  });

  it('close of the active tab activates the previous tab', () => {
    let s = workspaceReducer(INITIAL_STATE, { type: 'open', tab: rec('project:PRJ-1') });
    s = workspaceReducer(s, { type: 'open', tab: rec('project:PRJ-2') });
    expect(s.activeId).toBe('project:PRJ-2');
    s = workspaceReducer(s, { type: 'close', id: 'project:PRJ-2' });
    expect(s.activeId).toBe('project:PRJ-1');
    expect(s.tabs.map((t) => t.id)).toEqual(['dashboard', 'project:PRJ-1']);
  });

  it('the dashboard tab is not closable', () => {
    const s = workspaceReducer(INITIAL_STATE, { type: 'close', id: 'dashboard' });
    expect(s.tabs).toHaveLength(1);
  });

  it('setDirty flips the flag', () => {
    let s = workspaceReducer(INITIAL_STATE, { type: 'open', tab: rec('project:PRJ-1') });
    s = workspaceReducer(s, { type: 'setDirty', id: 'project:PRJ-1', dirty: true });
    expect(s.tabs.find((t) => t.id === 'project:PRJ-1')?.dirty).toBe(true);
  });
});

// ── Provider integration ──────────────────────────────────────────────────
const Probe: React.FC = () => {
  const ws = useWorkspaceTabs();
  const loc = useLocation();
  return (
    <div>
      <span data-testid="active">{ws.activeId}</span>
      <span data-testid="path">{loc.pathname}</span>
      <span data-testid="count">{ws.tabs.length}</span>
      <span data-testid="dirty">{String(ws.tabs.find((t) => t.id === ws.activeId)?.dirty)}</span>
      <button onClick={() => ws.openModule('sales')}>open-sales</button>
      <button onClick={() => ws.openModule('procurement')}>open-proc</button>
      <button onClick={() => ws.openRecord(rec('project:PRJ-9'))}>open-rec</button>
      <button onClick={() => ws.selectTab('dashboard')}>select-dash</button>
      <button onClick={() => ws.closeTab('sales')}>close-sales</button>
      <button onClick={() => ws.setDirty('sales', true)}>dirty-sales</button>
    </div>
  );
};

const renderProvider = (initialPath = '/') =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <WorkspaceTabsProvider>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </WorkspaceTabsProvider>
    </MemoryRouter>
  );

describe('WorkspaceTabsProvider', () => {
  beforeEach(() => sessionStorage.clear());

  it('openModule adds, activates, and navigates', async () => {
    renderProvider('/');
    await userEvent.click(screen.getByText('open-sales'));
    expect(screen.getByTestId('active')).toHaveTextContent('sales');
    expect(screen.getByTestId('path')).toHaveTextContent('/sales');
  });

  it('openRecord opens a record tab and navigates to its path', async () => {
    renderProvider('/');
    await userEvent.click(screen.getByText('open-rec'));
    // URL is source of truth: the sync hook normalizes the id to module-key form.
    expect(screen.getByTestId('active')).toHaveTextContent('projects:PRJ-9');
    expect(screen.getByTestId('path')).toHaveTextContent('/projects/PRJ-9');
  });

  it('persists workspace state to sessionStorage', async () => {
    renderProvider('/');
    await userEvent.click(screen.getByText('open-sales'));
    await act(() => new Promise((r) => setTimeout(r, 200)));
    const raw = sessionStorage.getItem(STORAGE_KEY)!;
    expect(JSON.parse(raw).tabs.some((t: WorkspaceTab) => t.id === 'sales')).toBe(true);
  });

  it('selectTab navigates back to an open tab', async () => {
    renderProvider('/');
    await userEvent.click(screen.getByText('open-sales'));
    expect(screen.getByTestId('path')).toHaveTextContent('/sales');
    await userEvent.click(screen.getByText('select-dash'));
    expect(screen.getByTestId('active')).toHaveTextContent('dashboard');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('closeTab of the active tab activates + navigates to the previous tab', async () => {
    renderProvider('/');
    await userEvent.click(screen.getByText('open-sales'));
    await userEvent.click(screen.getByText('close-sales'));
    expect(screen.getByTestId('active')).toHaveTextContent('dashboard');
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('setDirty flips the active tab dirty flag through the provider', async () => {
    renderProvider('/');
    await userEvent.click(screen.getByText('open-sales'));
    await userEvent.click(screen.getByText('dirty-sales'));
    expect(screen.getByTestId('dirty')).toHaveTextContent('true');
  });

  it('rehydrates persisted tabs on mount (sessionStorage default)', () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tabs: [
          { id: 'dashboard', kind: 'module', path: '/', icon: 'grid', label: 'Dashboard', module: 'dashboard' },
          { id: 'procurement', kind: 'module', path: '/procurement', icon: 'cart', label: 'Procurement', module: 'procurement' },
        ],
        activeId: 'procurement',
      })
    );
    renderProvider('/procurement');
    expect(screen.getByTestId('count')).toHaveTextContent('2');
    expect(screen.getByTestId('active')).toHaveTextContent('procurement');
  });
});
