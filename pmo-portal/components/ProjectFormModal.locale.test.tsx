/**
 * #684 — ProjectFormModal's "Estimated value" helper and error text were hard-coded English even
 * though the Bahasa string already existed elsewhere in the catalogue
 * (`projectDetail.header.invalidContractValue`). Rendered in 'id', both the helper and the two
 * distinct error messages (format mistake vs real precision loss) must appear in Bahasa.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import ProjectFormModal from './ProjectFormModal';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));

vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => null };
});
// #694: the create form reads the org currency for its money adornment.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [{ id: 'c9', name: 'Asset Owner', type: 'Client' }], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c1', name: 'Innovate Corp', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [{ id: 'u1', full_name: 'Alice Manager' }], isError: false }),
}));

const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

function renderInBahasa() {
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
      <ToastProvider>
        <ProjectFormModal mode="create" onClose={vi.fn()} onSubmit={vi.fn()} onError={vi.fn()} />
      </ToastProvider>
    </I18nextProvider>,
  );
}

describe('ProjectFormModal — estimated-value copy in Bahasa (#684)', () => {
  afterEach(() => resetActiveLocale());

  it('shows the Bahasa helper text for the estimated-value field', () => {
    setActiveLocale(ID_LOCALE);
    renderInBahasa();
    expect(screen.getByText('Estimasi, sebelum menang. Dapat diedit oleh Admin, Eksekutif, dan PM.')).toBeInTheDocument();
  });

  it('shows the Bahasa PRECISION error for a genuine 3-decimal amount', async () => {
    setActiveLocale(ID_LOCALE);
    renderInBahasa();
    const value = screen.getByLabelText(/nilai estimasi|estimated value/i);
    await userEvent.type(value, '123,456');
    await userEvent.tab();
    expect(await screen.findByText('Masukkan jumlah non-negatif yang valid dengan maksimal 2 angka desimal.')).toBeInTheDocument();
  });

  it('shows the Bahasa FORMAT error for English-style separators', async () => {
    setActiveLocale(ID_LOCALE);
    renderInBahasa();
    const value = screen.getByLabelText(/nilai estimasi|estimated value/i);
    await userEvent.type(value, '1,234.56');
    await userEvent.tab();
    expect(await screen.findByText(/misalnya 1\.234,56/i)).toBeInTheDocument();
  });
});
