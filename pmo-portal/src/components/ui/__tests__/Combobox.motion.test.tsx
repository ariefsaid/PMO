/**
 * #2122 (motion slice M1) — a Combobox opened from the keyboard appears instantly instead of playing
 * the 120ms `menuPopIn` pop. Base UI's Combobox does not derive an instant state on its own (unlike
 * Menu), so the shipped Combobox sets `data-instant` from the open event: a keyboard activation
 * arrives as a click with `detail === 0`, a pointer click with `detail >= 1`. `index.css` turns the
 * animation off for `[data-instant]`.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Combobox, type ComboboxOption } from '../Combobox';

const OPTIONS: ComboboxOption[] = [
  { value: 'c1', label: 'Cascade Port Authority', sub: 'Client' },
  { value: 'c2', label: 'Camden Waterworks', sub: 'Client' },
];

const loadOptions = () => Promise.resolve(OPTIONS);

function renderPicker() {
  render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOptions} />);
  return screen.getByRole('combobox', { name: 'Client company' });
}

describe('#2122 Combobox — keyboard opens appear instantly', () => {
  it('marks the popup data-instant when the trigger is activated from the keyboard (click detail 0)', async () => {
    fireEvent.click(renderPicker(), { detail: 0 });
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-instant');
  });

  it('keeps the pop when a pointer opens the picker (click detail 1)', async () => {
    fireEvent.click(renderPicker(), { detail: 1 });
    expect(await screen.findByRole('dialog')).not.toHaveAttribute('data-instant');
  });
});
