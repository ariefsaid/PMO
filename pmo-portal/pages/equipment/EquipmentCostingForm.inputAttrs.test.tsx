import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { EquipmentAssetRow, EquipmentCostingRow } from '@/src/lib/db/equipment';
import { EquipmentCostingForm } from './EquipmentCostingForm';

const h = vi.hoisted(() => ({
  preview: { mutateAsync: vi.fn(), isPending: false },
  save: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useEquipment', () => ({
  usePreviewCosting: () => h.preview,
  useSaveCosting: () => h.save,
}));

const asset = { id: 'a1', code: 'EX-200', name: 'Excavator 200', default_unit: 'hours', org_id: 'o1' } as unknown as EquipmentAssetRow;
const current = {
  setting_key: 'k1', version: 1, basis: 'actual_cost', work_rate: null, standby_rate: null, rate_unit: 'hours',
  match_account: '', match_account_group: '', match_cost_center: '', match_party_type: '', match_party: '',
  effective_from: '2026-01-01', effective_to: null, count_standby: false, is_current: true, voided: false,
} as unknown as EquipmentCostingRow;

const mount = () =>
  render(
    <ToastProvider>
      <EquipmentCostingForm asset={asset} current={current} projectName={() => 'Alpha'} money={(n) => `Rp ${n}`} onClose={() => {}} />
    </ToastProvider>,
  );

/**
 * #2092 (WIG, Forms) — the costing rule's account fields are ERP CODES, not prose: no spellcheck
 * squiggle or autocorrect may rewrite an account name while it is typed.
 */
describe('#2092 EquipmentCostingForm — account codes drop spellcheck', () => {
  it('#2092 AC1: ledger account, account group, cost centre and party are spellcheck-free', () => {
    mount();
    for (const label of ['Ledger account', 'Account group (instead of one account)', 'Cost centre (optional)', 'Party (optional)']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('spellcheck', 'false');
    }
  });
});
