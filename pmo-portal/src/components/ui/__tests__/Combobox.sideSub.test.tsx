import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Combobox, type ComboboxOption } from '../Combobox';

// The code or tag beside a name (a project code, a role) is its own element of the option row: the
// option keeps both texts, the full name and the full sub stay reachable on hover, the sub is searchable
// and the selected option keeps its tick. (Its column never wraps; the rendered edges are measured by
// the UX proof, which jsdom cannot do.)
const LONG = 'Substation Expansion and Grid Interconnection, Northern Coastal Region, Phase Two';
const OPTIONS: ComboboxOption[] = [
  { value: 'p1', label: LONG, sub: 'MP-2611-0042' },
  { value: 'p2', label: 'Depot', sub: 'MP-2611-0007' },
];

const renderPicker = (value: string | null = null) =>
  render(<Combobox label="Project" noun="project" value={value} onChange={() => {}} loadOptions={() => Promise.resolve(OPTIONS)} />);

describe('Combobox: name with a side code', () => {
  it('keeps the whole name and the whole code, each in its own element, with the full text on hover', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /Substation/ });
    const name = within(option).getByText(LONG);
    const code = within(option).getByText('MP-2611-0042');
    expect(name).not.toBe(code);
    expect(name).toHaveAttribute('title', LONG);
    expect(code).toHaveAttribute('title', 'MP-2611-0042');
  });

  it('finds an option by its code', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.keyboard('0007');
    expect(await screen.findByRole('option', { name: /Depot/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Substation/ })).toBeNull();
  });

  it('marks the selected option', async () => {
    renderPicker('p2');
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: /Depot/ })).toHaveAttribute('aria-selected', 'true');
  });
});
