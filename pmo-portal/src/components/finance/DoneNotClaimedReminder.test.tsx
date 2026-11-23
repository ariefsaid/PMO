import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  settings: { data: { monthlyTarget: null, targetCurrency: null, reminderOn: false, doneNotClaimedAfterDays: null, monthTargets: [] } as unknown, isError: false, refetch: vi.fn() },
  mutate: vi.fn(),
}));
vi.mock('@/src/hooks/useBillingPlan', () => ({
  useBillingPlanSettings: () => h.settings,
  useSaveDoneNotClaimedReminder: () => ({ mutate: h.mutate, isPending: false, isError: false, error: null }),
}));
import { DoneNotClaimedReminder } from './DoneNotClaimedReminder';

beforeEach(() => { h.mutate.mockReset(); h.settings = { data: { monthlyTarget: null, targetCurrency: null, reminderOn: false, doneNotClaimedAfterDays: null, monthTargets: [] }, isError: false, refetch: vi.fn() }; });
afterEach(cleanup);

// Moved from the plan settings form (#2746): behaviour and defaults are unchanged. The reminder is off until chosen, and no day limit means nothing is flagged.
describe('DoneNotClaimedReminder (AC-DNC-005)', () => {
  it('AC-DNC-005 is off by default', () => {
    render(<DoneNotClaimedReminder />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect((screen.getByRole('button', { name: 'Save reminder' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('AC-DNC-005 the day limit is saved with the reminder; a bad value is refused', () => {
    render(<DoneNotClaimedReminder />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText('Flag after (days)'), { target: { value: '0' } });
    expect(screen.getByText('Enter a whole number of days from 1 to 3650.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save reminder' }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Flag after (days)'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(h.mutate.mock.calls[0][0]).toEqual({ reminderOn: true, afterDays: 14 });
  });

  it('AC-DNC-005 an empty day limit saves as none', () => {
    render(<DoneNotClaimedReminder />);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(h.mutate.mock.calls[0][0]).toEqual({ reminderOn: true, afterDays: null });
  });
});
