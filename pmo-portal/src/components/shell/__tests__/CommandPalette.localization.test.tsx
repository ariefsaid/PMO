import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import en from '../../../../public/locales/en/common.json';
import id from '../../../../public/locales/id/common.json';
import { CommandPalette, type PaletteItem } from '../CommandPalette';

vi.mock('@/src/hooks/useReferenceRecordSearch', () => ({
  useReferenceRecordSearch: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
}));

const items: PaletteItem[] = [
  { id: 'nav-sales', group: 'Navigate', title: 'Sales Pipeline', icon: 'pipe', run: vi.fn() },
  { id: 'nav-proc', group: 'Navigate', title: 'Procurement', icon: 'cart', run: vi.fn() },
  { id: 'act-new', group: 'Actions', title: 'New project', icon: 'plus', run: vi.fn() },
];

/**
 * The palette's live-region copy and its zero-result assistant row are read by screen
 * readers, so they must come from the catalogue — an Indonesian user must not hear
 * "3 results" or "Ask AI". Rendered against the REAL en/id catalogues (not the empty
 * test bundle) so a missing translation fails here rather than in the field.
 */
async function renderPalette(
  locale: 'en' | 'id',
  props: Partial<ComponentProps<typeof CommandPalette>> = {},
) {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: false,
    resources: { en: { translation: en }, id: { translation: id } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <CommandPalette open items={items} onClose={vi.fn()} {...props} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('CommandPalette localized announcements', () => {
  it('announces the result count from the catalogue in English', async () => {
    await renderPalette('en');
    const live = screen.getByTestId('cmdk-live-count');
    await waitFor(() => expect(live).toHaveTextContent('3 results'));
    await userEvent.type(screen.getByRole('combobox'), 'procurement');
    // Singular form, also from the catalogue.
    await waitFor(() => expect(live).toHaveTextContent('1 result'));
  });

  it('announces the result count from the catalogue in Bahasa Indonesia', async () => {
    await renderPalette('id');
    const live = screen.getByTestId('cmdk-live-count');
    await waitFor(() => expect(live).toHaveTextContent('3 hasil'));
    await userEvent.type(screen.getByRole('combobox'), 'procurement');
    await waitFor(() => expect(live).toHaveTextContent('1 hasil'));
  });

  it('AC-AT2-006: offers the zero-result assistant row in English', async () => {
    await renderPalette('en', { items: [], onAskAi: vi.fn() });
    await userEvent.type(screen.getByRole('combobox'), 'over budget');
    const row = await screen.findByRole('option', { name: /ask ai/i });
    expect(row).toHaveTextContent('Ask AI: "over budget"');
  });

  it('AC-AT2-006: offers the zero-result assistant row in Bahasa Indonesia', async () => {
    await renderPalette('id', { items: [], onAskAi: vi.fn() });
    await userEvent.type(screen.getByRole('combobox'), 'over budget');
    const row = await screen.findByRole('option', { name: /tanya ai/i });
    expect(row).toHaveTextContent('Tanya AI: "over budget"');
  });
});
