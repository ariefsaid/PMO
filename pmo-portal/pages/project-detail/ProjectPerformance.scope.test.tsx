import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import { ProjectMoneyScopeContext } from '@/src/hooks/useProjectMoneyScope';
import { ProjectPerformance } from './ProjectPerformance';
const h = vi.hoisted(() => ({ read: vi.fn(() => ({ isPending: true })) }));
vi.mock('@/src/components/performance/PerformanceGate', () => ({ PerformanceGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/src/hooks/useWorkOrderPerformance', () => ({ useProjectPerformance: h.read }));
beforeEach(() => h.read.mockClear());
it('AC-PS1-002 leaves performance absent for a project outside the manager money scope', () => {
  render(<ProjectMoneyScopeContext.Provider value={false}><ProjectPerformance projectId="other" /></ProjectMoneyScopeContext.Provider>);
  expect(h.read).not.toHaveBeenCalled();
  expect(screen.queryByTestId('project-performance')).not.toBeInTheDocument();
});
it('continues to read performance for a project inside the money scope', () => {
  render(<ProjectMoneyScopeContext.Provider value={true}><ProjectPerformance projectId="own" /></ProjectMoneyScopeContext.Provider>);
  expect(h.read).toHaveBeenCalledWith('own', true);
  expect(screen.getByTestId('project-performance')).toBeInTheDocument();
});
