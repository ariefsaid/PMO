/**
 * StuckRunBanner component tests.
 * AC-AGP-020: stuck-run banner appears on heartbeat staleness, independent of SSE state.
 * AC-AGP-021: Cancel drives the run to a terminal state.
 * NFR-AGP-A11Y-001: role="status" aria-live="polite" announcement.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { StuckRunBanner } from './StuckRunBanner';
import { STUCK_RUN_STALE_MS } from './stuckRun.constants';

const NOW = new Date('2026-07-03T12:00:00.000Z').getTime();

describe('StuckRunBanner', () => {
  it('AC-AGP-020 stuck-run banner on heartbeat staleness', () => {
    // Given: a running run whose last progress signal is older than the threshold.
    const stale = new Date(NOW - STUCK_RUN_STALE_MS - 1_000).toISOString();
    render(
      <StuckRunBanner
        status="running"
        lastProgressAt={stale}
        now={NOW}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const banner = screen.getByRole('status', { name: /taking longer than expected/i });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/this is taking longer than expected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('does not render when lastProgressAt is fresh', () => {
    const fresh = new Date(NOW - 10_000).toISOString();
    render(
      <StuckRunBanner
        status="running"
        lastProgressAt={fresh}
        now={NOW}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('status', { name: /taking longer than expected/i })).not.toBeInTheDocument();
  });

  it('does not render when lastProgressAt is null (no run has progressed yet)', () => {
    render(
      <StuckRunBanner
        status="running"
        lastProgressAt={null}
        now={NOW}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('status', { name: /taking longer than expected/i })).not.toBeInTheDocument();
  });

  it('does not render when the run is already terminal (completed), even if stale', () => {
    const stale = new Date(NOW - STUCK_RUN_STALE_MS - 1_000).toISOString();
    render(
      <StuckRunBanner
        status="completed"
        lastProgressAt={stale}
        now={NOW}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('status', { name: /taking longer than expected/i })).not.toBeInTheDocument();
  });

  it('AC-AGP-021 cancel from stuck-run banner terminal state', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const stale = new Date(NOW - STUCK_RUN_STALE_MS - 1_000).toISOString();
    render(
      <StuckRunBanner
        status="running"
        lastProgressAt={stale}
        now={NOW}
        onRetry={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Retry invokes onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const stale = new Date(NOW - STUCK_RUN_STALE_MS - 1_000).toISOString();
    render(
      <StuckRunBanner
        status="running"
        lastProgressAt={stale}
        now={NOW}
        onRetry={onRetry}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
