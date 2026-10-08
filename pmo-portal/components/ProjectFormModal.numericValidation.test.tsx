vi.mock('@/src/hooks/useProjectClassificationOptions', () => ({ useProjectClassificationOptions: () => ({ data: { serviceLines: [], sectors: [] }, isPending: false, isError: false }) }));
/**
 * AC-W3-NUM-001 — ProjectFormModal: estimated-value numeric validation.
 *
 * The "Estimated value" field is OPTIONAL:
 *   - Blank → allowed (treated as unset; no error, mutation may fire).
 *   - Non-empty but not a valid non-negative number (e.g. "abc", "12x", "-5")
 *     → inline FieldError on the value field + Create-project submit BLOCKED.
 *   - Valid positive number (e.g. "1500", "4,820,000") → mutation fires with
 *     the correct parsed value.
 *
 * Test strategy: render ProjectFormModal in create mode, pre-fill the required
 * name + clientId fields so the only blocking factor is the value field, then
 * assert the two-sided contract for each AC.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// OD-TAX-1 (#548): the money forms now PRE-SELECT the org's `default_tax_treatment`, which is a
// live org read (`useOrgTaxDefault` → react-query + AuthContext). Only the READ is stubbed here —
// `useTaxTreatmentPreselect` stays the real implementation, so this suite renders the shipped
// seeding behaviour without needing a QueryClientProvider/AuthProvider it otherwise has no use for.
// The pre-selection rule itself is owned by src/hooks/useOrgTaxDefault.test.tsx.
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => 'exclusive' };
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: () => ({ status: 'success', number: 'PMO-TEST-0001', error: null }),
}));

import ProjectFormModal from './ProjectFormModal';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

// ── Stubs for the two FK-fetching hooks ────────────────────────────────────
// #694: the create form reads the org currency for its money adornment.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [{ id: 'c9', name: 'Asset Owner', type: 'Client' }], isError: false }),
}));
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

/**
 * #513: a non-zero estimated value must state its tax basis before Create is enabled (migration
 * 0197). The journey therefore gained a step — the GOAL each test asserts (the parsed number that
 * reaches `onSubmit`) is unchanged; only the steps to reach it are.
 */
async function stateTaxBasis() {
  await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
  await userEvent.type(screen.getByLabelText(/tax amount/i), '0');
}

/** Fill the required fields (name + client) so value is the only gating factor. */
async function fillRequired() {
  await userEvent.type(screen.getByLabelText(/project name/i), 'Test Project');
  // Client Combobox: open → pick the first option.
  await userEvent.click(screen.getByRole('combobox', { name: /client company/i }));
  const option = await screen.findByRole('option', { name: /innovate corp/i });
  await userEvent.click(option);
}

function expectEstimatedValueError() {
  const field = screen.getByLabelText(/estimated value/i);
  expect(field).toHaveAttribute('aria-invalid', 'true');
  const errorIds = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  expect(errorIds.some((id) => document.getElementById(id)?.tagName === 'SPAN' && document.getElementById(id)?.getAttribute('role') === 'alert')).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  setActiveLocale(EN_LOCALE);
});
afterEach(() => resetActiveLocale());

// ── AC-W3-NUM-001 ────────────────────────────────────────────────────────────

describe('AC-W3-NUM-001 ProjectFormModal — estimated value numeric validation', () => {
  it('AC-W3-NUM-001: blank value is allowed — no error shown, mutation fires (field is optional)', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    // Leave value blank.
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/estimated value/i)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('AC-W3-NUM-001: alphabetic value ("abc") shows an inline error and blocks submit', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), 'abc');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    // The field's own FieldError is announced and linked; the provider's empty toast region is unrelated.
    expectEstimatedValueError();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-001: mixed garbage ("12x") shows an inline error and blocks submit', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '12x');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    expectEstimatedValueError();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-001: negative value ("-5") shows an inline error and blocks submit', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '-5');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    expectEstimatedValueError();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-W3-NUM-001: valid integer ("1500") submits with the correct parsed number', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1500');
    await stateTaxBasis();
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
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
    await stateTaxBasis();
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ contract_value: 100000 });
  });

  it('AC-W3-NUM-001: comma-formatted value ("4,820,000") submits with the correct parsed number', async () => {
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '4,820,000');
    await stateTaxBasis();
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ contract_value: 4820000 });
  });

  it('AC-PLC-009: rejects an en-US amount with three decimal places before the project write', async () => {
    setActiveLocale(EN_LOCALE);
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1.234');
    await stateTaxBasis();
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));

    expect(await screen.findByText(/valid non-negative amount with no more than 2 decimal places/i, {
      selector: 'span[role="alert"]',
    })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: parses id-ID grouping as 1234 before the project write', async () => {
    setActiveLocale(ID_LOCALE);
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1.234');
    await stateTaxBasis();
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ contract_value: 1234 });
  });
});

describe('#684 AC-PLC-010: the estimated-value error distinguishes a FORMAT mistake from a real precision loss', () => {
  it("under id-ID, English-style separators (1,234.56) report the SEPARATOR mistake, not '2 decimal places'", async () => {
    setActiveLocale(ID_LOCALE);
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1,234.56');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));

    expect(await screen.findByText(/for example 1\.234,56/i, { selector: 'span[role="alert"]' })).toBeInTheDocument();
    expect(screen.queryByText(/no more than 2 decimal places/i)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('under id-ID, a pasted dot-grouped amount (1234567.89) reports the SEPARATOR mistake', async () => {
    setActiveLocale(ID_LOCALE);
    const { onSubmit } = renderModal();
    await fillRequired();
    const field = screen.getByLabelText(/estimated value/i);
    field.focus();
    await userEvent.paste('1234567.89');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));

    // The message's example is a FIXED reference amount in the viewer's convention ("1.234,56"),
    // never an echo of the user's own (malformed) input — the pasted value could itself be
    // ambiguous, which is why it needed correcting in the first place.
    expect(await screen.findByText(/for example 1\.234,56/i, { selector: 'span[role="alert"]' })).toBeInTheDocument();
    expect(screen.queryByText(/no more than 2 decimal places/i)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('under en-US, id-ID-style separators (1.234,56) report the SEPARATOR mistake, not the precision message', async () => {
    setActiveLocale(EN_LOCALE);
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1.234,56');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));

    expect(await screen.findByText(/for example 1,234\.56/i, { selector: 'span[role="alert"]' })).toBeInTheDocument();
    expect(screen.queryByText(/no more than 2 decimal places/i)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a genuine 3-decimal-place amount under en-US still reports the PRECISION message (regression)', async () => {
    setActiveLocale(EN_LOCALE);
    const { onSubmit } = renderModal();
    await fillRequired();
    await userEvent.type(screen.getByLabelText(/estimated value/i), '1.234');
    await userEvent.click(screen.getByRole('button', { name: /^Create project$/i }));

    expect(await screen.findByText(/no more than 2 decimal places/i, { selector: 'span[role="alert"]' })).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
