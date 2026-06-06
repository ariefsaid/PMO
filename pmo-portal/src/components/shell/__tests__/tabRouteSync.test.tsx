import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import React from 'react';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '../WorkspaceTabsProvider';
import { tabForPath } from '../routeMatch';

describe('tabForPath (URL → tab derivation)', () => {
  it('maps a detail URL to a record tab', () => {
    const t = tabForPath('/projects/PRJ-0142');
    expect(t?.kind).toBe('record');
    expect(t?.id).toBe('projects:PRJ-0142');
    expect(t?.code).toBe('PRJ-0142');
    expect(t?.module).toBe('projects');
  });

  it('maps an index URL to a module tab', () => {
    const t = tabForPath('/sales');
    expect(t?.kind).toBe('module');
    expect(t?.id).toBe('sales');
  });

  it('maps / to the dashboard tab', () => {
    expect(tabForPath('/')?.id).toBe('dashboard');
  });

  it('returns null for an untracked path', () => {
    expect(tabForPath('/reports')).toBeNull();
  });
});

const Probe: React.FC = () => {
  const ws = useWorkspaceTabs();
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="active">{ws.activeId}</span>
      <span data-testid="ids">{ws.tabs.map((t) => t.id).join(',')}</span>
      <span data-testid="path">{loc.pathname}</span>
      <button onClick={() => navigate('/sales')}>go-sales</button>
      <button onClick={() => navigate(-1)}>back</button>
    </div>
  );
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <WorkspaceTabsProvider>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </WorkspaceTabsProvider>
    </MemoryRouter>
  );

describe('useTabRouteSync (URL is the source of truth)', () => {
  beforeEach(() => sessionStorage.clear());

  it('deep-link to a detail route opens + activates a matching record tab', () => {
    renderAt('/projects/PRJ-0142');
    expect(screen.getByTestId('active')).toHaveTextContent('projects:PRJ-0142');
    expect(screen.getByTestId('ids')).toHaveTextContent('projects:PRJ-0142');
  });

  it('navigating to a module URL opens/activates that module tab', async () => {
    renderAt('/');
    await userEvent.click(screen.getByText('go-sales'));
    expect(screen.getByTestId('active')).toHaveTextContent('sales');
    expect(screen.getByTestId('path')).toHaveTextContent('/sales');
  });

  it('browser Back re-syncs the active tab to the previous URL', async () => {
    renderAt('/');
    await userEvent.click(screen.getByText('go-sales'));
    expect(screen.getByTestId('active')).toHaveTextContent('sales');
    await userEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('path')).toHaveTextContent('/');
    expect(screen.getByTestId('active')).toHaveTextContent('dashboard');
  });
});
