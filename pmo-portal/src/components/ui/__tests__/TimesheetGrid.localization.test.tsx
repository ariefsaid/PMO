import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../../../../public/locales/en/common.json';
import id from '../../../../public/locales/id/common.json';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { TimesheetGrid, type TimesheetDay } from '../TimesheetGrid';

const days: TimesheetDay[] = [
  { label: 'Sen', dateNum: '1', weekend: false },
  { label: 'Sel', dateNum: '2', weekend: false },
  { label: 'Rab', dateNum: '3', weekend: false },
  { label: 'Kam', dateNum: '4', weekend: false },
  { label: 'Jum', dateNum: '5', weekend: false },
  { label: 'Sab', dateNum: '6', weekend: true },
  { label: 'Min', dateNum: '7', weekend: true },
];

afterEach(() => {
  resetActiveLocale();
  vi.unstubAllGlobals();
});

function mockMobileViewport() {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

async function renderGrid(locale: 'en' | 'id') {
  mockMobileViewport();
  setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
  const i18n = i18next.createInstance();
  await i18n.init({ lng: locale, fallbackLng: false, resources: { en: { translation: en }, id: { translation: id } } });
  const localizedDays = locale === 'id'
    ? days
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, index) => ({
        label,
        dateNum: String(index + 1),
        weekend: index > 4,
      }));
  return render(
    <I18nextProvider i18n={i18n}>
      <TimesheetGrid
        days={localizedDays}
        rows={[{ id: 'project-1', project: 'North Annex', code: 'P-31', hours: [8, 0, 0, 0, 0, 0, 0] }]}
        editable
        notes={{ 'project-1': '' }}
        rawHours={{ 'project-1': ['25', '', '', '', '', '', ''] }}
        invalidCells={new Set(['project-1:0'])}
      />
    </I18nextProvider>,
  );
}

describe('TimesheetGrid localized operational copy', () => {
  it('AC-UXS-006-part: shows Bahasa labels and accessible names for the entered week', async () => {
    await renderGrid('id');
    expect(screen.getByText('Total minggu')).toBeInTheDocument();
    expect(screen.getByText('Total baris')).toBeInTheDocument();
    expect(screen.getByLabelText('Jam North Annex, Sen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambahkan catatan untuk North Annex' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Hanya 0–24 jam');
  });

  it('keeps the same grid copy in English', async () => {
    await renderGrid('en');
    expect(screen.getByText('Week total')).toBeInTheDocument();
    expect(screen.getByText('Row total')).toBeInTheDocument();
    expect(screen.getByLabelText('North Annex, Mon hours')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note to North Annex' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('0–24 only');
  });
});
