/**
 * ProcurementCycleImportWizard — component tests (M4, ADR-0035).
 *
 * TDD: these tests were written BEFORE the component. They drive the API contract.
 * Strategy: mock parseWorkbook (exceljs boundary) and commitGroups (DB boundary).
 * All grouping/validation logic runs REAL (no mock) — we only stub the two I/O seams.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ── Mock the two I/O seams ────────────────────────────────────────────────────

// 1. parseWorkbook — exceljs boundary (no real file parsing in unit tests)
vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});
import { parseWorkbook } from '@/src/lib/import';

// 2. commitGroups — DB boundary (never write to DB in unit tests)
vi.mock('@/src/lib/import/procurementCycle/commit', () => ({
  commitGroups: vi.fn(),
}));
import { commitGroups } from '@/src/lib/import/procurementCycle/commit';
vi.mock('@/src/lib/import/procurementCycle/dryRunConflictReport', () => ({ buildDryRunConflictReport: vi.fn() }));
import { buildDryRunConflictReport } from '@/src/lib/import/procurementCycle/dryRunConflictReport';
vi.mock('@/src/lib/db/procurementImportSkip', () => ({ supabaseImportSkipLookup: {}, startProcurementImportRun: vi.fn().mockResolvedValue('server-run') }));
import { startProcurementImportRun } from '@/src/lib/db/procurementImportSkip';

// 3. useOrgCurrency — the preview's org-default currency (FR-L10N-020). Stubbed so the
// wizard doesn't need an AuthProvider/QueryClientProvider in these unit tests. Mutable
// so FR-L10N-020 tests can exercise a non-USD org currency.
const orgCurrencyState = { value: 'USD' };
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => orgCurrencyState.value }));

// ── Now import the component under test ──────────────────────────────────────
import { ProcurementCycleImportWizard } from '../procurementCycle/ProcurementCycleImportWizard';
import { makeRefLookup } from '@/src/lib/import';

// ── Helpers ───────────────────────────────────────────────────────────────────

const projectLookup = makeRefLookup(
  [{ id: 'p1', name: 'Alpha Project' }],
  'Project',
);
const vendorLookup = makeRefLookup(
  [{ id: 'v1', name: 'Acme Vendor' }],
  'Vendor',
);

function renderWizard(overrides?: { onClose?: (didImport: boolean) => void }) {
  const onClose = overrides?.onClose ?? vi.fn();
  render(
    <ProcurementCycleImportWizard
      requestedById="user-1"
      projectLookup={projectLookup}
      vendorLookup={vendorLookup}
      onClose={onClose}
    />,
  );
  return { onClose };
}

const file = () =>
  new File(['x'], 'cycles.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

/**
 * A parsed sheet simulating:
 *   Row 2: case-001 / PR  / Alpha Project / "Widget PR" / (status open) / no vendor / ext-001
 *   Row 3: case-001 / PO  / / / / / ext-002
 *   Row 4: case-001 / VI  / / / / / ext-003  (status Received, date 2024-01-15)
 *   Row 5: case-001 / Payment / / / / / ext-004
 *   Row 6: case-002 / VI  / / "Invoice-only" / / / ext-005  (status Received, date 2024-02-01)
 *   Row 7: case-002 / Payment / / / / / ext-006
 *
 * case-001 = full-ish case (PR→PO→VI→Payment)
 * case-002 = PR-less case (VI→Payment only) — Model-C legal
 *
 * Headers:  case_ref | type | project | title | case_status | vendor | external_ref | status | date | amount
 */
const FULL_HEADERS = [
  'case_ref',
  'type',
  'project',
  'title',
  'case_status',
  'vendor',
  'external_ref',
  'status',
  'date',
  'amount',
];

