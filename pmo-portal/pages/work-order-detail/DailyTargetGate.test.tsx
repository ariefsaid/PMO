import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { DailyTargetGate } from './DailyTargetGate';

const s = vi.hoisted(() => ({ enabled: false, canView: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => s.canView }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({ useRevenuePlanSettings: () => ({ data: { enabled: s.enabled, workingWeekdays: [1, 2, 3, 4, 5] } }) }));
vi.mock('./DailyTargetView', () => ({ DailyTargetView: () => <div data-testid="view" /> }));

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{} as AuthContextValue}><DailyTargetGate workOrderId="w" /></AuthContext.Provider></QueryClientProvider>,
);
beforeEach(() => { s.enabled = false; s.canView = true; });

describe('DailyTargetGate (#2672)', () => {
  it('AC-WDT-001 shows nothing while the organisation switch is off (the default)', () => {
    renderIt();
    expect(screen.queryByTestId('view')).toBeNull();
  });
  it('shows the view when the switch is on and the role may view it', () => {
    s.enabled = true;
    renderIt();
    expect(screen.getByTestId('view')).toBeTruthy();
  });
  it('shows nothing for a role that may not view it, and outside the app providers', () => {
    s.enabled = true; s.canView = false;
    renderIt();
    expect(screen.queryByTestId('view')).toBeNull();
    s.canView = true;
    expect(render(<DailyTargetGate workOrderId="w" />).container.firstChild).toBeNull();
  });
});
