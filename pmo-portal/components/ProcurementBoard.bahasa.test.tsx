/**
 * The Procurement board workflow labels are localized; stage keys and status enums stay data;
 * only the displayed labels translate.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ProcurementBoard from './ProcurementBoard';

const catalogue = (locale: 'en' | 'id', namespace: string) =>
  JSON.parse(readFileSync(join(process.cwd(), `public/locales/${locale}/${namespace}.json`), 'utf8'));

const renderBoard = () => {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    fallbackNS: 'common',
    resources: {
      id: { common: catalogue('id', 'common'), procurementList: catalogue('id', 'procurementList') },
      en: { common: catalogue('en', 'common'), procurementList: catalogue('en', 'procurementList') },
    },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ProcurementBoard procurements={[]} onOpen={vi.fn()} />
      </MemoryRouter>
    </I18nextProvider>,
  );
};

describe('ProcurementBoard in Bahasa', () => {
  it('column titles are Bahasa, not the English stage names', () => {
    renderBoard();
    const titleIn = (key: string, name: string) =>
      within(screen.getByTestId(`prstage-${key}`)).getByText(name, { exact: true });
    expect(titleIn('request', 'Permintaan')).toBeInTheDocument();
    expect(titleIn('approved', 'Disetujui')).toBeInTheDocument();
    expect(titleIn('ordered', 'Dipesan')).toBeInTheDocument();
    expect(titleIn('received', 'Diterima')).toBeInTheDocument();
    expect(titleIn('paid', 'Dibayar')).toBeInTheDocument();
    for (const en of ['Request', 'Approved', 'Ordered', 'Received', 'Paid']) {
      expect(screen.queryByText(en, { exact: true })).toBeNull();
    }
  });

  it('the empty-column message names the stage in Bahasa', () => {
    renderBoard();
    expect(screen.getByText('Belum ada pengadaan pada tahap Disetujui')).toBeInTheDocument();
    expect(screen.queryByText(/No procurements at/)).toBeNull();
  });
});