const FULL_ROWS: string[][] = [
  // case-001 PR
  ['case-001', 'PR', 'Alpha Project', 'Widget PR', 'Draft', '', 'ext-001', '', '', ''],
  // case-001 PO
  ['case-001', 'PO', '', '', '', '', 'ext-002', '', '', ''],
  // case-001 VI
  ['case-001', 'VI', '', '', '', '', 'ext-003', 'Received', '2024-01-15', '5000'],
  // case-001 Payment
  ['case-001', 'Payment', '', '', '', '', 'ext-004', '', '2024-01-20', '5000'],
  // case-002 VI (PR-less)
  ['case-002', 'VI', '', 'Invoice-only', '', '', 'ext-005', 'Received', '2024-02-01', '2000'],
  // case-002 Payment
  ['case-002', 'Payment', '', '', '', '', 'ext-006', '', '2024-02-05', '2000'],
];

/** Drive the wizard to the preview step with our fixture sheet. */
async function driveToPreview(user: ReturnType<typeof userEvent.setup>, rows: string[][] = FULL_ROWS) {
  (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
    headers: FULL_HEADERS,
    rows,
  });

  await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());

  // mapping step: all required columns auto-mapped (case_ref + type) → Next enabled
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: /^next$/i }));

  // wait for preview summary
  await screen.findByTestId('cycle-import-summary');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProcurementCycleImportWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildDryRunConflictReport).mockResolvedValue({ wouldCreate: 1, wouldSkip: 0, wouldCollide: 0 });
    orgCurrencyState.value = 'USD';
  });

  // ── Upload step ──────────────────────────────────────────────────────────

  it('AC-IMP-CYCLE-U1: renders upload step as a dialog with xlsx file input and row-cap hint', () => {
    renderWizard();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const [header, body, footer] = Array.from(dialog.children) as HTMLElement[];
    for (const region of [header, body, footer]) {
      expect(region.className.split(/\s+/)).toContain('px-[var(--space-content-inset)]');
    }
    expect(header.className.split(/\s+/)).toContain('gap-2');
    expect(footer.className.split(/\s+/)).toContain('py-3');

    const input = screen.getByLabelText(/choose an \.xlsx file/i) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toContain('.xlsx');

    // row-cap hint
    expect(within(dialog).getAllByText(/500 rows/i).length).toBeGreaterThan(0);
  });

  it('AC-IMP-CYCLE-U2: a parse rejection stays on upload and shows role="alert"', async () => {
    const { ImportParseError } = await vi.importActual<typeof import('@/src/lib/import')>(
      '@/src/lib/import',
    );
    (parseWorkbook as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ImportParseError('too_many_rows', 'Too many rows: 501.'),
    );

    const user = userEvent.setup();
    renderWizard();

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/too many rows/i);
    // still on upload — no Next button
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
  });

  // ── Mapping step ─────────────────────────────────────────────────────────

  it('AC-IMP-CYCLE-MAP1: mapping step gates Next until case_ref AND type are mapped', async () => {
    // Provide a sheet where auto-map won't auto-resolve (mismatched headers)
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: ['col_a', 'col_b', 'col_c'],
      rows: [['x', 'PR', 'Alpha Project']],
    });

    const user = userEvent.setup();
    renderWizard();

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    // Wait for mapping step
    await screen.findByRole('heading', { name: /match columns/i });

    // Next should be disabled (case_ref + type not mapped)
    expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
  });

  // ── Preview step — grouped tree ──────────────────────────────────────────

  it('AC-IMP-CYCLE-P1: preview renders case/record tree: 2 cases with their records and valid/skipped badges', async () => {
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    // Summary line
    const summary = screen.getByTestId('cycle-import-summary');
    expect(summary).toHaveTextContent('2 cases');

    // case-001 case row
    expect(screen.getByText('case-001')).toBeInTheDocument();
    // case-002 case row
    expect(screen.getByText('case-002')).toBeInTheDocument();

    // At least one "Valid" badge present
    expect(screen.getAllByText(/^valid$/i).length).toBeGreaterThan(0);
  });

  it('AC-IMP-CYCLE-P2: PR-less case (case-002: VI+Payment only) renders as a valid case', async () => {
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    // case-002 heading present
    expect(screen.getByText('case-002')).toBeInTheDocument();

    // The summary should count ≥1 valid case
    const summary = screen.getByTestId('cycle-import-summary');
    // e.g. "2 cases, N records valid, …"
    expect(summary.textContent).toMatch(/valid/i);
  });

  it('AC-IMP-CYCLE-P3: NO write occurs on reaching the preview step (commitGroups not called)', async () => {
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    expect(commitGroups).not.toHaveBeenCalled();
  });

  it('AC-IMP-CYCLE-P4: "Import N records" button is disabled when 0 valid records exist', async () => {
    // Provide a sheet with only invalid rows (bad type + no title/project)
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: FULL_HEADERS,
      rows: [
        // blank case_ref → rowError; case with no valid rows after
        ['case-x', 'BADTYPE', '', '', '', '', '', '', '', ''],
      ],
    });

    const user = userEvent.setup();
    renderWizard();

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    // Wait for preview
    await screen.findByTestId('cycle-import-summary');

    // Import button must be disabled
    const importBtn = screen.getByRole('button', { name: /import/i });
    expect(importBtn).toBeDisabled();
  });

  // ── Committing step ───────────────────────────────────────────────────────

  it('AC-IMP-CYCLE-C1: confirming calls commitGroups once with the right requestedById', async () => {
    (commitGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: 6,
      failed: 0,
      cases: [
        {
          caseRef: 'case-001',
          headerStatus: 'created',
          procurementId: 'proc-1',
          records: [
            { rowNumber: 2, type: 'PR', id: 'r1', status: 'created' },
            { rowNumber: 3, type: 'PO', id: 'r2', status: 'created' },
            { rowNumber: 4, type: 'VI', id: 'r3', status: 'created' },
            { rowNumber: 5, type: 'Payment', id: 'r4', status: 'created' },
          ],
        },
        {
          caseRef: 'case-002',
          headerStatus: 'created',
          procurementId: 'proc-2',
          records: [
            { rowNumber: 6, type: 'VI', id: 'r5', status: 'created' },
            { rowNumber: 7, type: 'Payment', id: 'r6', status: 'created' },
          ],
        },
      ],
    });

    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    // Click the import button
    const importBtn = screen.getByRole('button', { name: /import \d+ record/i });
    expect(importBtn).toBeEnabled();
    await user.click(importBtn);

    await waitFor(() => expect(commitGroups).toHaveBeenCalledTimes(1));

    // First call: second arg must include our requestedById
    const [, opts] = (commitGroups as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      { requestedById: string },
    ];
    expect(opts.requestedById).toBe('user-1');
  });

  // ── Result step ───────────────────────────────────────────────────────────

  it('AC-IMP-CYCLE-R1: result step surfaces created count and onClose(true) on Done', async () => {
    (commitGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: 4,
      failed: 0,
      cases: [
        {
          caseRef: 'case-001',
          headerStatus: 'created',
          procurementId: 'proc-1',
          records: [
            { rowNumber: 2, type: 'PR', id: 'r1', status: 'created' },
            { rowNumber: 3, type: 'PO', id: 'r2', status: 'created' },
            { rowNumber: 4, type: 'VI', id: 'r3', status: 'created' },
            { rowNumber: 5, type: 'Payment', id: 'r4', status: 'created' },
          ],
        },
      ],
    });

    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await driveToPreview(user);

    await user.click(screen.getByRole('button', { name: /import \d+ record/i }));

    // result step
    const resultSummary = await screen.findByTestId('cycle-result-summary');
    expect(resultSummary).toHaveTextContent(/4 created/i);

    await user.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('AC-IMP-CYCLE-R2: result step shows failed-record reasons', async () => {
    (commitGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: 1,
      failed: 1,
      cases: [
        {
          caseRef: 'case-001',
          headerStatus: 'created',
          procurementId: 'proc-1',
          records: [
            { rowNumber: 2, type: 'PR', id: 'r1', status: 'created' },
            { rowNumber: 3, type: 'PO', status: 'failed', error: 'Permission denied: RLS' },
          ],
        },
      ],
    });

    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    await user.click(screen.getByRole('button', { name: /import \d+ record/i }));

    await screen.findByTestId('cycle-result-summary');
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();
  });

  // ── A11y ──────────────────────────────────────────────────────────────────

  it('AC-IMP-CYCLE-A11Y-1: committing step has role="status" aria-live', async () => {
    // make commitGroups hang so we can inspect the committing step
    let resolve!: () => void;
    (commitGroups as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    await user.click(screen.getByRole('button', { name: /import \d+ record/i }));

    // committing step visible
    const status = await screen.findByRole('status');
    expect(status).toBeInTheDocument();

    // cleanup: resolve the promise so no pending state leaks
    resolve();
  });

  // ── A1: font size on ref ─────────────────────────────────────────────────

  it('AC-IMP-CYCLE-FONT1: amount is formatted as currency (not raw string) in preview', async () => {
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);
    // The amount 5000 should display grouped as currency ($5,000.00), not "$5000"
    // There are two amounts in our fixture: 5000 and 2000
    expect(screen.queryByText(/\$5000/)).not.toBeInTheDocument();
    // Multiple elements may match — just confirm at least one "$5,000" is present
    expect(screen.getAllByText(/\$5,000/).length).toBeGreaterThan(0);
  });

  it('FR-L10N-020: preview amounts follow the ORG currency, not a hardcoded USD', async () => {
    orgCurrencyState.value = 'EUR';
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);
    expect(screen.getAllByText(/€5,000/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$5,000/)).not.toBeInTheDocument();
  });

  it('AC-PLC-009: the preview shows the amount the neutral import parse will commit', async () => {
    const rows = FULL_ROWS.map((r) => [...r]);
    rows[2][9] = '1,234.50'; // case-001 VI — grouped: commits 1234.5
    rows[3][9] = '1.234'; // case-001 Payment — three decimals: refused, never committed as 1.23
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user, rows);

    // The grouped amount previews as the value commit will write, not as its raw cell text.
    expect(screen.getAllByText('$1,234.50').length).toBeGreaterThan(0);
    // The refused amount is shown as typed, never as a rounded figure that would not be written.
    expect(screen.queryByText('$1.23')).not.toBeInTheDocument();
    expect(screen.getByText('1.234')).toBeInTheDocument();
    expect(screen.getByText(/amount must be a number with no more than 2 decimal places/i)).toBeInTheDocument();
  });

  // ── D11: committing step shows progress ──────────────────────────────────

  it('AC-IMP-CYCLE-D11: committing step shows case progress "Creating case N of M" with role=status', async () => {
    // Use a slow commitGroups to inspect the committing step text
    let resolveCommit!: (v: unknown) => void;
    (commitGroups as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((r) => { resolveCommit = r; }),
    );

    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);
    await user.click(screen.getByRole('button', { name: /import \d+ record/i }));

    // committing step: role=status aria-live present
    const statusEl = await screen.findByRole('status');
    expect(statusEl).toBeInTheDocument();
    // The text should mention "case" and/or progress context
    expect(statusEl).toHaveTextContent(/case|creating/i);

    resolveCommit({ created: 0, failed: 0, cases: [] });
  });

  // ── D12: group errors visible when collapsed ──────────────────────────────

  it('AC-IMP-CYCLE-D12: group-level errors are visible on the collapsed case header', async () => {
    // Use a sheet with a case that has no title or project (group error) but auto-maps
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: FULL_HEADERS,
      rows: [
        // Case with no title or project — group error
        ['case-err', 'PR', '', '', 'Draft', '', 'ext-e1', '', '', ''],
      ],
    });

    const user = userEvent.setup();
    renderWizard();
    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    await waitFor(() => expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await screen.findByTestId('cycle-import-summary');

    // The case-err row should be collapsed initially or have errors visible on header
    // Error about missing title/project should be visible in the header area
    expect(screen.getByText(/title|project/i)).toBeInTheDocument();
  });

  // ── D13: result step has doc attachment note ──────────────────────────────

  it('AC-IMP-CYCLE-D13: result step shows doc-attachment note on success', async () => {
    (commitGroups as ReturnType<typeof vi.fn>).mockResolvedValue({
      created: 2,
      failed: 0,
      cases: [
        {
          caseRef: 'case-001',
          headerStatus: 'created',
          procurementId: 'proc-1',
          records: [
            { rowNumber: 2, type: 'VI', id: 'r1', status: 'created' },
            { rowNumber: 3, type: 'Payment', id: 'r2', status: 'created' },
          ],
        },
      ],
    });

    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);
    await user.click(screen.getByRole('button', { name: /import \d+ record/i }));
    await screen.findByTestId('cycle-result-summary');

    // Note about attaching documents from the detail page
    expect(screen.getByText(/documents.*attach|attach.*documents/i)).toBeInTheDocument();
  });

  // ── D14: expand all / collapse all ────────────────────────────────────────

  it('AC-IMP-CYCLE-D14: "Collapse all" button collapses all cases; "Expand all" re-expands them', async () => {
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    // Expand/Collapse all button must be present
    const collapseBtn = screen.getByRole('button', { name: /collapse all/i });
    expect(collapseBtn).toBeInTheDocument();

    // Initially expanded: record rows are visible (ext-001 etc.)
    expect(screen.getByText('PR')).toBeInTheDocument();

    // Collapse all
    await user.click(collapseBtn);

    // After collapse: record rows for case-001 should not be visible
    expect(screen.queryByText('PR')).not.toBeInTheDocument();

    // Expand all button now
    const expandBtn = screen.getByRole('button', { name: /expand all/i });
    await user.click(expandBtn);
    expect(screen.getByText('PR')).toBeInTheDocument();
  });

  it('allows an individual case to expand after collapsing all cases', async () => {
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);
    await user.click(screen.getByRole('button', { name: /collapse all/i }));
    await user.click(screen.getByRole('button', { name: /case-001/i }));
    expect(screen.getByText('PR')).toBeInTheDocument();
  });

  // ── E15: button label rename ──────────────────────────────────────────────

  // ── ESC / scrim ───────────────────────────────────────────────────────────

  it('ESC closes the wizard on upload step with onClose(false)', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('clicking the scrim closes the wizard with onClose(false)', async () => {
    const user = userEvent.setup();
    const { onClose } = renderWizard();
    await user.click(screen.getByTestId('cycle-import-scrim'));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  // ── Back navigation ──────────────────────────────────────────────────────

  it('Back from preview returns to mapping; Back from mapping returns to upload', async () => {
    const user = userEvent.setup();
    renderWizard();
    await driveToPreview(user);

    // on preview → Back → mapping
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(await screen.findByRole('heading', { name: /match columns/i })).toBeInTheDocument();

    // Back → upload
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByLabelText(/choose an \.xlsx file/i)).toBeInTheDocument();
  });
});

