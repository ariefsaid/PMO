import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { formatDay } from '@/src/lib/format';

const h = vi.hoisted(() => ({ q: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() }, mayEdit: true }));
vi.mock('@/src/hooks/useDocumentExpiry', () => ({
  useExpiringDocuments: () => h.q,
  useSubjectDocuments: () => ({ data: [{ id: 'd1', type_id: 't1', number: 'WP-1', issued_on: null, expires_on: '2026-12-20', location_note: null, medical_status: null, is_medical: false, attachment_path: null }] }),
  useRecordRenewal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDocumentTypes: () => ({ data: [{ id: 't1', name: 'Work permit', is_medical: false }] }),
  useExpiryDocumentMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, archive: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.mayEdit }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/components/ui', async (orig) => ({ ...(await orig<typeof import('@/src/components/ui')>()), useToast: () => ({ toast: vi.fn() }) }));

import ExpiringDocumentsPage from './ExpiringDocuments';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1', subject_kind: 'person', subject_id: 'p1', subject_name: 'Person One', type_name: 'Work permit', is_medical: false,
  number: 'WP-1', expires_on: '2026-12-20', days_left: 30, medical_status: null, location_note: 'Site office', ...over,
});
import { ToastProvider } from '@/src/components/ui';
const renderPage = () => render(<MemoryRouter><ToastProvider><ExpiringDocumentsPage /></ToastProvider></MemoryRouter>);

describe('ExpiringDocumentsPage (AC-DEX-006)', () => {
  beforeEach(() => { h.mayEdit = true; h.q = { data: undefined, isPending: false, isError: false, refetch: vi.fn() }; });

  it('lists what expires, with days left and where the paper is kept', () => {
    h.q.data = [row(), row({ id: 'd2', subject_name: 'Crane One', type_name: 'Equipment certificate', days_left: -3, number: 'EC-1' })];
    renderPage();
    expect(screen.getAllByText('Person One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Site office').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Expired 3 days ago').length).toBeGreaterThan(0);
  });

  it('shows a medical document as a status only, never a number', () => {
    h.q.data = [row({ is_medical: true, medical_status: 'fit', number: null, type_name: 'Medical check' })];
    renderPage();
    expect(screen.getAllByText('Fit').length).toBeGreaterThan(0);
    expect(screen.queryByText('R-99')).toBeNull();
  });

  it('AC-EXM-004 offers "Record renewal" on a person\'s document only (not equipment, not a medical status)', () => {
    h.mayEdit = false; // the direct manager is not an editor: the row offers the renewal date
    h.q.data = [row(), row({ id: 'd2', subject_kind: 'equipment', subject_id: 'a1', subject_name: 'Crane One' }), row({ id: 'd3', subject_name: 'Medic', is_medical: true, medical_status: 'fit', number: null })];
    renderPage();
    expect(screen.getAllByRole('button', { name: 'Record renewal for Person One' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Record renewal for Crane One' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record renewal for Medic' })).toBeNull();
  });

  it('AC-EQM-007 shows the expiry date in the app date style, not as raw 2026-12-20', () => {
    h.q.data = [row()];
    renderPage();
    expect(screen.getAllByText(formatDay('2026-12-20')).length).toBeGreaterThan(0);
    expect(screen.queryByText('2026-12-20')).not.toBeInTheDocument();
  });

  it('AC-EQM-007 each row opens its record and offers a renew action to someone who may edit', async () => {
    h.q.data = [row()];
    renderPage();
    expect(screen.getAllByRole('link', { name: 'Open the record of Person One' })[0]).toHaveAttribute('href', '/equipment/people/p1');
    await userEvent.click(screen.getAllByRole('button', { name: 'Renew Work permit of Person One' })[0]);
    expect(await screen.findByRole('heading', { name: 'Renew document' })).toBeInTheDocument();
  });

  it('AC-EQM-007 a reader who may not edit sees the record link and no renew action', () => {
    h.mayEdit = false;
    h.q.data = [row()];
    renderPage();
    expect(screen.getAllByRole('link', { name: 'Open the record of Person One' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Renew/ })).not.toBeInTheDocument();
  });

  it('explains an empty window', () => {
    h.q.data = [];
    renderPage();
    expect(screen.getByText('Nothing expires in the next 30 days')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('offers retry when the read fails', () => {
    h.q.isError = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
