import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { RevenuePlanGate } from './RevenuePlanGate';

const s = vi.hoisted(() => ({ enabled: false, canView: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => s.canView }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({ useRevenuePlanSettings: () => ({ data: { enabled: s.enabled, workingWeekdays: [1, 2, 3, 4, 5] } }) }));
vi.mock('./RevenuePlanSection', () => ({ RevenuePlanSection: () => <div data-testid="section" /> }));

const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{} as AuthContextValue}>
    <RevenuePlanGate workOrderId="w" woLabel="WO" frozen={false} />
  </AuthContext.Provider></QueryClientProvider>,
);
beforeEach(() => { s.enabled = false; s.canView = true; });

describe('RevenuePlanGate (#2671)', () => {
  it('AC-WRP-001 shows nothing while the organisation switch is off (the default)', () => {
    renderIt();
    expect(screen.queryByTestId('section')).toBeNull();
  });
  it('shows the section when the switch is on and the role may view it', () => {
    s.enabled = true;
    renderIt();
    expect(screen.getByTestId('section')).toBeTruthy();
  });
  it('shows nothing for a role that may not view it, even when on', () => {
    s.enabled = true; s.canView = false;
    renderIt();
    expect(screen.queryByTestId('section')).toBeNull();
  });
  it('shows nothing outside the app providers', () => {
    s.enabled = true;
    expect(render(<RevenuePlanGate workOrderId="w" woLabel="WO" frozen={false} />).container.firstChild).toBeNull();
  });
});
