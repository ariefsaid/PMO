import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AwaitingApprovalTile } from './AwaitingApprovalTile';
import { BahasaProvider } from '@/test/bahasa';

// ── Mocked data sources ──────────────────────────────────────────────────────
const procState: { data: unknown[] | undefined; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
const tsState: { data: unknown[] | undefined; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
const roleState: { realRole: string | null } = { realRole: 'Project Manager' };

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ ...procState }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ ...tsState }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: roleState.realRole }),
}));

const renderTile = (includeTimesheets: boolean, locale: 'en' | 'id' = 'en', label?: string) =>
  render(
    <BahasaProvider locale={locale}>
      <MemoryRouter>
        <AwaitingApprovalTile includeTimesheets={includeTimesheets} label={label} />
      </MemoryRouter>
    </BahasaProvider>,
  );

// Three Requested PRs: one raised by me (SoD-excluded), two by others.
const procRows = [
  { id: 'pr1', status: 'Requested', requested_by_id: 'other-1' },
  { id: 'pr2', status: 'Requested', requested_by_id: 'other-2' },
  { id: 'pr3', status: 'Requested', requested_by_id: 'me' }, // own → excluded
  { id: 'pr4', status: 'Approved', requested_by_id: 'other-3' }, // not Requested → excluded
];

beforeEach(() => {
  procState.data = procRows;
  procState.isPending = false;
  procState.isError = false;
  tsState.data = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  tsState.isPending = false;
  tsState.isError = false;
  roleState.realRole = 'Project Manager';
});

describe('AC-IXD-PROC-W5-3: AwaitingApprovalTile honest role-scoped count', () => {
  it('AC-UXA-004: localizes both approval modes across loading, error, zero/one/many and label override states', () => {
    for (const includeTimesheets of [false, true]) {
      cleanup();
      procState.data = []; procState.isPending = true; procState.isError = false;
      tsState.data = []; tsState.isPending = false; tsState.isError = false;
      renderTile(includeTimesheets, 'id');
      expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();

      cleanup();
      procState.data = undefined; procState.isPending = false; procState.isError = true;
      renderTile(includeTimesheets, 'id');
      let tile = screen.getByTestId('kpi-awaiting-approval');
      expect(tile).toHaveTextContent('—');
      expect(tile.textContent).not.toMatch(/\b0\b/);
      expect(within(tile).getByRole('link', { name: 'Menunggu persetujuan Anda: tidak tersedia' })).toHaveAttribute('href', '/approvals');
      expect(tile).toHaveTextContent('Tinjau');

      cleanup();
      procState.data = []; procState.isPending = false; procState.isError = false;
      tsState.data = []; tsState.isError = false;
      renderTile(includeTimesheets, 'id');
      tile = screen.getByTestId('kpi-awaiting-approval');
      expect(tile).toHaveTextContent('Tidak ada yang menunggu');
      expect(within(tile).getByRole('link', { name: 'Menunggu persetujuan Anda: 0 item menunggu' })).toHaveAttribute('href', '/approvals');
      fireEvent.focus(within(tile).getByRole('button', { name: 'Bantuan: Menunggu persetujuan Anda' }));
      expect(screen.getByRole('tooltip')).toHaveTextContent(includeTimesheets
        ? 'Permintaan pengadaan dan timesheet menunggu keputusan Anda. Buka kotak masuk persetujuan.'
        : 'Permintaan pengadaan menunggu keputusan Anda. Buka kotak masuk persetujuan.');

      cleanup();
      procState.data = [{ id: 'one', status: 'Requested', requested_by_id: 'other' }];
      tsState.data = [];
      renderTile(includeTimesheets, 'id');
      tile = screen.getByTestId('kpi-awaiting-approval');
      expect(tile).toHaveTextContent('1 item menunggu');
      expect(within(tile).getByRole('link', { name: 'Menunggu persetujuan Anda: 1 item menunggu' })).toHaveAttribute('href', '/approvals');

      cleanup();
      procState.data = procRows.filter((row) => row.requested_by_id !== 'me');
      tsState.data = [{ id: 't1' }, { id: 't2' }];
      renderTile(includeTimesheets, 'id');
      tile = screen.getByTestId('kpi-awaiting-approval');
      const total = includeTimesheets ? '4' : '2';
      expect(tile).toHaveTextContent(total);
      expect(within(tile).getByRole('link', { name: `Menunggu persetujuan Anda: ${total} item menunggu` })).toHaveAttribute('href', '/approvals');
      expect(tile).toHaveTextContent('Tinjau');

      cleanup();
      procState.data = procRows; procState.isPending = false; procState.isError = false;
      tsState.data = undefined; tsState.isError = true;
      renderTile(includeTimesheets, 'id');
      tile = screen.getByTestId('kpi-awaiting-approval');
      if (includeTimesheets) {
        expect(tile).toHaveTextContent('—');
        expect(within(tile).getByRole('link', { name: 'Menunggu persetujuan Anda: tidak tersedia' })).toHaveAttribute('href', '/approvals');
      } else {
        expect(tile).toHaveTextContent('2');
        expect(tile.textContent).not.toContain('tidak tersedia');
      }
    }

    cleanup();
    procState.data = [{ id: 'one', status: 'Requested', requested_by_id: 'other' }];
    procState.isPending = false; procState.isError = false;
    tsState.data = [{ id: 't1' }, { id: 't2' }]; tsState.isError = false;
    renderTile(true, 'id', 'Persetujuan khusus');
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent('Persetujuan khusus');
    expect(within(tile).getByRole('link', { name: 'Persetujuan khusus: 3 item menunggu' })).toHaveAttribute('href', '/approvals');
  });
  it('PM combined count = approvable PRs (not-self, Requested) + timesheets', () => {
    renderTile(true);
    // 2 approvable PRs + 3 timesheets = 5
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent('5');
  });

  it('Finance count = PRs only (no timesheet approval)', () => {
    roleState.realRole = 'Finance';
    renderTile(false);
    // 2 approvable PRs, timesheets NOT added
    expect(screen.getByTestId('kpi-awaiting-approval')).toHaveTextContent('2');
  });

  it('excludes my own request from the PR count (SoD)', () => {
    tsState.data = [];
    renderTile(false);
    // 2 (pr1, pr2) — pr3 is mine, pr4 is not Requested
    expect(screen.getByTestId('kpi-awaiting-approval')).toHaveTextContent('2');
  });

  it('routes to /approvals as a single link and surfaces a visible Review CTA', () => {
    renderTile(true);
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(within(tile).getByRole('link')).toHaveAttribute('href', '/approvals');
    expect(tile).toHaveTextContent(/Review/i);
  });

  it('a non-approver role (Engineer) contributes zero PRs even if rows exist', () => {
    roleState.realRole = 'Engineer';
    tsState.data = [];
    renderTile(false);
    // Engineer cannot transition procurement → 0
    expect(screen.getByTestId('kpi-awaiting-approval')).toHaveTextContent('0');
  });

  it('zero-state shows 0 and "nothing waiting"', () => {
    procState.data = [];
    tsState.data = [];
    renderTile(true);
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent('0');
    expect(tile).toHaveTextContent(/nothing waiting/i);
  });

  it('pluralizes correctly: 1 item (singular), not 1 items', () => {
    procState.data = [{ id: 'pr1', status: 'Requested', requested_by_id: 'other-1' }];
    tsState.data = [];
    renderTile(false);
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent(/1 item\b/);
    expect(tile.textContent).not.toMatch(/1 items/);
  });

  it('loading shows the KPI skeleton', () => {
    procState.isPending = true;
    procState.data = undefined;
    renderTile(true);
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument();
  });
});

