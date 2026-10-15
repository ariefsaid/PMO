import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SubmitError } from '@/src/components/ui';
import type { FxRateRow } from '@/src/lib/repositories/types';
import FxRateForm from './FxRateForm';

const enCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'),
);
const idCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'),
);
const today = '2026-10-31';
const row: FxRateRow = {
  id: 'rate-1',
  org_id: 'org-1',
  rate_date: '2026-10-12',
  rate: 16300,
  base_currency: 'USD',
  quote_currency: 'IDR',
  source: 'JISDOR',
  created_by: null,
  updated_by: null,
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
};

afterEach(() => cleanup());

function renderForm(props: Partial<React.ComponentProps<typeof FxRateForm>> = {}) {
  const onSubmit = vi.fn();
  render(
    <FxRateForm
      today={today}
      loading={false}
      submitError={null}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

function renderFormInBahasa() {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { id: { common: idCatalogue }, en: { common: enCatalogue } },
    initImmediate: false,
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <FxRateForm
        today={today}
        loading={false}
        submitError={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    </I18nextProvider>,
  );
}

describe('FX manual rate form', () => {
  it('renders date/rate labels and save action from the Indonesian catalogue', () => {
    renderFormInBahasa();
    expect(screen.getByRole('dialog', { name: 'Kurs baru' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Tanggal publikasi/)).toBeInTheDocument();
    expect(screen.getByLabelText(/IDR per USD/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan kurs' })).toBeInTheDocument();
  });

  it('AC-FX-009 opens without eager errors and requires date and rate before submit', () => {
    renderForm();
    expect(screen.getByRole('dialog', { name: 'New rate' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rate' })).toBeDisabled();
  });

  it('AC-FX-009 blocks a future date at the native date control boundary', () => {
    const { onSubmit } = renderForm();
    const date = screen.getByLabelText(/Publication date/) as HTMLInputElement;
    fireEvent.change(date, { target: { value: '2026-11-01' } });
    expect(date.validity.rangeOverflow).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each([
    ['bad grouping', '2026-10-12', '16,23,4'],
    ['out of range', '2026-10-12', '999'],
    ['excess precision', '2026-10-12', '16234.1234567'],
  ])('blocks submit for %s', async (_name, date, rate) => {
    const { onSubmit } = renderForm();
    fireEvent.change(screen.getByLabelText(/Publication date/), { target: { value: date } });
    fireEvent.change(screen.getByLabelText(/IDR per USD/), { target: { value: rate } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }));
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-FX-009 blur feedback does not trap focus and edit mode keeps the publication date immutable', async () => {
    const user = userEvent.setup();
    renderForm({ row });
    const rate = screen.getByLabelText(/IDR per USD/);
    const date = screen.getByLabelText(/Publication date/);
    expect(date).toBeDisabled();
    await user.click(rate);
    await user.clear(rate);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a rate/i);
  });

  it('retains entered values while displaying a persistent failed-save error', () => {
    const submitError: SubmitError = { headline: 'Rate not saved', detail: 'Try again.' };
    renderForm({ draft: { rate_date: '2026-10-12', rate: 16234.56 }, submitError });
    expect(screen.getByLabelText(/Publication date/)).toHaveValue('2026-10-12');
    expect((screen.getByLabelText(/IDR per USD/) as HTMLInputElement).value).toContain('16');
    expect(screen.getByRole('alert')).toHaveTextContent('Rate not saved');
  });
});
