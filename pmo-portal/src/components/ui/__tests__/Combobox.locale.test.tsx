/**
 * #684 — Combobox's own scaffold text (search label/placeholder, loading, error, empty-state,
 * listbox label) built English pluralization around the caller's `noun` prop by string-appending
 * an English "s" ("Search {noun}s", "No {noun} matches") — wrong for a Bahasa `noun` like
 * "zona waktu" ("Search zona waktus" / "No zona waktu matches"). Each phrase is now translated as
 * a WHOLE sentence per language, with the noun interpolated in, so the id catalogue can omit the
 * English-only "s" entirely rather than inheriting it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Combobox, type ComboboxOption } from '../Combobox';

const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));

const OPTIONS: ComboboxOption[] = [{ value: 'tz1', label: 'America/New_York' }];

function renderIdCombobox(props: Partial<React.ComponentProps<typeof Combobox>> = {}) {
  const i18n = i18next.createInstance();
  // Synchronous init (no async gap) mirrors test/setup.ts's own instance.
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { id: { common: idCatalogue }, en: { common: enCatalogue } },
    initImmediate: false,
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <Combobox
        label="Zona waktu"
        value={null}
        onChange={() => {}}
        loadOptions={() => Promise.resolve(OPTIONS)}
        noun="zona waktu"
        {...props}
      />
    </I18nextProvider>,
  );
}

describe('Combobox — translatable scaffold text (#684)', () => {
  it("under 'id', the searchbox is named \"Cari zona waktu\" — no English \"s\" appended", async () => {
    renderIdCombobox();
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('searchbox', { name: 'Cari zona waktu' })).toBeInTheDocument();
  });

  it("under 'id', the empty-state message never reads \"zona waktus\"", async () => {
    renderIdCombobox();
    await userEvent.click(screen.getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');
    await userEvent.type(screen.getByRole('searchbox'), 'zzzzz-nope');
    const empty = await within(listbox).findByText(/zona waktu/i);
    expect(empty.textContent).not.toMatch(/zona waktus/i);
  });

  it("under 'id', a load failure names the noun without an English \"s\"", async () => {
    const i18n = i18next.createInstance();
    void i18n.init({
      lng: 'id',
      fallbackLng: 'en',
      defaultNS: 'common',
      resources: { id: { common: idCatalogue }, en: { common: enCatalogue } },
      initImmediate: false,
    });
    const failLoad = vi.fn().mockRejectedValue(new Error('network'));
    render(
      <I18nextProvider i18n={i18n}>
        <Combobox label="Zona waktu" value={null} onChange={() => {}} loadOptions={failLoad} noun="zona waktu" />
      </I18nextProvider>,
    );
    await userEvent.click(screen.getByRole('combobox'));
    const err = await screen.findByText(/Gagal memuat/i);
    expect(err.textContent).not.toMatch(/zona waktus/i);
  });
});

describe('Combobox — timezone-style search: spaces and underscores match the city part (#684)', () => {
  it('"new york" (typed with a space) matches "America/New_York"', async () => {
    render(
      <Combobox
        label="Timezone"
        value={null}
        onChange={() => {}}
        loadOptions={() => Promise.resolve(OPTIONS)}
        noun="timezone"
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /America\/New_York/i });
    await userEvent.type(screen.getByRole('searchbox'), 'new york');
    expect(screen.getByRole('option', { name: /America\/New_York/i })).toBeInTheDocument();
  });
});

describe('Combobox — keyboard: focus return + single-match Enter (#684)', () => {
  it('after Enter selects an option, focus returns to the trigger (not <body>)', async () => {
    const onChange = vi.fn();
    render(
      <Combobox
        label="Client company"
        value={null}
        onChange={onChange}
        loadOptions={() => Promise.resolve([{ value: 'c1', label: 'Cascade Port Authority' }])}
      />,
    );
    const trigger = screen.getByRole('combobox');
    await userEvent.click(trigger);
    const search = await screen.findByRole('searchbox');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('c1', { value: 'c1', label: 'Cascade Port Authority' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(search).not.toHaveFocus();
  });

  it('Enter selects the single remaining match after typing narrows the list, with no prior ArrowDown', async () => {
    const onChange = vi.fn();
    const OPTS: ComboboxOption[] = [
      { value: 'c1', label: 'Cascade Port Authority' },
      { value: 'c2', label: 'Camden Waterworks' },
    ];
    render(
      <Combobox label="Client company" value={null} onChange={onChange} loadOptions={() => Promise.resolve(OPTS)} />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /Cascade Port Authority/ });
    // Narrows to exactly one match — no ArrowDown was pressed.
    await userEvent.type(screen.getByRole('searchbox'), 'cascade');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    await userEvent.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('c1', OPTS[0]);
  });
});
