import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConsentState } from '@/src/lib/analytics';

const analytics = vi.hoisted(() => ({
  analyticsOptOut: vi.fn(),
  analyticsOptIn: vi.fn(),
  getAnalyticsConfig: vi.fn(),
  getConsentState: vi.fn(),
}));
vi.mock('@/src/lib/analytics', () => analytics);

import { AnalyticsOptOutToggle } from './AnalyticsOptOutToggle';

function setState(state: ConsentState) {
  analytics.getConsentState.mockReturnValue(state);
}

beforeEach(() => {
  analytics.analyticsOptOut.mockClear();
  analytics.analyticsOptIn.mockClear();
  analytics.getAnalyticsConfig.mockReturnValue({ enabled: true });
  setState('active');
});

describe('AnalyticsOptOutToggle', () => {
  it('AC-CON-002: reflects the persisted preference on mount', () => {
    setState('opted-out');
    render(<AnalyticsOptOutToggle />);
    expect(screen.getByRole('checkbox', { name: /usage analytics/i })).toBeChecked();
  });

  it('AC-CON-002: checking it opts out', async () => {
    setState('active');
    render(<AnalyticsOptOutToggle />);
    await userEvent.click(screen.getByRole('checkbox', { name: /usage analytics/i }));
    expect(analytics.analyticsOptOut).toHaveBeenCalledTimes(1);
    expect(analytics.analyticsOptIn).not.toHaveBeenCalled();
  });

  it('AC-CON-002: unchecking it opts back in', async () => {
    setState('opted-out');
    render(<AnalyticsOptOutToggle />);
    await userEvent.click(screen.getByRole('checkbox', { name: /usage analytics/i }));
    expect(analytics.analyticsOptIn).toHaveBeenCalledTimes(1);
    expect(analytics.analyticsOptOut).not.toHaveBeenCalled();
  });

  it('AC-CON-010: clicking the VISIBLE LABEL TEXT (not just the 16px box) toggles the control', async () => {
    setState('active');
    render(<AnalyticsOptOutToggle />);
    // Click on the prose, well away from the checkbox box itself.
    await userEvent.click(screen.getByText(/This stops all product-analytics collection/));
    expect(analytics.analyticsOptOut).toHaveBeenCalledTimes(1);
  });

  it('AC-CON-010: clicking the box itself still toggles exactly once (no double-toggle from the row also being clickable)', async () => {
    setState('active');
    render(<AnalyticsOptOutToggle />);
    await userEvent.click(screen.getByRole('checkbox', { name: /usage analytics/i }));
    expect(analytics.analyticsOptOut).toHaveBeenCalledTimes(1);
  });

  it('AC-CON-010: the accessible name is not duplicated by adjacent text — no separate aria-label, one visible source of truth', () => {
    setState('active');
    const { container } = render(<AnalyticsOptOutToggle />);
    const box = screen.getByRole('checkbox', { name: /usage analytics/i });
    expect(box).not.toHaveAttribute('aria-label');
    expect(box).toHaveAttribute('aria-labelledby');
    // The full accessible name text appears exactly once in the DOM (the labelledby target),
    // not once as an aria-label string plus again as separate visible prose.
    const fullText = "Don't send my usage analytics. This stops all product-analytics collection from this browser, including error diagnostics. Your choice is remembered on this device.";
    expect(container.textContent).toContain(fullText);
    // The accessible name equals the visible text (no truncated/duplicated fragment).
    expect(box).toHaveAccessibleName(fullText);
  });

  it('AC-CON-011: when the browser has Do Not Track set, the control shows "not collecting" and explains why, and is not interactive', async () => {
    setState('dnt');
    render(<AnalyticsOptOutToggle />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeChecked();
    expect(box).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/do not track/i)).toBeInTheDocument();
    await userEvent.click(box);
    expect(analytics.analyticsOptOut).not.toHaveBeenCalled();
    expect(analytics.analyticsOptIn).not.toHaveBeenCalled();
  });

  it('AC-CON-011: when analytics is not enabled in this deployment, the control shows "not collecting" and explains why, and is not interactive', async () => {
    setState('disabled');
    render(<AnalyticsOptOutToggle />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeChecked();
    expect(box).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/isn't enabled/i)).toBeInTheDocument();
    await userEvent.click(box);
    expect(analytics.analyticsOptOut).not.toHaveBeenCalled();
    expect(analytics.analyticsOptIn).not.toHaveBeenCalled();
  });
});
