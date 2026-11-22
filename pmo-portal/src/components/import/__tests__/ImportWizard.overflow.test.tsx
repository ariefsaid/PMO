/**
 * AC-W2-11-01: ImportWizard preview table wrapper has overflow-x-auto (not overflow-hidden),
 * so wide columns scroll horizontally at 390px instead of being clipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ImportWizard } from '../ImportWizard';
import type { ImportDescriptor } from '@/src/lib/import';

vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});
import { parseWorkbook } from '@/src/lib/import';

interface Co { name: string; type: string }
const create = vi.fn().mockResolvedValue({ id: '1' });
const descriptor: ImportDescriptor<Co> = {
  entity: 'Companies',
  fields: [
    { key: 'name', label: 'Company name', required: true, validate: (r) => (r.trim() ? null : 'Required') },
    { key: 'type', label: 'Type', required: true, validate: (r) => (['Client', 'Vendor'].includes(r.trim()) ? null : 'Must be Client or Vendor') },
  ],
  toInput: (c) => ({ name: c.name.trim(), type: c.type.trim() }),
  create,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseWorkbook).mockResolvedValue({
    headers: ['Company name', 'Type'],
    rows: [['Acme', 'Client']],
  });
});

/** A file that is exactly the template opens the preview at once (nothing to match); any other file shows the matching first. */
async function continueToPreview() {
  await waitFor(() => expect(screen.queryByRole('button', { name: /^next$/i }) ?? screen.queryByTestId('import-summary')).toBeTruthy());
  const next = screen.queryByRole('button', { name: /^next$/i });
  if (next) { await waitFor(() => expect(next).toBeEnabled()); await userEvent.click(next); }
}

describe('ImportWizard preview overflow (W2-11)', () => {
  it('AC-W2-11-01: preview table wrapper has overflow-x-auto (not overflow-hidden)', async () => {
    const user = userEvent.setup();
    // R2-f3b guards the typed workbook with router hooks, so mount it as the app does.
    render(
      <MemoryRouter initialEntries={['/companies']}>
        <ImportWizard descriptor={descriptor} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // Upload a file to advance through mapping → preview step
    const fileInput = screen.getByLabelText(/choose an \.xlsx file/i);
    const file = new File(['dummy'], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await user.upload(fileInput as HTMLInputElement, file);

    // Mapping step auto-maps → click Next
    await continueToPreview();

    // Wait for the preview table to appear
    const previewSummary = await screen.findByTestId('import-summary');
    expect(previewSummary).toBeInTheDocument();

    // Find the table wrapper — the div immediately wrapping the <table>
    const table = screen.getByRole('table');
    const wrapper = table.parentElement;
    expect(wrapper).not.toBeNull();

    // Must have overflow-x-auto, NOT overflow-hidden
    expect(wrapper!.className).toContain('overflow-x-auto');
    expect(wrapper!.className).not.toContain('overflow-hidden');
  });
});
