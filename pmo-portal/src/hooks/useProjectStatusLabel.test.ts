import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectStatusLabel, useSalesStageLabel } from './useProjectStatusLabel';
import { setOrgStageNames } from '@/src/lib/status/orgStageNames';

describe('stage label hooks (#2906)', () => {
  afterEach(() => setOrgStageNames([], 'en'));

  it('AC-STG-007: the status label and the Sales board column read the organisation name', () => {
    setOrgStageNames([{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: null }], 'en');
    const status = renderHook(() => useProjectStatusLabel()).result.current;
    const column = renderHook(() => useSalesStageLabel()).result.current;
    expect(status('Tender Submitted')).toBe('Bid sent');
    expect(column({ title: 'Tender', testId: 'stage-Tender Submitted', statuses: ['Tender Submitted'] })).toBe('Bid sent');
    expect(column({ title: 'Won', testId: 'stage-Won', statuses: ['Won, Pending KoM', 'Ongoing Project'] })).toBe('Won');
  });

  it('AC-STG-007: the stage is found from the column\'s stage list, not its test id', () => {
    setOrgStageNames([{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: null }], 'en');
    const column = renderHook(() => useSalesStageLabel()).result.current;
    expect(column({ title: 'Tender', testId: 'renamed-testid', statuses: ['Tender Submitted'] })).toBe('Bid sent');
    expect(column({ title: 'Tender', testId: 'stage-Tender Submitted', statuses: ['Won, Pending KoM', 'Ongoing Project'] })).not.toBe('Bid sent');
  });

  it('AC-STG-007: unnamed stages keep the shipped words', () => {
    const column = renderHook(() => useSalesStageLabel()).result.current;
    expect(column({ title: 'Pre-Qual', testId: 'stage-PQ Submitted', statuses: ['PQ Submitted'] })).toBe('PQ submitted');
  });
});
