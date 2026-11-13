import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Combobox } from '../Combobox';

describe('Combobox trigger text', () => {
  it('keeps a long selected value on one ellipsized line and exposes its full value', () => {
    const label = 'Organization default: Asia/Jakarta with a long regional description';

    render(
      <Combobox
        label="Timezone"
        value="organization-default"
        selectedOption={{ value: 'organization-default', label }}
        onChange={() => {}}
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Timezone' });
    const selectedText = screen.getByText(label);

    expect(trigger).toHaveAttribute('title', label);
    expect(selectedText).toHaveClass('min-w-0', 'flex-1', 'truncate');
  });

  it('keeps a long placeholder on one ellipsized line', () => {
    const placeholder = 'Select an organization timezone from the available list';

    render(
      <Combobox
        label="Timezone"
        value={null}
        placeholder={placeholder}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(placeholder)).toHaveClass('min-w-0', 'flex-1', 'truncate');
  });
});
