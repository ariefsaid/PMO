import { describe, it, expect, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { Breadcrumb } from '../Breadcrumb';
import { BackBar } from '../BackBar';

describe('Breadcrumb', () => {
  it('renders parts; the last is current (not a link), others navigate', async () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        parts={[
          { label: 'Projects', onClick: onNavigate },
          { label: 'Alpha' },
        ]}
      />
    );
    expect(screen.getByText('Alpha')).toHaveAttribute('aria-current', 'page');
    const link = screen.getByRole('button', { name: 'Projects' });
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalled();
  });

  it('UXS-030: uses the Vendors label for the canonical filtered Companies route', () => {
    const originalUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, '', '/companies?type=Vendor');
    try {
      render(<Breadcrumb parts={[{ label: 'Companies' }]} />);
      expect(screen.getByText('Vendors')).toHaveAttribute('aria-current', 'page');
    } finally {
      window.history.replaceState({}, '', originalUrl || '/');
    }
  });

  it('renders a parent with href as a link and keeps callback navigation', async () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        parts={[
          { label: 'Meetings', href: '/meetings', onClick: onNavigate },
          { label: 'Kickoff' },
        ]}
      />,
    );

    const link = screen.getByRole('link', { name: 'Meetings' });
    expect(link).toHaveAttribute('href', '/meetings');
    expect(screen.queryByRole('button', { name: 'Meetings' })).not.toBeInTheDocument();
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('preserves browser-native modified link activation', () => {
    const onNavigate = vi.fn();
    render(
      <Breadcrumb
        parts={[
          { label: 'Meetings', href: '#meetings', onClick: onNavigate },
          { label: 'Kickoff' },
        ]}
      />,
    );

    const link = screen.getByRole('link', { name: 'Meetings' });
    const modifiedClick = createEvent.click(link, { ctrlKey: true });
    fireEvent(link, modifiedClick);

    expect(modifiedClick.defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('a parent with href but no onClick is a plain link that keeps native navigation', () => {
    render(<Breadcrumb parts={[{ label: 'Meetings', href: '#meetings' }, { label: 'Kickoff' }]} />);

    const link = screen.getByRole('link', { name: 'Meetings' });
    expect(link).toHaveAttribute('href', '#meetings');
    expect(link).not.toHaveAttribute('aria-current');
    const click = createEvent.click(link, { button: 0 });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(false);
  });

  it('current part is not a button', () => {
    render(<Breadcrumb parts={[{ label: 'Alpha' }]} />);
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();
  });
});

describe('BackBar', () => {
  it('renders Back to {label} and navigates on click + Enter', async () => {
    const onBack = vi.fn();
    render(<BackBar label="Projects" onBack={onBack} />);
    const btn = screen.getByRole('button', { name: /Back to Projects/ });
    await userEvent.click(btn);
    expect(onBack).toHaveBeenCalledTimes(1);
    btn.focus();
    await userEvent.keyboard('{Enter}');
    expect(onBack).toHaveBeenCalledTimes(2);
  });
});

describe('BackBar — localized accessible name (AC-LRC-013)', () => {
  /** The REAL shipped catalogues, so the assertion pins the copy a Bahasa user actually hears. */
  const catalogue = (lng: 'en' | 'id') =>
    JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/common.json`), 'utf8'));

  const renderIn = async (lng: 'en' | 'id', label: string) => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng,
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: { en: { common: catalogue('en') }, id: { common: catalogue('id') } },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <BackBar label={label} onBack={() => {}} />
      </I18nextProvider>,
    );
  };

  it('AC-LRC-013: reads "Back to Companies" in English', async () => {
    await renderIn('en', 'Companies');
    expect(screen.getByRole('button', { name: 'Back to Companies' })).toBeInTheDocument();
  });

  it('AC-LRC-013: reads "Kembali ke Perusahaan" in Bahasa Indonesia — no English left in the name', async () => {
    await renderIn('id', 'Perusahaan');
    expect(screen.getByRole('button', { name: 'Kembali ke Perusahaan' })).toBeInTheDocument();
  });
});
