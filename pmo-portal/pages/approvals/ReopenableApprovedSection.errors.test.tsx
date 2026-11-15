import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => ({ toast: vi.fn(), error: new Error('x') as unknown, mutate: vi.fn() }));

vi.mock('@/src/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/components/ui')>()),
  useToast: () => ({ toast: h.toast }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useReopenableApprovedTimesheets: () => ({
    data: [{ id: 't1', week_start_date: '2026-11-02', owner: { full_name: 'Sam' }, mirror: null, pushCommandState: null }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useTimesheetMutations: () => ({
    reopenApproved: {
      isPending: false,
      mutate: (_id: unknown, opts: { onError: (e: unknown) => void }) => opts.onError(h.error),
    },
    attestNoErpDocument: { mutate: vi.fn(), isPending: false },
  }),
}));

import { ReopenableApprovedSection } from './ReopenableApprovedSection';

const reopen = () => {
  render(<ReopenableApprovedSection hasPending={false} />);
  fireEvent.click(screen.getByRole('button', { name: /re-open for correction/i }));
  // Re-open writes only after the confirm dialog (#2083).
  fireEvent.click(screen.getByRole('button', { name: /re-open week/i }));
};

describe('#2091 ReopenableApprovedSection failure copy', () => {
  it('an unclassified failure gets a next step, not the raw message', () => {
    h.error = new Error('TypeError: Failed to fetch (pg pool exhausted)');
    reopen();
    const text = String(h.toast.mock.calls.at(-1)?.[0]);
    expect(text).toMatch(/could not re-open/i);
    expect(text).toMatch(/try again/i);
    expect(text).not.toMatch(/failed to fetch|pg pool/i);
  });
});
