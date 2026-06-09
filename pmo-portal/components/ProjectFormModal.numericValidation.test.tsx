/**
 * AC-W3-NUM-001 — ProjectFormModal: estimated-value numeric validation.
 *
 * The "Estimated value" field is OPTIONAL:
 *   - Blank → allowed (treated as unset; no error, mutation may fire).
 *   - Non-empty but not a valid non-negative number (e.g. "abc", "12x", "-5")
 *     → inline FieldError on the value field + Create-deal submit BLOCKED.
 *   - Valid positive number (e.g. "1500", "4,820,000") → mutation fires with
 *     the correct parsed value.
 *
 * Test strategy: render ProjectFormModal in create mode, pre-fill the required
 * name + clientId fields so the only blocking factor is the value field, then
 * assert the two-sided contract for each AC.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectFormModal from './ProjectFormModal';

// ── Stubs for the two FK-fetching hooks ────────────────────────────────────
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({
    data: [{ id: 'c1', name: 'Innovate Corp', type: 'Client' }],
    isError: false,
  }),
  useProjectManagers: () => ({
    data: [{ id: 'u1', full_name: 'Alice Manager' }],
    isError: false,
  }),
}));

// ── Shared render helper ───────────────────────────────────────────────────
function renderModal(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ToastProvider>
      <ProjectFormModal
        mode="create"
        onClose={vi.fn()}
        onSubmit={onSubmit}
        onError={vi.fn()}
      />
    </ToastProvider>,
  );
  return { onSubmit };
}

/** Fill the required fields (name + client) so value is the only gating factor. */
async function fillRequired() {
  await userEvent.type(screen.getByLabelText(/opportunity name/i), 'Test Deal');
  // Client Combobox: open → pick the first option.
  await userEvent.click(screen.getByRole('combobox', { name: /client company/i }));
  const option = await screen.findByRole('option', { name: /innovate corp/i });
  await userEvent.click(option);
}

beforeEach(() => vi.clearAllMocks());

// ── AC-W3-NUM-001 ────────────────────────────────────────────────────────────

describe('AC-W3-NUM-001 ProjectFormModal — estimated value numeric validation', () => {
  it('AC-W3-NUM-001: blank value is allowed — no error shown, mutation fires (field is optional)', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    // Leave value blank.
    await userEvent.click(screen.getByRole('button', { name: /^Create deal$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('AC-W3-NUM-001: alphabetic value ("abc") shows an inline error and blocks submit', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), 'abc');
    await userEvent.click(screen.getByRole('button', { name: /^Create deal$/i }));
    // Inline FieldError must appear (F8: the value error is also listed in the
    // top error-summary, so there are 2 role="alert" regions — assert >=1).
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-001: mixed garbage ("12x") shows an inline error and blocks submit', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '12x');
    await userEvent.click(screen.getByRole('button', { name: /^Create deal$/i }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-001: negative value ("-5") shows an inline error and blocks submit', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '-5');
    await userEvent.click(screen.getByRole('button', { name: /^Create deal$/i }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-001: valid integer ("1500") submits with the correct parsed number', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1500');
    await userEvent.click(screen.getByRole('button', { name: /^Create deal$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ contract_value: 1500 });
  });

  it('AC-W3-NUM-001: validate==persist — a value that passes validation is the value saved ("1e5" → 100000, not the old strip-regex 15)', async () => {
    // Regression for the validator↔persist-parser divergence: the old `parseMoney` stripped the
    // "e" ("1e5"→"15") while the validator used Number ("1e5"→100000). Both now route through the
    // shared parseMoneyInput, so the validated number IS the persisted number.
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1e5');
    await userEvent.click(screen.getByRole('button', { name: /^Create deal$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ contract_value: 100000 });
  });

  it('AC-W3-NUM-001: comma-formatted value ("4,820,000") submits with the correct parsed number', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4,820,000');
    await userEvent.click(screen.getByRole('button', { name: /^Create deal$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ contract_value: 4820000 });
  });
});
