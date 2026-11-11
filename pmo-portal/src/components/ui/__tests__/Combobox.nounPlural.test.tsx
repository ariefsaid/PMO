import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Combobox, type ComboboxOption } from '../Combobox';

/**
 * ux/1110 restore (D1): the popup search input's label is built from the noun's PROPER plural.
 * It used to concatenate a bare "s" (`Search {{noun}}s`), so noun="company" read
 * "Search companys". Callers with an irregular English plural pass `nounPlural` ("companies");
 * the regular "s" stays the default. Indonesian copy never pluralizes (it keeps the bare noun).
 */

const OPTIONS: ComboboxOption[] = [
  { value: 'c1', label: 'Cascade Port Authority', sub: 'Client' },
  { value: 'c2', label: 'Camden Waterworks', sub: 'Client' },
];

function loadOk() {
  return Promise.resolve(OPTIONS);
}

describe('Combobox — the search label pluralizes the noun properly (ux/1110 restore)', () => {
  it('an irregular noun renders its proper plural: company → "Search companies", never "companys"', async () => {
    render(
      <Combobox
        label="Client company"
        noun="company"
        nounPlural="companies"
        value={null}
        onChange={() => {}}
        loadOptions={loadOk}
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Client company' }));
    const search = await screen.findByRole('combobox', { name: 'Search companies' });
    expect(search).toHaveAttribute('placeholder', 'Search companies…');
  });

  it('a regular noun keeps the default "s" plural: timezone → "Search timezones"', async () => {
    render(<Combobox label="Timezone" noun="timezone" value={null} onChange={() => {}} loadOptions={loadOk} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Timezone' }));
    expect(await screen.findByRole('combobox', { name: 'Search timezones' })).toBeInTheDocument();
  });

  it('the list label uses the plural noun too', async () => {
    render(
      <Combobox
        label="Client company"
        noun="company"
        nounPlural="companies"
        value={null}
        onChange={() => {}}
        loadOptions={loadOk}
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Client company' }));
    await screen.findByRole('option', { name: /Cascade Port Authority/ });
    expect(screen.getByRole('listbox', { name: 'companies' })).toBeInTheDocument();
  });

  it('the load-failure copy uses the plural noun', async () => {
    render(
      <Combobox
        label="Client company"
        noun="company"
        nounPlural="companies"
        value={null}
        onChange={() => {}}
        loadOptions={() => Promise.reject(new Error('down'))}
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Client company' }));
    expect(await screen.findByText("Couldn't load companies.")).toBeInTheDocument();
  });
});
