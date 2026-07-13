/**
 * AC-VQ-001 through AC-VQ-007 — VendorQuotesTab (Slice 3)
 * Side-by-side bid comparison refactor of QuotationsSection.
 *
 * AC-VQ-001  empty state teaches "No vendor quotes yet"
 * AC-VQ-002  renders N bid rows with Vendor / Amount / Valid until columns
 * AC-VQ-003  selected row highlighted (bg-success wash) + "Selected · best value" won pill
 * AC-VQ-004  Select button shown only when canSelect=true AND row is not selected
 * AC-VQ-005  Select button absent when canSelect=false (read-only past Quote Selected)
 * AC-VQ-006  clicking Select calls onSelect with the quotation id (confirm → mutation)
 * AC-VQ-007  Add quotation affordance visible when canAdd=true; hidden when false
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const analytics = vi.hoisted(() => ({ trackComingSoonClicked: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({ trackComingSoonClicked: analytics.trackComingSoonClicked }));

// ── FK option hook stubbed (Combobox in the add form calls useVendorOptions)
vi.mock('@/src/hooks/useFkOptions', () => ({
  useVendorOptions: () => ({
    data: [
      { value: 'v-1', label: 'Apex Supply', sub: 'Vendor' },
      { value: 'v-2', label: 'Beta Corp', sub: 'Vendor' },
    ],
  }),
}));

// ── ProcurementFilesSubsection — needs QueryClient; stub for component tests
vi.mock('@/pages/procurement/ProcurementFilesSubsection', () => ({
  ProcurementFilesSubsection: () => null,
}));

import { VendorQuotesTab } from '../procurement/VendorQuotesTab';
import type { Tables } from '@/src/lib/supabase/database.types';

type QuotationRow = Tables<'procurement_quotations'>;

// ── Fixtures ─────────────────────────────────────────────────────────────────
const makeQuote = (overrides: Partial<QuotationRow> = {}): QuotationRow => ({
  id: 'q-1',
  procurement_id: 'proc-1',
  vendor_id: 'v-1',
  total_amount: 148000,
  vq_number: 'VQ-2026-0001',
  is_selected: false,
  reference: 'APX-Q-101',
  received_date: '2026-05-04',
  valid_until: '2026-05-30',
  rfq_id: null,
  file_url: null,
  org_id: 'org-1',
  import_batch_id: null,
  import_key: null,
  imported_at: null,
  ...overrides,
});

const selectedQuote = makeQuote({
  id: 'q-lo',
  vendor_id: 'v-1',
  total_amount: 148000,
  vq_number: 'VQ-2026-0001',
  is_selected: true,
  received_date: '2026-05-04',
  valid_until: '2026-05-30',
});

const unselectedQuote = makeQuote({
  id: 'q-hi',
  vendor_id: 'v-2',
  total_amount: 162000,
  vq_number: 'VQ-2026-0002',
  is_selected: false,
  received_date: '2026-05-05',
  valid_until: '2026-05-28',
});

// Vendor name map for tests (v-1 → Apex Supply, v-2 → Beta Corp)
const testVendorMap: Record<string, string> = {
  'v-1': 'Apex Supply',
  'v-2': 'Beta Corp',
};

const defaultProps = {
  quotations: [],
  selectedId: null as string | null,
  canAdd: false,
  canSelect: false,
  onAdd: vi.fn().mockResolvedValue(undefined),
  onSelect: vi.fn().mockResolvedValue(undefined),
  onError: vi.fn(),
  addBusy: false,
  selectBusy: false,
  procurementId: 'proc-1',
  canManageFiles: false,
  currentUserId: 'u-alice',
  vendorMap: testVendorMap,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
async function confirmInDialog(label: string | RegExp) {
  const dialog = await screen.findByRole('dialog').catch(() => screen.findByRole('alertdialog'));
  await userEvent.click(within(dialog).getByRole('button', { name: label }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AC-VQ-001: VendorQuotesTab — empty state', () => {
  it('AC-VQ-001: renders taught empty state with "No vendor quotes yet" heading', () => {
    render(<VendorQuotesTab {...defaultProps} quotations={[]} />);
    expect(screen.getByText(/No vendor quotes yet/i)).toBeInTheDocument();
    // Teaches the user what to do
    expect(screen.getByText(/quotes are captured/i)).toBeInTheDocument();
  });

  it('AC-VQ-001: empty state still shows Add button when canAdd=true', () => {
    render(<VendorQuotesTab {...defaultProps} quotations={[]} canAdd />);
    expect(screen.getByRole('button', { name: /add quotation/i })).toBeInTheDocument();
  });
});

describe('AC-VQ-002: VendorQuotesTab — bid comparison rows', () => {
  beforeEach(() => {
    defaultProps.onAdd.mockClear();
    defaultProps.onSelect.mockClear();
    defaultProps.onError.mockClear();
  });

  it('AC-VQ-002: renders two bid rows with Amount column data', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
      />,
    );
    // Both rows visible via amount — getAllByText because the component renders
    // both a desktop grid and a mobile dl-card branch (CSS-hidden on the other
    // breakpoint), so each value appears twice in the DOM.
    expect(screen.getAllByText('$148,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('$162,000').length).toBeGreaterThanOrEqual(1);
  });

  it('AC-VQ-002: renders VQ number (vendor ID column proxy)', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
      />,
    );
    expect(screen.getAllByText('VQ-2026-0001').length).toBeGreaterThanOrEqual(1);
  });

  it('AC-VQ-002: renders valid-until date when present', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
      />,
    );
    // formatDate('2026-05-30') → 'May 30, 2026'
    expect(screen.getAllByText('May 30, 2026').length).toBeGreaterThanOrEqual(1);
  });

  it('AC-VQ-002: renders em-dash for null valid_until', () => {
    const q = makeQuote({ valid_until: null });
    render(<VendorQuotesTab {...defaultProps} quotations={[q]} />);
    // em-dash for missing date (both branches may render it)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-VQ-003: VendorQuotesTab — selected row highlight', () => {
  it('AC-VQ-003: selected row has "Selected · best value" pill', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
      />,
    );
    // Both desktop + mobile branches render the pill so ≥1 match is expected
    expect(screen.getAllByText(/Selected · best value/i).length).toBeGreaterThanOrEqual(1);
  });

  it('AC-VQ-003: "Selected · best value" pill present for selected; absent for unselected', () => {
    const { unmount } = render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
        canSelect={false}
      />,
    );
    expect(screen.getAllByText(/Selected · best value/i).length).toBeGreaterThanOrEqual(1);
    unmount();

    // Not-selected quote does NOT have the pill
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[unselectedQuote]}
        selectedId={null}
        canSelect={false}
      />,
    );
    expect(screen.queryByText(/Selected · best value/i)).not.toBeInTheDocument();
  });
});

describe('AC-VQ-004: VendorQuotesTab — Select button gated by canSelect', () => {
  it('AC-VQ-004: Select buttons shown for non-selected rows when canSelect=true', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
        canSelect
      />,
    );
    // Only the UN-selected quote gets a Select button (aria-label "Select quote VQ-…").
    // Each row renders both desktop and mobile branches so there may be 2 buttons
    // for that one unselected quote — but never any button for the selected row.
    const selectBtns = screen.getAllByRole('button', { name: /select quote/i });
    expect(selectBtns.length).toBeGreaterThanOrEqual(1);
    // The selected row (q-lo) must contribute 0 select buttons
    expect(selectBtns.every((btn) => !btn.getAttribute('aria-label')?.includes('VQ-2026-0001'))).toBe(true);
  });

  it('AC-VQ-004: selected row does NOT show a Select button', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
        canSelect
      />,
    );
    // Already selected → no "Select quote" button on that row
    expect(screen.queryByRole('button', { name: /select quote/i })).not.toBeInTheDocument();
  });
});

describe('AC-VQ-005: VendorQuotesTab — read-only when canSelect=false', () => {
  it('AC-VQ-005: no Select buttons when canSelect=false (past Quote Selected)', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
        canSelect={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /select quote/i })).not.toBeInTheDocument();
  });
});

describe('AC-VQ-006: VendorQuotesTab — Select confirm → mutation', () => {
  it('AC-VQ-006: clicking Select opens confirm dialog and calls onSelect on confirm', async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
        canSelect
        onSelect={onSelect}
      />,
    );
    // Click the first "Select quote" button found (desktop or mobile branch)
    const [firstSelectBtn] = screen.getAllByRole('button', { name: /select quote/i });
    await userEvent.click(firstSelectBtn);
    // ConfirmDialog must appear
    await screen.findByRole('dialog');
    await confirmInDialog(/select quote/i);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('q-hi'));
  });

  it('AC-VQ-006: cancelling the confirm does NOT call onSelect', async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
        canSelect
        onSelect={onSelect}
      />,
    );
    const [firstSelectBtn] = screen.getAllByRole('button', { name: /select quote/i });
    await userEvent.click(firstSelectBtn);
    await screen.findByRole('dialog');
    // "Cancel" inside the dialog
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('AC-VQ-007: VendorQuotesTab — Add quotation affordance', () => {
  it('AC-VQ-007: Add quotation button visible when canAdd=true', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
        canAdd
      />,
    );
    expect(screen.getByRole('button', { name: /add quotation/i })).toBeInTheDocument();
  });

  it('AC-VQ-007: Add quotation button absent when canAdd=false', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
        canAdd={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /add quotation/i })).not.toBeInTheDocument();
  });
});

describe('coming_soon_clicked: the "Attach file (coming soon)" affordance (2026-07-13 wiring plan)', () => {
  beforeEach(() => {
    analytics.trackComingSoonClicked.mockClear();
  });

  it('AC: clicking the disabled affordance fires trackComingSoonClicked (demand signal)', async () => {
    render(<VendorQuotesTab {...defaultProps} quotations={[]} canAdd />);
    await userEvent.click(screen.getByRole('button', { name: /add quotation/i }));
    const affordance = screen.getByTitle('File upload coming soon');
    await userEvent.click(affordance);
    expect(analytics.trackComingSoonClicked).toHaveBeenCalledWith(
      'vendor-quote-file-upload',
      'procurement',
    );
  });
});

describe('AC-VQ-008: VendorQuotesTab — vendor name as primary row heading', () => {
  it('AC-VQ-008: renders vendor name as primary text in each bid row when vendorMap provided', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
        vendorMap={testVendorMap}
      />,
    );
    // Apex Supply (v-1) and Beta Corp (v-2) must both appear
    expect(screen.getAllByText('Apex Supply').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Beta Corp').length).toBeGreaterThanOrEqual(1);
  });

  it('AC-VQ-008: falls back to VQ number when vendorMap is absent for that vendor', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
        vendorMap={{}} // empty map — no name for v-1
      />,
    );
    // VQ number shown as fallback primary text
    expect(screen.getAllByText('VQ-2026-0001').length).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-VQ-009: VendorQuotesTab — best-value pill during decision', () => {
  it('AC-VQ-009: shows "Best value" pill on lowest-amount quote when canSelect=true (Vendor Quoted)', () => {
    // q-lo ($148k) is lower than q-hi ($162k) — q-lo should get "Best value"
    const low = makeQuote({ id: 'q-lo', vendor_id: 'v-1', total_amount: 148000, is_selected: false });
    const high = makeQuote({ id: 'q-hi', vendor_id: 'v-2', total_amount: 162000, is_selected: false });
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[low, high]}
        selectedId={null}
        canSelect
        vendorMap={testVendorMap}
      />,
    );
    expect(screen.getAllByText(/best value/i).length).toBeGreaterThanOrEqual(1);
  });

  it('AC-VQ-009: "Best value" pill absent when canSelect=false (not in decision mode)', () => {
    const low = makeQuote({ id: 'q-lo', vendor_id: 'v-1', total_amount: 148000, is_selected: false });
    const high = makeQuote({ id: 'q-hi', vendor_id: 'v-2', total_amount: 162000, is_selected: false });
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[low, high]}
        selectedId={null}
        canSelect={false}
        vendorMap={testVendorMap}
      />,
    );
    // No "Best value" pill when in read-only (past Quote Selected) and no selection
    expect(screen.queryByText(/best value/i)).not.toBeInTheDocument();
  });
});

describe('AC-VQ-010: VendorQuotesTab — valid a11y structure (no broken ARIA grid)', () => {
  it('AC-VQ-010: no role="row" outside a proper table context (avoids aria-required-children violation)', () => {
    const { container } = render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote, unselectedQuote]}
        selectedId="q-lo"
        vendorMap={testVendorMap}
      />,
    );
    // role="row" must not appear outside a role="table"/"grid"/"treegrid" owner
    const rows = container.querySelectorAll('[role="row"]');
    rows.forEach((row) => {
      const owner = row.closest('[role="table"],[role="grid"],[role="treegrid"]');
      expect(owner).not.toBeNull();
    });
  });
});

describe('AC-VQ-M1: VendorQuotesTab — no dev annotation', () => {
  it('AC-VQ-M1: "select-with-rationale" annotation is not visible in the rendered output', () => {
    render(
      <VendorQuotesTab
        {...defaultProps}
        quotations={[selectedQuote]}
        selectedId="q-lo"
      />,
    );
    expect(screen.queryByText(/select-with-rationale/i)).not.toBeInTheDocument();
  });
});
