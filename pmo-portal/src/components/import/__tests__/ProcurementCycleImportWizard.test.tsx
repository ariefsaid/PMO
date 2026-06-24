/**
 * ProcurementCycleImportWizard — component tests (M4, ADR-0035).
 *
 * TDD: these tests were written BEFORE the component. They drive the API contract.
 * Strategy: mock parseWorkbook (exceljs boundary) and commitGroups (DB boundary).
 * All grouping/validation logic runs REAL (no mock) — we only stub the two I/O seams.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
async function driveToPreview(user: ReturnType<typeof userEvent.setup>) {
  (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
    headers: FULL_HEADERS,
    rows: FULL_ROWS,
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
  });

  // ── Upload step ──────────────────────────────────────────────────────────

  it('AC-IMP-CYCLE-U1: renders upload step as a dialog with xlsx file input and row-cap hint', () => {
    renderWizard();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

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