it('shows reconciliation details from preview', async () => {
  vi.mocked(buildDryRunConflictReport).mockResolvedValue({ wouldCreate: 0, wouldSkip: 0, wouldCollide: 1, conflicts: [{ caseRef: 'case-001', rowNumber: 2, type: 'PR', id: 'existing-id', message: 'Existing source requires reconciliation.' }] });
  const user = userEvent.setup();
  renderWizard();
  await driveToPreview(user);
  expect(await screen.findByText(/existing source requires reconciliation/i)).toBeInTheDocument();
  expect(screen.getByText(/existing-id/)).toBeInTheDocument();
});

it('shows preview failure and enables import only after retry succeeds', async () => {
  const user = userEvent.setup();
  renderWizard();
  vi.mocked(parseWorkbook).mockResolvedValue({ headers: FULL_HEADERS, rows: FULL_ROWS } as never);
  vi.mocked(buildDryRunConflictReport).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ wouldCreate: 3, wouldSkip: 1, wouldCollide: 0 });
  await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
  await user.click(await screen.findByRole('button', { name: /^next$/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/retry/i);
  expect(screen.getByRole('button', { name: /import \d+ record/i })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: /retry preview/i }));
  expect(await screen.findByText(/3 to create, 1 to skip, 0 conflicts/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /import \d+ record/i })).toBeEnabled();
});


