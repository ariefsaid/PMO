import React, { type PropsWithChildren } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { axe } from 'jest-axe';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { FinancialStatementsSection, type FinancialStatementsSectionProps, type FinancialStatementsSectionState } from './FinancialStatementsSection';

const localeResources = {
  en: { common: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) },
  id: { common: JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) },
};

type Locale = keyof typeof localeResources;

const labelsByLocale: Record<Locale, FinancialStatementsSectionProps['labels']> = {
  en: {
    unavailable: 'Statements are not available yet',
    unavailableDescription: 'No complete statement is available for this period.',
    noActivity: 'No activity in this period',
    noActivityDescription: 'There was no activity during this period.',
    error: "We couldn't load statements",
    errorDescription: 'Try again. If the issue continues, contact your administrator.',
    retry: 'Retry',
    updated: 'Updated',
    delayed: 'Update delayed',
    refreshing: 'Refreshing…',
  },
  id: {
    unavailable: 'Laporan keuangan belum tersedia',
    unavailableDescription: 'Belum ada laporan lengkap untuk periode ini.',
    noActivity: 'Tidak ada aktivitas pada periode ini',
    noActivityDescription: 'Tidak ada aktivitas selama periode ini.',
    error: 'Laporan keuangan tidak dapat dimuat',
    errorDescription: 'Coba lagi. Jika masalah berlanjut, hubungi administrator.',
    retry: 'Coba lagi',
    updated: 'Diperbarui',
    delayed: 'Pembaruan tertunda',
    refreshing: 'Memperbarui…',
  },
};

const titleByLocale: Record<Locale, string> = {
  en: 'Financial statements',
  id: 'Laporan keuangan',
};

const contextByLocale: Record<Locale, string> = {
  en: 'July 2024 · IDR',
  id: 'Juli 2024 · IDR',
};

const capturedAsOf = '2024-07-31T16:30:00Z';
const completeState: FinancialStatementsSectionState = {
  kind: 'complete',
  asOf: capturedAsOf,
  hasActivity: true,
  delayed: false,
  background: 'idle',
};

function LocaleProvider({ locale, children }: PropsWithChildren<{ locale: Locale }>) {
  const [instance] = React.useState(() => {
    const created = i18next.createInstance();
    void created.init({
      lng: locale,
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: ['common'],
      resources: localeResources,
      initImmediate: false,
      interpolation: { escapeValue: false },
    });
    return created;
  });

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}

function renderInLocale(element: React.ReactElement, locale: Locale = 'en') {
  return render(element, { wrapper: ({ children }) => <LocaleProvider locale={locale}>{children}</LocaleProvider> });
}

function setProfileLocale(locale: Locale) {
  setActiveLocale({ locale, numberLocale: locale === 'en' ? 'en-US' : 'id-ID', timezone: 'UTC' });
}

function formattedCapturedDate(locale: Locale) {
  return locale === 'en' ? 'Jul 31, 2024' : '31 Jul 2024';
}

function propsFor(
  locale: Locale,
  state: FinancialStatementsSectionState,
  overrides: Partial<FinancialStatementsSectionProps> = {},
): FinancialStatementsSectionProps {
  return {
    title: titleByLocale[locale],
    context: contextByLocale[locale],
    state,
    labels: labelsByLocale[locale],
    onRetry: vi.fn(),
    children: <span data-testid="statement-child">Synthetic statement presentation</span>,
    ...overrides,
  };
}

