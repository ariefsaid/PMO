import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Checkbox } from '../Checkbox';

describe('Checkbox (custom 16px, role=checkbox)', () => {
  it('exposes role=checkbox + aria-checked + accessible name, reachable by Tab', async () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Select row" />);
    const box = screen.getByRole('checkbox', { name: 'Select row' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    await userEvent.tab();
    expect(box).toHaveFocus();
  });

  it('click toggles on', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="x" />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('keeps a visible label inside the checkbox hit target and reports the updated value', async () => {
    const onChange = vi.fn();
    const Harness = () => {
      const [checked, setChecked] = React.useState(false);
      return (
        <Checkbox checked={checked} onChange={(next) => { onChange(next); setChecked(next); }} label="PPN 11%">
          PPN 11%
        </Checkbox>
      );
    };
    render(
      <Harness />,
    );

    await userEvent.click(screen.getByText('PPN 11%'));

    expect(screen.getByRole('checkbox', { name: 'PPN 11%' })).toHaveAttribute('aria-checked', 'true');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Space toggles via keyboard', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="x" />);
    screen.getByRole('checkbox').focus();
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('forwards aria-describedby so associated help is announced with the checkbox', () => {
    render(<><p id="vat-help">Eligibility explanation</p><Checkbox checked={false} onChange={() => {}} label="VAT" describedBy="vat-help" /></>);
    expect(screen.getByRole('checkbox', { name: 'VAT' })).toHaveAttribute('aria-describedby', 'vat-help');
  });

  it('mixed renders aria-checked=mixed', () => {
    render(<Checkbox checked="mixed" onChange={() => {}} label="all" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('disabled does not toggle and is disabled', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="x" disabled />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeDisabled();
    await userEvent.click(box);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('AC-CON-010: a `labelledBy` id takes over the accessible name via aria-labelledby, NOT a duplicate aria-label', () => {
    render(
      <>
        <span id="my-visible-label">The full visible sentence</span>
        <Checkbox checked={false} onChange={() => {}} label="short fallback" labelledBy="my-visible-label" />
      </>,
    );
    const box = screen.getByRole('checkbox', { name: 'The full visible sentence' });
    expect(box).toHaveAttribute('aria-labelledby', 'my-visible-label');
    expect(box).not.toHaveAttribute('aria-label');
  });
});
