/**
 * #2089 (WIG, Locale & i18n) — a money field's placeholder uses the viewer's decimal separator, so an
 * Indonesian user is never shown a dot-decimal hint on a comma-decimal field.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ErpTaxAmountFields } from './VendorBillTaxFields';
import type { ErpVendorTax } from '@/src/hooks/useVendorBillTax';
import { setActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';

const draft = (raw: string) => ({ raw, onChange: vi.fn(), suggestion: null });
const tax = {
  itemsNet: null,
  vat: draft(''),
  withholding: { pphType: draft('pph23'), withheld: draft('') },
  withheldAboveItems: false,
  amounts: {},
} as unknown as ErpVendorTax;

describe('#2089: money placeholders follow the viewer locale', () => {
  it('shows 0,00 in the id locale and 0.00 in en', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    try {
      const view = render(<ErpTaxAmountFields formId="f" tax={tax} />);
      expect(screen.getByLabelText('VAT amount')).toHaveAttribute('placeholder', '0,00');
      expect(screen.getByLabelText('PPh amount')).toHaveAttribute('placeholder', '0,00');
      view.unmount();
    } finally {
      resetActiveLocale();
    }
    render(<ErpTaxAmountFields formId="f" tax={tax} />);
    expect(screen.getByLabelText('VAT amount')).toHaveAttribute('placeholder', '0.00');
  });
});
