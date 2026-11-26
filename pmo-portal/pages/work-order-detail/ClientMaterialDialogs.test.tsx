import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/src/lib/i18n';
import { PickupDialog } from './ClientMaterialDialogs';

const line = { requisitionNumber: 'CR-1', itemCode: 'PIPE', itemName: 'Pipe', unit: 'm' } as never;
const figures = { stillToCollect: '20', reserved: '20' } as never;

beforeEach(async () => { await i18n.changeLanguage('en'); });

describe('PickupDialog', () => {
  it('FR-CSR-010 the one location the keeper keeps is chosen for them, also when it arrives after the dialog opened', () => {
    const props = { line, figures, onClose: vi.fn(), onSave: vi.fn(async () => undefined) };
    const { rerender } = render(<PickupDialog {...props} locations={[]} />);
    rerender(<PickupDialog {...props} locations={[{ value: 'site-1', label: 'Site store' }]} />);
    expect((screen.getByLabelText(/Received at/) as HTMLSelectElement).value).toBe('site-1');
  });
});