describe('AC-B-0-5: AwaitingApprovalTile surfaces error tone on query failure', () => {
  it('AC-B-0-5: procurement error → shows "—" value, not "0"', () => {
    procState.isError = true;
    procState.data = undefined;
    renderTile(false);
    const tile = screen.getByTestId('kpi-awaiting-approval');
    // Must show "—" (em dash), NOT the false-zero "0"
    expect(tile).toHaveTextContent('—');
    expect(tile.textContent).not.toMatch(/\b0\b/);
  });

  it('AC-B-0-5: procurement error → "unavailable" sub-text (not "nothing waiting")', () => {
    procState.isError = true;
    procState.data = undefined;
    renderTile(false);
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent(/unavailable/i);
    expect(tile.textContent).not.toMatch(/nothing waiting/i);
  });

  it('AC-B-0-5: timesheet error (includeTimesheets=true) → shows "—" value', () => {
    tsState.isError = true;
    tsState.data = undefined;
    renderTile(true);
    const tile = screen.getByTestId('kpi-awaiting-approval');
    expect(tile).toHaveTextContent('—');
    expect(tile.textContent).not.toMatch(/\b0\b/);
  });

  it('AC-B-0-5: no error when only timesheets error but includeTimesheets=false', () => {
    tsState.isError = true;
    tsState.data = undefined;
    // Finance role: includeTimesheets=false — timesheet error is irrelevant
    roleState.realRole = 'Finance';
    renderTile(false);
    const tile = screen.getByTestId('kpi-awaiting-approval');
    // Should show the procCount (2) not error dash
    expect(tile).toHaveTextContent('2');
  });
});