it.each(['registration', 'success', 'failure'] as const)('recovers in the mounted wizard when references refresh during %s', async phase => {
  let resolveRun!: (id: string) => void;
  let resolveWrite!: (result: { created: number; failed: number; cases: [] }) => void;
  let rejectWrite!: (error: Error) => void;
  vi.mocked(startProcurementImportRun).mockReset().mockResolvedValue('server-run');
  vi.mocked(buildDryRunConflictReport).mockReset().mockResolvedValue({ wouldCreate: 1, wouldSkip: 0, wouldCollide: 0 });
  if (phase === 'registration') vi.mocked(startProcurementImportRun).mockImplementationOnce(() => new Promise(resolve => { resolveRun = resolve; }));
  else vi.mocked(commitGroups).mockImplementationOnce(() => new Promise((resolve, reject) => { resolveWrite = resolve; rejectWrite = reject; }));
  const user = userEvent.setup();
  const onClose = vi.fn();
  const parent = (reference: typeof projectLookup) => <ProcurementCycleImportWizard requestedById="user-1" projectLookup={reference} vendorLookup={vendorLookup} onClose={onClose} />;
  const { rerender } = render(parent(projectLookup));
  await driveToPreview(user, [FULL_ROWS[0]]);
  await waitFor(() => expect(screen.getByRole('button', { name: /import 1 record/i })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /import 1 record/i }));
  if (phase !== 'registration') await waitFor(() => expect(commitGroups).toHaveBeenCalled());
  rerender(parent(makeRefLookup([{ id: 'p1', name: 'Alpha Project' }], 'Project')));
  await act(async () => {
    if (phase === 'registration') resolveRun('server-run');
    else if (phase === 'success') resolveWrite({ created: 1, failed: 0, cases: [] });
    else rejectWrite(new Error('failed'));
  });
  if (phase === 'success') expect(await screen.findByText('Import complete')).toBeInTheDocument();
  else {
    expect(await screen.findByRole('button', { name: /retry preview/i })).toBeInTheDocument();
    if (phase === 'registration') expect(commitGroups).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /retry preview/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /import 1 record/i })).toBeEnabled());
  }
});