function expectNamedSection(locale: Locale) {
  const section = screen.getByRole('region', { name: titleByLocale[locale] });
  const heading = within(section).getByRole('heading', { level: 2, name: titleByLocale[locale] });
  expect(section).toHaveAttribute('aria-labelledby', heading.id);
  expect(heading.tagName).toBe('H2');
  expect(within(section).queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  expect(within(section).getByText(contextByLocale[locale])).toBeInTheDocument();
  return section;
}

let localeBeforeTest = getActiveLocale();
beforeEach(() => {
  localeBeforeTest = getActiveLocale();
});
afterEach(() => {
  setActiveLocale(localeBeforeTest);
});

describe('AC-008 FinancialStatementsSection controlled states', () => {
  it.each(['en', 'id'] as const)('AC-008 %s loading preserves the named shell and omits data', (locale) => {
    const props = propsFor(locale, { kind: 'loading' });
    const { container } = renderInLocale(<FinancialStatementsSection {...props} />, locale);
    const section = expectNamedSection(locale);
    const loading = within(section).getByTestId('liststate-loading');

    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading).toHaveAttribute('aria-live', 'polite');
    expect(within(section).getAllByTestId('liststate-loading')).toHaveLength(1);
    expect(within(loading).getByText(locale === 'en' ? 'Loading…' : 'Memuat…')).toBeInTheDocument();
    expect(within(section).queryByTestId('statement-child')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('snapshot-provenance')).not.toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it.each(['en', 'id'] as const)('AC-008 %s error uses safe copy and one retry action', async (locale) => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderInLocale(
      <FinancialStatementsSection {...propsFor(locale, { kind: 'error' }, { onRetry })} />,
      locale,
    );
    const section = expectNamedSection(locale);
    const alert = within(section).getByRole('alert');

    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(within(section).getAllByRole('alert')).toHaveLength(1);
    expect(within(section).queryByRole('status')).not.toBeInTheDocument();
    expect(alert).toHaveTextContent(labelsByLocale[locale].error);
    expect(alert).toHaveTextContent(labelsByLocale[locale].errorDescription);
    expect(within(alert).getByRole('button', { name: labelsByLocale[locale].retry })).toBeInTheDocument();
    expect(within(section).queryByTestId('statement-child')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('snapshot-provenance')).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: labelsByLocale[locale].retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each(['en', 'id'] as const)('AC-008 %s unavailable differs from a complete empty statement', (locale) => {
    const props = propsFor(locale, { kind: 'unavailable' });
    renderInLocale(<FinancialStatementsSection {...props} />, locale);
    const section = expectNamedSection(locale);

    expect(within(section).getByText(labelsByLocale[locale].unavailable)).toBeInTheDocument();
    expect(within(section).getByText(labelsByLocale[locale].unavailableDescription)).toBeInTheDocument();
    expect(within(section).queryByText(labelsByLocale[locale].noActivity)).not.toBeInTheDocument();
    expect(within(section).queryByText(/(?:\b0(?:\.00)?\b|\$0(?:\.00)?|Rp\s*0(?:,00)?)/)).not.toBeInTheDocument();
    expect(within(section).queryByTestId('statement-child')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('snapshot-provenance')).not.toBeInTheDocument();
  });

  it.each(['en', 'id'] as const)('AC-008 %s complete-empty retains provenance and never mounts children', (locale) => {
    setProfileLocale(locale);
    const props = propsFor(locale, { ...completeState, hasActivity: false });
    renderInLocale(<FinancialStatementsSection {...props} />, locale);
    const section = expectNamedSection(locale);

    expect(within(section).getByText(labelsByLocale[locale].noActivity)).toBeInTheDocument();
    expect(within(section).getByText(labelsByLocale[locale].noActivityDescription)).toBeInTheDocument();
    expect(within(section).getByTestId('snapshot-provenance')).toHaveTextContent(`${labelsByLocale[locale].updated} ${formattedCapturedDate(locale)}`);
    expect(within(section).queryByTestId('snapshot-provenance-empty')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('statement-child')).not.toBeInTheDocument();
    expect(within(section).queryByText(/(?:\b0(?:\.00)?\b|\$0(?:\.00)?|Rp\s*0(?:,00)?)/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/No snapshot available yet/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/source-version|raw-report-id|erpnext|\bmirror\b|\bGL\b|watermark|docstatus/i)).not.toBeInTheDocument();
  });

  it.each(['en', 'id'] as const)('AC-008 %s populated complete mounts children once in caller order', (locale) => {
    setProfileLocale(locale);
    const children = (
      <>
        <span data-testid="first-child">First supplied content</span>
        <span data-testid="second-child">Second supplied content</span>
      </>
    );
    const props = propsFor(locale, completeState, { children });
    renderInLocale(<FinancialStatementsSection {...props} />, locale);
    const section = expectNamedSection(locale);

    expect(within(section).getAllByTestId('first-child')).toHaveLength(1);
    expect(within(section).getAllByTestId('second-child')).toHaveLength(1);
    expect(within(section).queryByText(labelsByLocale[locale].noActivity)).not.toBeInTheDocument();
    expect(within(section).getByTestId('snapshot-provenance')).toHaveTextContent(`${labelsByLocale[locale].updated} ${formattedCapturedDate(locale)}`);
    expect(within(section).queryByText(/No snapshot available yet/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/source-version|raw-report-id|erpnext|\bmirror\b|\bGL\b|watermark|docstatus/i)).not.toBeInTheDocument();
    expect(within(section).getByTestId('first-child').compareDocumentPosition(within(section).getByTestId('second-child')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-008 two mounted sections have distinct generated heading associations', () => {
    renderInLocale(
      <>
        <FinancialStatementsSection {...propsFor('en', { kind: 'loading' })} />
        <FinancialStatementsSection {...propsFor('en', { kind: 'unavailable' }, { title: 'Project profit and loss' })} />
      </>,
    );
    const sections = screen.getAllByRole('region');
    const headingIds = sections.map((section) => section.getAttribute('aria-labelledby'));

    expect(sections).toHaveLength(2);
    expect(new Set(headingIds).size).toBe(2);
    expect(headingIds.every(Boolean)).toBe(true);
  });
});

describe('AC-008 FinancialStatementsSection provenance and refresh status', () => {
  beforeEach(() => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  });

  it.each([
    ['en', 'populated delayed', true, true, 'idle'],
    ['en', 'populated background failure', true, false, 'failed'],
    ['en', 'empty delayed', false, true, 'idle'],
    ['en', 'empty background failure', false, false, 'failed'],
    ['id', 'populated delayed', true, true, 'idle'],
    ['id', 'populated background failure', true, false, 'failed'],
    ['id', 'empty delayed', false, true, 'idle'],
    ['id', 'empty background failure', false, false, 'failed'],
  ] as const)('AC-008 %s %s retains the captured provenance and complete state', (locale, _scenario, hasActivity, delayed, background) => {
    setProfileLocale(locale);
    const labels = labelsByLocale[locale];
    const onRetry = vi.fn();
    const state: FinancialStatementsSectionState = {
      ...completeState,
      hasActivity,
      delayed,
      background,
    };
    renderInLocale(
      <FinancialStatementsSection {...propsFor(locale, state, { onRetry })} />,
      locale,
    );
    const section = expectNamedSection(locale);
    const provenance = within(section).getByTestId('snapshot-provenance');

    expect(provenance).toHaveTextContent(`${labels.updated} ${formattedCapturedDate(locale)}`);
    expect(within(section).getAllByText(labels.delayed)).toHaveLength(1);
    expect(within(section).getAllByRole('status')).toHaveLength(1);
    const retry = within(section).getByRole('button', { name: labels.retry });
    expect(retry).toBeEnabled();
    expect(retry).toHaveClass('border-input', 'bg-background', 'text-foreground');
    expect(onRetry).not.toHaveBeenCalled();
    if (hasActivity) {
      expect(within(section).getByTestId('statement-child')).toBeInTheDocument();
      expect(within(section).queryByText(labels.noActivity)).not.toBeInTheDocument();
    } else {
      expect(within(section).getByText(labels.noActivity)).toBeInTheDocument();
      expect(within(section).queryByTestId('statement-child')).not.toBeInTheDocument();
    }
  });

  it.each(['en', 'id'] as const)('AC-008 %s background pending retains original values and time while disabling its available retry', (locale) => {
    setProfileLocale(locale);
    const labels = labelsByLocale[locale];
    const onRetry = vi.fn();
    const state: FinancialStatementsSectionState = {
      ...completeState,
      delayed: true,
      background: 'pending',
    };
    renderInLocale(<FinancialStatementsSection {...propsFor(locale, state, { onRetry })} />, locale);
    const section = expectNamedSection(locale);

    expect(within(section).getByTestId('statement-child')).toBeInTheDocument();
    expect(within(section).getByTestId('snapshot-provenance')).toHaveTextContent(`${labels.updated} ${formattedCapturedDate(locale)}`);
    expect(within(section).getByRole('status')).toHaveTextContent(labels.delayed);
    expect(within(section).getByRole('status')).toHaveTextContent(labels.refreshing);
    expect(within(section).getAllByRole('status')).toHaveLength(1);
    const retry = within(section).getByRole('button', { name: labels.retry });
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(within(retry).getByTestId('button-spinner')).toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it.each(['en', 'id'] as const)('AC-008 %s pending without a delayed snapshot announces refreshing once and adds no retry', (locale) => {
    setProfileLocale(locale);
    const labels = labelsByLocale[locale];
    const state: FinancialStatementsSectionState = { ...completeState, background: 'pending' };
    renderInLocale(<FinancialStatementsSection {...propsFor(locale, state)} />, locale);
    const section = expectNamedSection(locale);

    expect(within(section).getByRole('status')).toHaveTextContent(labels.refreshing);
    expect(within(section).getAllByRole('status')).toHaveLength(1);
    expect(within(section).queryByRole('button', { name: labels.retry })).not.toBeInTheDocument();
    expect(within(section).getByTestId('snapshot-provenance')).toHaveTextContent(`${labels.updated} ${formattedCapturedDate(locale)}`);
    expect(within(section).getByTestId('statement-child')).toBeInTheDocument();
  });

  it.each(['', 'not-an-instant', '2024-07-31'] as const)('AC-008 invalid asOf %j uses safe error copy without provenance or content', (asOf) => {
    const labels = labelsByLocale.en;
    const onRetry = vi.fn();
    const state: FinancialStatementsSectionState = {
      ...completeState,
      asOf,
    };
    renderInLocale(<FinancialStatementsSection {...propsFor('en', state, { onRetry })} />);
    const section = expectNamedSection('en');

    expect(within(section).getByRole('alert')).toHaveTextContent(labels.error);
    expect(within(section).getByRole('alert')).toHaveTextContent(labels.errorDescription);
    expect(within(section).getByRole('button', { name: labels.retry })).toBeInTheDocument();
    expect(within(section).queryByTestId('snapshot-provenance')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('statement-child')).not.toBeInTheDocument();
    if (asOf) expect(within(section).queryByText(asOf)).not.toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('AC-008 uses the active profile timezone for the original instant', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'Pacific/Kiritimati' });
    renderInLocale(<FinancialStatementsSection {...propsFor('en', completeState)} />);

    expect(screen.getByTestId('snapshot-provenance')).toHaveTextContent('Updated Aug 1, 2024');
  });
});

describe('AC-008 FinancialStatementsSection controlled transitions and retry', () => {
  beforeEach(() => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  });

  it.each([
    ['loading', { kind: 'loading' }],
    ['error', { kind: 'error' }],
    ['unavailable', { kind: 'unavailable' }],
  ] as const)('AC-008 complete to %s synchronously removes prior values and provenance', (nextKind, nextState) => {
    const { rerender } = renderInLocale(
      <FinancialStatementsSection {...propsFor('en', completeState, { context: 'Old period · IDR' })} />,
    );
    expect(screen.getByTestId('statement-child')).toBeInTheDocument();
    expect(screen.getByTestId('snapshot-provenance')).toBeInTheDocument();

    rerender(
      <FinancialStatementsSection
        {...propsFor('en', nextState as FinancialStatementsSectionState, { context: 'New period · IDR' })}
      />,
    );

    const section = screen.getByRole('region', { name: 'Financial statements' });
    expect(within(section).getByText('New period · IDR')).toBeInTheDocument();
    expect(within(section).queryByText('Old period · IDR')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('statement-child')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('snapshot-provenance')).not.toBeInTheDocument();
    if (nextKind === 'loading') expect(within(section).getByTestId('liststate-loading')).toBeInTheDocument();
    if (nextKind === 'error') expect(within(section).getByRole('alert')).toBeInTheDocument();
    if (nextKind === 'unavailable') expect(within(section).getByText(labelsByLocale.en.unavailable)).toBeInTheDocument();
  });

  it.each(['en', 'id'] as const)('AC-008 %s complete to complete uses only the newly supplied context, content, and time', (locale) => {
    setProfileLocale(locale);
    const firstState: FinancialStatementsSectionState = { ...completeState, hasActivity: true };
    const { rerender } = renderInLocale(
      <FinancialStatementsSection
        {...propsFor(locale, firstState, {
          context: 'Previous period · IDR',
          children: <span data-testid="old-child">Old complete content</span>,
        })}
      />,
      locale,
    );

    const nextState: FinancialStatementsSectionState = {
      ...completeState,
      asOf: '2024-08-02T16:30:00Z',
      hasActivity: true,
    };
    rerender(
      <FinancialStatementsSection
        {...propsFor(locale, nextState, {
          context: 'Current period · IDR',
          children: <span data-testid="new-child">New complete content</span>,
        })}
      />,
    );

    const section = screen.getByRole('region', { name: titleByLocale[locale] });
    expect(within(section).getByText('Current period · IDR')).toBeInTheDocument();
    expect(within(section).queryByText('Previous period · IDR')).not.toBeInTheDocument();
    expect(within(section).queryByTestId('old-child')).not.toBeInTheDocument();
    expect(within(section).getByTestId('new-child')).toBeInTheDocument();
    const updatedDate = locale === 'en' ? 'Aug 2, 2024' : '2 Agu 2024';
    const previousDate = formattedCapturedDate(locale);
    expect(within(section).getByTestId('snapshot-provenance')).toHaveTextContent(updatedDate);
    expect(within(section).queryByText(previousDate)).not.toBeInTheDocument();
  });

  it('AC-008 pointer retry calls the read callback once and never during mount or rerender', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const delayed: FinancialStatementsSectionState = { ...completeState, delayed: true };
    const { rerender } = renderInLocale(
      <FinancialStatementsSection {...propsFor('en', delayed, { onRetry })} />,
    );
    expect(onRetry).not.toHaveBeenCalled();
    rerender(<FinancialStatementsSection {...propsFor('en', delayed, { onRetry, context: 'Updated context' })} />);
    expect(onRetry).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('AC-008 keyboard retry is reachable and a controlled same-complete rerender does not move focus', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const delayed: FinancialStatementsSectionState = { ...completeState, delayed: true };
    const { rerender } = renderInLocale(
      <FinancialStatementsSection {...propsFor('en', delayed, { onRetry })} />,
    );
    const retry = screen.getByRole('button', { name: 'Retry' });

    await user.tab();
    expect(document.activeElement).toBe(retry);
    rerender(
      <FinancialStatementsSection
        {...propsFor('en', { ...delayed, asOf: '2024-08-02T16:30:00Z' }, { onRetry, context: 'New context' })}
      />,
    );
    expect(document.activeElement).toBe(retry);
    expect(onRetry).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('AC-008 FinancialStatementsSection axe checks', () => {
  it('AC-008 loading section has no axe violations', async () => {
    const { container } = renderInLocale(<FinancialStatementsSection {...propsFor('en', { kind: 'loading' })} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AC-008 error section has no axe violations', async () => {
    const { container } = renderInLocale(<FinancialStatementsSection {...propsFor('en', { kind: 'error' })} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AC-008 complete-empty-delayed section has no axe violations', async () => {
    const state: FinancialStatementsSectionState = { ...completeState, hasActivity: false, delayed: true };
    const { container } = renderInLocale(<FinancialStatementsSection {...propsFor('en', state)} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('AC-008 populated section has no axe violations', async () => {
    const { container } = renderInLocale(<FinancialStatementsSection {...propsFor('en', completeState)} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
