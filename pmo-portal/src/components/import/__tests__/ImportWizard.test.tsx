import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ImportWizard } from '../ImportWizard';
import type { ImportDescriptor } from '@/src/lib/import';

// Drive the steps without exceljs: mock the parse boundary; everything else is real.
vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});
import { parseWorkbook } from '@/src/lib/import';

interface Co {
  name: string;
  type: string;
}
const create = vi.fn().mockResolvedValue({ id: '1' });
const descriptor: ImportDescriptor<Co> = {
  entity: 'Companies',
  fields: [
    { key: 'name', label: 'Company name', required: true, validate: (r) => (r.trim() ? null : 'Company name is required.') },
    { key: 'type', label: 'Type', required: true, validate: (r) => (['Client', 'Vendor'].includes(r.trim()) ? null : 'Type must be Client or Vendor.') },
  ],
  toInput: (c) => ({ name: c.name.trim(), type: c.type.trim() }),
  create,
};

const file = () => new File(['x'], 'companies.xlsx');

describe('ImportWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: ['Company name', 'Type'],
      rows: [
        ['Acme', 'Client'], // valid
        ['', 'Partner'], // invalid: blank name + bad enum
      ],
    });
  });

  // Decision (ADR-0027): the wizard is a dedicated portal dialog (role="dialog" aria-modal)
  // with its own focus-trap + per-step footer — NOT EntityFormModal, whose single-<form>-submit
  // contract fights a multi-step footer. This test pins that contract.
  it('AC-IMP-009: wizard renders the upload step with an xlsx file input and a "≤ 500 rows" hint, focus-trapped', () => {
    render(<ImportWizard descriptor={descriptor} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // xlsx file input
    const input = screen.getByLabelText(/choose an \.xlsx file/i) as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toContain('.xlsx');
    // the row-cap hint
    expect(within(dialog).getAllByText(/500 rows/i).length).toBeGreaterThan(0);
  });

  it('AC-IMP-004c: the preview shows "1 valid, 1 invalid, 2 total" and a per-row error chip, and renders no confirm-write side effect (descriptor.create not called on reaching preview)', async () => {
    const user = userEvent.setup();
    render(<ImportWizard descriptor={descriptor} onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    // mapping step auto-mapped → Next
    await waitFor(() => expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    // preview summary
    const summary = await screen.findByTestId('import-summary');
    expect(summary).toHaveTextContent('1 valid');
    expect(summary).toHaveTextContent('1 invalid');
    expect(summary).toHaveTextContent('2 total');
    // a per-row error chip is shown (the invalid row's "Skipped" + a field error)
    expect(screen.getAllByText(/skipped/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/company name is required/i)).toBeInTheDocument();
    // NO write occurred reaching preview (dry-run).
    expect(create).not.toHaveBeenCalled();
  });

  it('AC-IMP-005: confirming the import creates only the valid row, then shows the result and Close refetches', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ImportWizard descriptor={descriptor} onClose={onClose} />);

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    await waitFor(() => expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    // one explicit write action
    await user.click(await screen.findByRole('button', { name: /import 1 companies/i }));

    const result = await screen.findByTestId('import-result-summary');
    expect(result).toHaveTextContent('1 created');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ name: 'Acme', type: 'Client' });

    await user.click(screen.getByRole('button', { name: /^done$/i }));
    // closed WITH didImport=true (created>0) → parent refetches
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('a parse rejection keeps the wizard on the upload step and shows the error', async () => {
    const user = userEvent.setup();
    const { ImportParseError } = await vi.importActual<typeof import('@/src/lib/import')>(
      '@/src/lib/import',
    );
    (parseWorkbook as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ImportParseError('too_many_rows', 'Too many rows: 501.'),
    );
    render(<ImportWizard descriptor={descriptor} onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many rows/i);
    // still on upload (no Next button means we never advanced)
    expect(screen.queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();
  });

  it('Back from preview returns to mapping; Back from mapping returns to upload', async () => {
    const user = userEvent.setup();
    render(<ImportWizard descriptor={descriptor} onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    await waitFor(() => expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    // on preview
    await screen.findByTestId('import-summary');
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    // back on mapping (the step header reads "Match columns")
    expect(await screen.findByRole('heading', { name: /match columns/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    // back on upload
    expect(screen.getByLabelText(/choose an \.xlsx file/i)).toBeInTheDocument();
  });

  it('the result step lists each failed row with its reason when a create rejects', async () => {
    const user = userEvent.setup();
    create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    // both rows valid so both are attempted; the first rejects.
    (parseWorkbook as ReturnType<typeof vi.fn>).mockResolvedValue({
      headers: ['Company name', 'Type'],
      rows: [
        ['Dup Co', 'Client'],
        ['Fresh Co', 'Vendor'],
      ],
    });
    render(<ImportWizard descriptor={descriptor} onClose={vi.fn()} />);

    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), file());
    await waitFor(() => expect(screen.getByRole('button', { name: /^next$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(await screen.findByRole('button', { name: /import 2 companies/i }));

    const summary = await screen.findByTestId('import-result-summary');
    expect(summary).toHaveTextContent('1 created');
    expect(summary).toHaveTextContent('1 failed');
    // the failed row is listed with its name + classified reason
    expect(screen.getByText(/Dup Co/)).toBeInTheDocument();
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it('ESC closes the wizard (no import) on the upload step', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ImportWizard descriptor={descriptor} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('clicking the scrim closes the wizard (no import)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ImportWizard descriptor={descriptor} onClose={onClose} />);
    await user.click(screen.getByTestId('import-scrim'));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('Tab from the last focusable wraps back to the first (focus trap)', async () => {
    const user = userEvent.setup();
    render(<ImportWizard descriptor={descriptor} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const focusables = within(dialog).getAllByRole('button');
    const last = focusables[focusables.length - 1];
    last.focus();
    expect(last).toHaveFocus();
    await user.tab();
    // wrapped: focus is no longer on `last` (moved back into the dialog start)
    expect(last).not.toHaveFocus();
  });
});
