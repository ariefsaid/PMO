import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const analytics = vi.hoisted(() => ({
  analyticsOptOut: vi.fn(),
  analyticsOptIn: vi.fn(),
  hasAnalyticsOptedOut: vi.fn(() => false),
}));
vi.mock('@/src/lib/analytics', () => analytics);

import { AnalyticsOptOutToggle } from './AnalyticsOptOutToggle';

beforeEach(() => {
  analytics.analyticsOptOut.mockClear();
  analytics.analyticsOptIn.mockClear();
  analytics.hasAnalyticsOptedOut.mockReturnValue(false);
});

describe('AnalyticsOptOutToggle', () => {
  it('AC-CON-002: reflects the persisted preference on mount', () => {
    analytics.hasAnalyticsOptedOut.mockReturnValue(true);
    render(<AnalyticsOptOutToggle />);
    expect(screen.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
  });

  it('AC-CON-002: checking it opts out', async () => {
    render(<AnalyticsOptOutToggle />);
    await userEvent.click(screen.getByRole('checkbox', { name: /usage analytics/i }));
    expect(analytics.analyticsOptOut).toHaveBeenCalledTimes(1);
  });

  it('AC-CON-002: unchecking it opts back in', async () => {
    analytics.hasAnalyticsOptedOut.mockReturnValue(true);
    render(<AnalyticsOptOutToggle />);
    await userEvent.click(screen.getByRole('checkbox', { name: /usage analytics/i }));
    expect(analytics.analyticsOptIn).toHaveBeenCalledTimes(1);
  });
});
