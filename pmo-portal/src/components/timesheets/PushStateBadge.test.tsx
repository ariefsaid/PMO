import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axeViolations } from '../__tests__/axe';
import { PushStateBadge } from './PushStateBadge';
import { RAW_ADAPTER_TOKEN } from '@/src/lib/adapterSeam/pushErrorCopy';

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

  // ⚑ I-14/I-15 (rendered Discover pass): the reason is stated as a SENTENCE (never the raw adapter
  // token this test used to assert verbatim), and Retry is offered only for a cause a retry can fix.
  // `external-unreachable` is exactly that: ERPNext was down, nothing else changed.
  it('AC-TSP-051: renders "failed" + the reason, and a Retry affordance gated by canRetry=true', () => {
    const onRetry = vi.fn();
    render(
      <PushStateBadge
        state={{ push_state: 'failed', push_error: 'external-unreachable', ts_number: null }}
        canRetry
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/could not be reached/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('AC-TSP-051: a non-privileged viewer (canRetry=false) sees the failure but NO Retry button', () => {
    render(
      <PushStateBadge
        state={{ push_state: 'failed', push_error: 'external-unreachable', ts_number: null }}
        canRetry={false}
      />,
    );
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ⚑ I-14 / I-15 — the budget surface already gets this contract right for `unstamped-activation`
  // (explain the real route, offer no button that can only fail). This surface did the OPPOSITE for
  // a structurally identical case: it offered Retry for ERP-side configuration a retry can never
  // supply, and printed the adapter's own token to explain it.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe('I-14/I-15 — no raw token, and no button that can only ever fail', () => {
    it.each([
      'employee-unlinked',
      'project-unmapped',
      'activity-type-unconfigured',
      'cross-org-link-rejected',
    ])('%s WITHHOLDS Retry and names what must change first', (push_error) => {
      render(
        <PushStateBadge state={{ push_state: 'failed', push_error, ts_number: null }} canRetry onRetry={() => {}} />,
      );
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
      // ...and it is not a silent withholding: the remedy is stated.
      expect(screen.getByTestId('push-error-remedy')).toBeInTheDocument();
    });

    it.each([
      'employee-unlinked',
      'activity-type-unconfigured: binding config has no default_activity_type',
      'erpnext-activity-type-missing: no Activity Type on the binding',
      'external-unreachable',
    ])('%s never reaches the DOM as a raw adapter token', (push_error) => {
      const { container } = render(
        <PushStateBadge state={{ push_state: 'failed', push_error, ts_number: null }} canRetry onRetry={() => {}} />,
      );
      expect(container.textContent ?? '').not.toMatch(RAW_ADAPTER_TOKEN);
    });

    it('an UNCLASSIFIED code fails OPEN on the affordance — never strand an operator on a new failure class', () => {
      render(
        <PushStateBadge
          state={{ push_state: 'failed', push_error: 'brand-new-failure-class', ts_number: null }}
          canRetry
          onRetry={() => {}}
        />,
      );
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
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
        state={{ push_state: 'failed', push_error: 'external-unreachable', ts_number: null }}
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
        state={{ push_state: 'failed', push_error: 'external-unreachable', ts_number: null }}
        canRetry
        onRetry={() => {}}
      />,
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});
