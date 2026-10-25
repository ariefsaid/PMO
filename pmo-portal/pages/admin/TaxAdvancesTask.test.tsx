import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaxAdvancesTask from './TaxAdvancesTask';

interface EditorProps {
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}

const children = vi.hoisted(() => ({
  defaultTax: { current: null as EditorProps | null },
  withholding: { current: null as EditorProps | null },
  vendor: { current: null as EditorProps | null },
  downPayment: { current: null as EditorProps | null },
}));

vi.mock('./OrgTaxDefault', () => ({ default: (props: EditorProps) => { children.defaultTax.current = props; return null; } }));
vi.mock('./OrgWithholdingAccount', () => ({ default: (props: EditorProps) => { children.withholding.current = props; return null; } }));
vi.mock('./OrgVendorTaxAccounts', () => ({ default: (props: EditorProps) => { children.vendor.current = props; return null; } }));
vi.mock('./OrgDownPaymentItem', () => ({ default: (props: EditorProps) => { children.downPayment.current = props; return null; } }));

describe('TaxAdvancesTask', () => {
  it('keeps saved summaries visible and allows only one setting editor at a time', () => {
    render(<TaxAdvancesTask />);

    expect(children.defaultTax.current?.editing).toBe(false);
    expect(children.withholding.current?.editing).toBe(false);
    expect(children.vendor.current?.editing).toBe(false);
    expect(children.downPayment.current?.editing).toBe(false);

    act(() => children.withholding.current?.onEdit());
    expect(children.defaultTax.current?.editing).toBe(false);
    expect(children.withholding.current?.editing).toBe(true);
    expect(children.vendor.current?.editing).toBe(false);

    act(() => children.vendor.current?.onEdit());
    expect(children.withholding.current?.editing).toBe(false);
    expect(children.vendor.current?.editing).toBe(true);
    expect(children.downPayment.current?.editing).toBe(false);
  });
});
