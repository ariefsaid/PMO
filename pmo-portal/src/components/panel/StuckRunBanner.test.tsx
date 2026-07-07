/**
 * StuckRunBanner component tests.
 * AC-AGP-020: stuck-run banner appears on heartbeat staleness, independent of SSE state.
 * AC-AGP-021: Cancel drives the run to a terminal state.
 * NFR-AGP-A11Y-001: role="status" aria-live="polite" announcement.
 *
 * Copy posture (reassuring long-run): the banner reads as "Still working…" reassurance,
 * not alarm. With doneCount>0 it frames the wait as "a bigger question, N steps done so
 * far" and offers Stop (primary) + Retry (secondary).
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

    const banner = screen.getByRole('status', { name: /still working/i });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/still working/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows the reassuring body with doneCount + lastActivity when progress is available', () => {
    const stale = new Date(NOW - STUCK_RUN_STALE_MS - 1_000).toISOString();
    render(
      <StuckRunBanner
        status="running"
        lastProgressAt={stale}
        now={NOW}
        doneCount={3}
        lastActivity="Checking your projects"
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/bigger question/i)).toBeInTheDocument();
    expect(screen.getByText(/3 steps done so far/i)).toBeInTheDocument();
    expect(screen.getByText(/last: Checking your projects/i)).toBeInTheDocument();
  });

  it('uses the singular "step" when doneCount is 1', () => {
    const stale = new Date(NOW - STUCK_RUN_STALE_MS - 1_000).toISOString();
    render(
      <StuckRunBanner
        status="running"
        lastProgressAt={stale}
        now={NOW}
        doneCount={1}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 step done so far/i)).toBeInTheDocument();
    // Omit lastActivity → no "(last: …)" clause.
    expect(screen.queryByText(/last:/i)).not.toBeInTheDocument();
  });

  it('falls back to the generic line when doneCount is 0 / omitted', () => {
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

    expect(screen.getByText(/hasn.t made progress in a while/i)).toBeInTheDocument();
    expect(screen.queryByText(/bigger question/i)).not.toBeInTheDocument();
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
    expect(screen.queryByRole('status', { name: /still working/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('status', { name: /still working/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('status', { name: /still working/i })).not.toBeInTheDocument();
  });

  it('AC-AGP-021 Stop (primary) from stuck-run banner terminal state', async () => {
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

    await user.click(screen.getByRole('button', { name: /^stop$/i }));
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
