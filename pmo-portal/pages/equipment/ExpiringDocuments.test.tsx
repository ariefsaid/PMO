import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const h = vi.hoisted(() => ({ q: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useDocumentExpiry', () => ({ useExpiringDocuments: () => h.q }));

import ExpiringDocumentsPage from './ExpiringDocuments';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1', subject_kind: 'person', subject_id: 'p1', subject_name: 'Person One', type_name: 'Work permit', is_medical: false,
  number: 'WP-1', expires_on: '2026-12-20', days_left: 30, medical_status: null, location_note: 'Site office', ...over,
});
const renderPage = () => render(<MemoryRouter><ExpiringDocumentsPage /></MemoryRouter>);

describe('ExpiringDocumentsPage (AC-DEX-006)', () => {
  beforeEach(() => { h.q = { data: undefined, isPending: false, isError: false, refetch: vi.fn() }; });

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

  it('explains an empty window', () => {
    h.q.data = [];
    renderPage();
    expect(screen.getByText('Nothing expires in the next 30 days')).toBeInTheDocument();
  });

  it('offers retry when the read fails', () => {
    h.q.isError = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
