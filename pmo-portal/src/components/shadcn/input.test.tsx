import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Input } from './input';

describe('shadcn Input', () => {
  it('keeps its associated label, controlled value, and change behavior', async () => {
    const Harness = () => {
      const [value, setValue] = React.useState('');
      return (
        <>
          <label htmlFor="filter-editor">Filter editor</label>
          <Input id="filter-editor" value={value} onChange={(event) => setValue(event.target.value)} />
        </>
      );
    };
    render(<Harness />);

    const input = screen.getByRole('textbox', { name: 'Filter editor' });
    await userEvent.type(input, 'client');
    expect(input).toHaveValue('client');
  });
});
