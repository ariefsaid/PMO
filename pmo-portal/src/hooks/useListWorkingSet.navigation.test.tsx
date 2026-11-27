import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useListWorkingSet } from './useListWorkingSet';
const h = vi.hoisted(() => ({ navigate: vi.fn(), location: { pathname: '/sales', search: '', state: null }, router: { state: { location: { pathname: '/projects' } } } }));
vi.mock('react-router', async (original) => {
  const actual = await original<typeof import('react-router')>();
  return { ...actual, useLocation: () => h.location, useNavigate: () => h.navigate };
});
import { UNSAFE_DataRouterContext } from 'react-router';
function Host() { useListWorkingSet('sales', { sessionView: 'table' }); return null; }
beforeEach(() => { h.navigate.mockClear(); h.router.state.location.pathname = '/projects'; });
it('does not restore a list view after the router has navigated away', () => {
  render(<UNSAFE_DataRouterContext.Provider value={{ router: h.router } as unknown as React.ContextType<typeof UNSAFE_DataRouterContext>}><Host /></UNSAFE_DataRouterContext.Provider>);
  expect(h.navigate).not.toHaveBeenCalled();
});
it('still restores the preferred view while the router remains on the list', () => {
  h.router.state.location.pathname = '/sales';
  render(<UNSAFE_DataRouterContext.Provider value={{ router: h.router } as unknown as React.ContextType<typeof UNSAFE_DataRouterContext>}><Host /></UNSAFE_DataRouterContext.Provider>);
  expect(h.navigate).toHaveBeenCalledWith('/sales?view=table', { replace: true, state: null });
});
