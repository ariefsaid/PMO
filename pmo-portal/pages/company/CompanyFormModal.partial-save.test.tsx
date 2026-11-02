import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import type { CompanyRow } from '@/src/lib/db/companies';

import { CompanyFormModal } from './CompanyFormModal';

// A directory row as the DAL returns it; the fixture carries only the fields the form reads.
const company = {
  id: 'c1',
  name: 'Cascade Port Authority',
  short_name: 'Cascade',
  type: 'Client',
  client_number_segment: 'RIS',
  org_id: 'org-1',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
} as unknown as CompanyRow;

const wrap = (ui: React.ReactNode) =>
  render(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompanyFormModal — PGA02-001 partial save reporting', () => {
  it('reports a segment-save failure as PARTIAL success and keeps the modal open', async () => {
    // The company save succeeded; the follow-up client-number segment save failed. The user must
    // learn their company name/type DID change (the old flow reported the whole save as failed,
    // inviting a retry or cancel that misstates what already happened).
    const onUpdate = vi
      .fn<(id: string, input: unknown, segment: string | null) => Promise<{ segmentSaveError: unknown }>>()
      .mockResolvedValue({ segmentSaveError: new AppError('segment write refused', '42501') });
    const onError = vi.fn();

    wrap(
      <CompanyFormModal
        company={company}
        ownership="pmo"
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onError={onError}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    // Persistent, in-dialog partial-success evidence (AC-ERR-001 posture)…
    const note = await screen.findByTestId('company-partial-save');
    expect(note).toHaveTextContent(/saved/i);
    expect(note).toHaveTextContent(/client-number segment/i);
    // …the modal stays open so the failed part can be retried…
    expect(screen.getByRole('button', { name: /^Save company$/i })).toBeInTheDocument();
    // …and the page still receives the segment error for its toast + save_failed telemetry,
    // while the in-dialog note carries the persistent PARTIAL truth.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('closes nothing and reports no partial note when the caller resolves cleanly', async () => {
    // The modal never closes itself — each caller closes from its own create/update callback
    // (matching the extracted-from behavior). Success here = outcome resolved without a
    // segmentSaveError and no partial note left behind.
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    wrap(
      <CompanyFormModal
        company={company}
        ownership="pmo"
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onError={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Save company$/i }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('company-partial-save')).not.toBeInTheDocument();
  });
});
