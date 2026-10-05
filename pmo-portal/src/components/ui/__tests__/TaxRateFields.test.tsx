import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaxRateFields } from '../TaxRateFields';
import { useStandaloneTaxFields } from '@/src/hooks/useStandaloneTaxFields';

function Form() {
  const [taxAmount, setTaxAmount] = useState('');
  const tax = useStandaloneTaxFields('1000', 'exclusive', taxAmount, setTaxAmount);
  return <><TaxRateFields fields={tax} /><output aria-label="Tax amount">{taxAmount}</output>
    <button disabled={tax.facts === null}>Save</button></>;
}

describe('standalone tax rate controls', () => {
  it('AC-DPP-001: entering nominal rate and DPP calculates the amount to save', async () => {
    const user = userEvent.setup();
    render(<Form />);
    await user.type(screen.getByLabelText('Nominal tax rate (%)'), '12');
    await user.clear(screen.getByLabelText('Tax base (DPP)'));
    await user.type(screen.getByLabelText('Tax base (DPP)'), '11/12');
    expect(screen.getByLabelText('Tax amount')).toHaveTextContent('110');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('AC-DPP-001: an invalid denominator explains the error and prevents saving', async () => {
    const user = userEvent.setup();
    render(<Form />);
    await user.type(screen.getByLabelText('Nominal tax rate (%)'), '12');
    await user.clear(screen.getByLabelText('Tax base (DPP)'));
    await user.type(screen.getByLabelText('Tax base (DPP)'), '11/0');
    expect(screen.getByRole('alert')).toHaveTextContent('Use a positive fraction no greater than 1');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
