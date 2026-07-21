import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axeViolations } from '../__tests__/axe';
import { PushStateBadge } from './PushStateBadge';

/**
 * P3b (FR-TSP-085, FR-TSP-173) — the ERP push-state operator surface. Renders one of the four
 * `timesheet_erp_mirror.push_state` values, or NOTHING when no mirror row exists (an unflipped org, or
 * a sheet that hasn't reached the push path — the badge is supplementary and its absence must never
 * block/gate the page's render).
 */
describe('PushStateBadge', () => {
  it('FR-TSP-173: renders nothing when state is null (no mirror row — never an error state)', () => {
    const { container } = render(<PushStateBadge state={null} canRetry={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders "pending" quietly, with no Retry affordance', () => {
    render(
      <PushStateBadge
        state={{ push_state: 'pending', push_error: null, ts_number: null }}
        canRetry
      />,
    );
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('renders "pushing", with no Retry affordance (a push is already in flight)', () => {
    render(
      <PushStateBadge
        state={{ push_state: 'pushing', push_error: null, ts_number: null }}
        canRetry
      />,
    );
    expect(screen.getByText(/pushing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('renders "pushed" with the ERP ts_number, no Retry affordance', () => {
    render(
      <PushStateBadge
        state={{ push_state: 'pushed', push_error: null, ts_number: 'TS-2026-00042' }}
        canRetry
      />,
    );
    expect(screen.getByText(/pushed/i)).toBeInTheDocument();
    expect(screen.getByText(/TS-2026-00042/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('AC-TSP-051: renders "failed" + the reason, and a Retry affordance gated by canRetry=true', () => {
    const onRetry = vi.fn();
    render(
      <PushStateBadge
        state={{ push_state: 'failed', push_error: 'employee-unlinked', ts_number: null }}
        canRetry
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/employee-unlinked/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('AC-TSP-051: a non-privileged viewer (canRetry=false) sees the failure but NO Retry button', () => {
    render(
      <PushStateBadge
        state={{ push_state: 'failed', push_error: 'employee-unlinked', ts_number: null }}
        canRetry={false}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('renders "held" + the reason, with a Retry affordance when canRetry', () => {
    const onRetry = vi.fn();
    render(
      <PushStateBadge
        state={{ push_state: 'held', push_error: 'daily-hours-exceed-24', ts_number: null }}
        canRetry
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/held/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows the retry button in a loading state while a retry is in flight', () => {
    render(
      <PushStateBadge
        state={{ push_state: 'failed', push_error: 'employee-unlinked', ts_number: null }}
        canRetry
        onRetry={() => {}}
        retryLoading
      />,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeDisabled();
  });

  it('a11y: the failed state + Retry affordance has no critical/serious axe violations', async () => {
    const { container } = render(
      <PushStateBadge
        state={{ push_state: 'failed', push_error: 'employee-unlinked', ts_number: null }}
        canRetry
        onRetry={() => {}}
      />,
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});
