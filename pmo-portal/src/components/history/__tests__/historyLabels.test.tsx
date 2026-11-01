import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fieldLabels, kindLabels, auditActionLabels } from '../historyLabels';
import { FIELD_KINDS } from '../historyFields';
import { useHistoryEnumLabel } from '../useHistoryEnumLabel';
import en from '../../../../public/locales/en/common.json';
import id from '../../../../public/locales/id/common.json';

vi.mock('@/src/hooks/useProjectStatusLabel', () => ({ useProjectStatusLabel: () => (v: string) => v }));
vi.mock('@/src/hooks/useProcurementStageLabel', () => ({ useProcurementStageLabel: () => () => '' }));
vi.mock('@/src/hooks/useTaxTreatmentOptions', () => ({ useTaxTreatmentOptions: () => ({ options: [] }) }));

describe('SP-7 supplier history labels', () => {
  it('calls vendor_id Supplier in English and Pemasok in Indonesian', () => {
    const translate = (key: string, options: { defaultValue?: string } | string) =>
      typeof options === 'string' ? options : options.defaultValue ?? key;
    const labels = fieldLabels(translate as never);
    expect(labels.vendor_id).toBe('Supplier');
    expect(en.history.field.vendor_id).toBe('Supplier');
    expect(id.history.field.vendor_id).toBe('Pemasok');
  });
});

describe('#1471 billing kind history', () => {
  const translate = (key: string, options: { defaultValue?: string } | string) =>
    typeof options === 'string' ? options : options.defaultValue ?? key;

  it('FR-005 classifies billing_kind as an enum on a sales invoice and labels it', () => {
    expect(FIELD_KINDS.sales_invoice.billing_kind).toBe('enum');
    expect(fieldLabels(translate as never).billing_kind).toBe('Billing kind');
  });

  it('FR-005 reads the old and new kind as Contract billing and Other billing', () => {
    const { result } = renderHook(() => useHistoryEnumLabel());
    expect(result.current('sales_invoice', 'billing_kind', 'contract')).toBe('Contract billing');
    expect(result.current('sales_invoice', 'billing_kind', 'other')).toBe('Other billing');
    expect(result.current('sales_invoice', 'billing_kind', 'unexpected')).toBe('unexpected');
  });
});

describe('#1638 stage entry history', () => {
  const translate = (key: string, options: { defaultValue?: string } | string) =>
    typeof options === 'string' ? options : options.defaultValue ?? key;
  it('AC-PSH-007: a stage entry is a known record kind with a dated stage field and labelled audit lines', () => {
    expect(FIELD_KINDS.project_stage_entry.entered_on).toBe('date');
    expect(FIELD_KINDS.project_stage_entry.source).toBe('enum');
    expect(fieldLabels(translate as never).source).toBe('Source');
    expect(en.history.field.source).toBe('Source');
    expect(id.history.field.source).toBe('Sumber');
    expect(kindLabels(translate as never).project_stage_entry).toBe('Stage entry');
    expect(auditActionLabels(translate as never)['project.stage_entry.redate']).toBe('Stage date changed');
    expect(id.history.kind.project_stage_entry).toBe('Entri tahap');
  });

  it('AC-PSH-007: maps stage entry source enum values to friendly words', () => {
    const { result } = renderHook(() => useHistoryEnumLabel());
    expect(result.current('project_stage_entry', 'source', 'backfill')).toBe('Backfill');
    expect(result.current('project_stage_entry', 'source', 'import')).toBe('Import');
    expect(result.current('project_stage_entry', 'source', 'added')).toBe('Added later');
    expect(result.current('project_stage_entry', 'source', 'transition')).toBe('Transition');
    expect(result.current('project_stage_entry', 'source', 'origination')).toBe('Origination');
    expect(result.current('project_stage_entry', 'source', 'unknown')).toBe('unknown');
  });
});
