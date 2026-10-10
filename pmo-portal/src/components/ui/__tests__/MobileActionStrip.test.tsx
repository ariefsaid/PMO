import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '../../../../public/locales/en/common.json';
import id from '../../../../public/locales/id/common.json';
import { MobileActionStrip } from '../MobileActionStrip';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

async function renderStrip(locale: 'en' | 'id' = 'en', options?: { canSave?: boolean; canSubmit?: boolean; showSubmitHint?: boolean }) {
  setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
  const i18n = i18next.createInstance();
  await i18n.init({ lng: locale, fallbackLng: false, resources: { en: { translation: en }, id: { translation: id } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <MobileActionStrip
        total={13.5}
        canSave={options?.canSave ?? true}
        canSubmit={options?.canSubmit ?? true}
        showSubmitHint={options?.showSubmitHint}
        onSave={vi.fn()}
        onSubmit={vi.fn()}
      />
    </I18nextProvider>,
  );
}

describe('MobileActionStrip', () => {
  afterEach(() => {
    resetActiveLocale();
    vi.unstubAllEnvs();
  });
  it('leaves room below the actions when the non-production environment badge is present', async () => {
    vi.stubEnv('VITE_APP_ENV', 'local');
    const { getByTestId } = await renderStrip();
    expect(getByTestId('timesheets-mobile-action-strip').style.paddingBottom).toContain('2.75rem');
  });

  it('AC-UXS-023: presents the current week total and both existing completion actions', async () => {
    await renderStrip();
    expect(screen.getByText('13.5 hours this week')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeEnabled();
  });

  it('explains why Submit is disabled on an empty week', async () => {
    await renderStrip('en', { canSubmit: false, showSubmitHint: true });
    expect(screen.getByText('Enter hours to submit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeDisabled();
  });

  it('keeps the existing validation and pending gates on each action', async () => {
    await renderStrip('en', { canSave: false, canSubmit: false });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit week' })).toBeDisabled();
  });

  it('localizes the total and action labels in Indonesian', async () => {
    await renderStrip('id');
    expect(screen.getByText('13,5 jam minggu ini')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan draf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajukan minggu ini' })).toBeInTheDocument();
  });
});