it.each(['success', 'failure'] as const)('offers retry when a refreshed pending preview returns stale %s', async outcome => {
  let resolveReport!: (result: { wouldCreate: number; wouldSkip: number; wouldCollide: number }) => void;
  let rejectReport!: (error: Error) => void;
  vi.mocked(buildDryRunConflictReport).mockReset()
    .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ wouldCreate: 1, wouldSkip: 0, wouldCollide: 0 });
  const user = userEvent.setup();
  const parent = (reference: typeof projectLookup) => <ProcurementCycleImportWizard requestedById="user-1" projectLookup={reference} vendorLookup={vendorLookup} onClose={vi.fn()} />;
  const { rerender } = render(parent(projectLookup));
  await driveToPreview(user, [FULL_ROWS[0]]);
  rerender(parent(makeRefLookup([{ id: 'p1', name: 'Alpha Project' }], 'Project')));
  await act(async () => { if (outcome === 'success') resolveReport({ wouldCreate: 99, wouldSkip: 0, wouldCollide: 0 }); else rejectReport(new Error('stale')); });
  expect(screen.queryByText(/99 to create/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry preview/i }));
  expect(await screen.findByText(/preview could not be completed/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /retry preview/i }));
  expect(await screen.findByText(/1 to create/)).toBeInTheDocument();
});
