import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ allowed: true, schedule: vi.fn(), release: vi.fn(), cancel: vi.fn(), readError: false, recorded: false, second: false, docError: false, docRetry: vi.fn(), retry: vi.fn() }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [{ id: 'd1', title: 'Handover', status: 'Approved', file_path: 'file' }], isError: h.docError, isPending: false, refetch: h.docRetry }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.allowed }));
vi.mock('@/src/hooks/useBillingStages', () => ({ useRetentionReleases: () => ({
  releases: { data: [{ id: 'r1', amount: 25, dueOn: '2026-03-20', note: null, releasedOn: h.recorded ? '2026-03-20' : null, referenceNo: null, documentId: h.recorded ? 'd1' : null }, ...(h.second ? [{ id: 'r2', amount: 10, dueOn: '2026-04-20', note: null, releasedOn: null, referenceNo: null, documentId: null }] : [])], isPending: false, isError: h.readError, refetch: h.retry },
  schedule: { mutateAsync: h.schedule, isPending: false }, release: { mutateAsync: h.release, isPending: false }, cancel: { mutateAsync: h.cancel, isPending: false },
}) }));
import { RetentionReleases } from '../RetentionReleases';

beforeEach(() => { h.allowed = true; h.readError = false; h.recorded = false; h.second = false; h.docError = false; h.docRetry.mockReset(); h.retry.mockReset(); h.schedule.mockReset().mockResolvedValue('r2'); h.release.mockReset().mockResolvedValue(undefined); h.cancel.mockReset().mockResolvedValue(undefined); });
describe('RetentionReleases', () => {
  it('lets Finance schedule, record and cancel a release', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '10');
    await user.click(screen.getByRole('button', { name: 'Schedule release' }));
    expect(h.schedule).toHaveBeenCalledWith({ claimId: 'c1', amount: 10, dueOn: '2026-03-20', note: null });
    await user.click(screen.getByRole('button', { name: 'Record release' }));
    expect(h.release).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm release' }));
    expect(h.release).toHaveBeenCalledWith({ releaseId: 'r1', releasedOn: '2026-03-20', reference: null, documentId: null });
    await user.click(screen.getByRole('button', { name: 'Cancel release' }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    expect(h.cancel).toHaveBeenCalledWith('r1');
  });
  it('keeps release evidence separate for each scheduled row', async () => {
    h.second = true;
    const user = userEvent.setup();
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    const rows = screen.getAllByRole('listitem');
    await user.type(within(rows[0]).getByRole('textbox', { name: 'Reference (optional)' }), 'REF-1');
    expect(within(rows[1]).getByRole('textbox', { name: 'Reference (optional)' })).toHaveValue('');
    await user.click(within(rows[1]).getByRole('button', { name: 'Record release' }));
    await user.click(screen.getByRole('button', { name: 'Confirm release' }));
    expect(h.release).toHaveBeenCalledWith({ releaseId: 'r2', releasedOn: '2026-03-20', reference: null, documentId: null });
  });
  it('explains when a scheduled amount exceeds the retention', async () => {
    h.schedule.mockRejectedValue({ code: 'retention-exceeded' });
    const user = userEvent.setup();
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '100');
    await user.click(screen.getByRole('button', { name: 'Schedule release' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The scheduled releases exceed the retention held.');
  });
  it('explains when selected proof is no longer eligible', async () => {
    h.release.mockRejectedValue({ code: 'document-not-issued' });
    const user = userEvent.setup();
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'Record release' }));
    await user.click(screen.getByRole('button', { name: 'Confirm release' }));
    expect(await screen.findByText('Choose an issued or approved project document with a file.')).toBeInTheDocument();
  });
  it('links the proof of a recorded release', () => {
    h.recorded = true;
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Handover' })).toHaveAttribute('href', '/projects/p1/documents?open=d1');
    expect(screen.queryByRole('button', { name: 'Cancel release' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record release' })).not.toBeInTheDocument();
  });
  it('does not record without access to proof documents and offers retry', async () => {
    h.docError = true;
    const user = userEvent.setup();
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Record release' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry documents' }));
    expect(h.docRetry).toHaveBeenCalled();
  });
  it('offers retry when releases cannot be read', async () => {
    h.readError = true;
    const user = userEvent.setup();
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Schedule release' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.retry).toHaveBeenCalled();
  });
  it('allows an authorized user to cancel a schedule after withdrawal', () => {
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Cancel release' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Schedule release' })).not.toBeInTheDocument();
  });
  it('hides write actions from users without permission', () => {
    h.allowed = false;
    render(<MemoryRouter><RetentionReleases claimId="c1" projectId="p1" currency="IDR" today="2026-03-20" withdrawn={false} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument();
  });
});
