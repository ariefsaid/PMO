import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStageJourneyStepLabel } from './useDealActions';
import { setOrgStageNames } from '@/src/lib/status/orgStageNames';

describe('deal journey with organisation names (#2906)', () => {
  afterEach(() => setOrgStageNames([], 'en'));
  it('AC-STG-008: the journey step for a renamed stage reads its organisation name', () => {
    setOrgStageNames([{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: null }], 'en');
    const label = renderHook(() => useStageJourneyStepLabel()).result.current;
    expect(label('Tender')).toBe('Bid sent');
    expect(label('Pre-Qualification')).toBe('Pre-Qualification');
    expect(label('Won')).toBe('Won');
  });
});
