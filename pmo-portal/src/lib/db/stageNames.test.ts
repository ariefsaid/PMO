import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { listStageNames, saveStageName, validateStageName } from './stageNames';

describe('stage name validation (AC-STG-006)', () => {
  it('AC-STG-006: blank is allowed (back to shipped), over 40 characters and a taken name are refused', () => {
    expect(validateStageName('  ', ['Leads'])).toBeNull();
    expect(validateStageName('x'.repeat(41), [])).toBe('tooLong');
    expect(validateStageName(' leads ', ['Leads', 'Negotiation'])).toBe('duplicate');
    expect(validateStageName('Bid sent', ['Leads'])).toBeNull();
  });
});

describe('saveStageName', () => {
  beforeEach(() => mockFrom.mockReset());
  const chain = (result: { data: unknown; error: unknown }) => {
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn().mockResolvedValue(result) })) }));
    mockFrom.mockReturnValue({ update });
    return update;
  };

  it('stores trimmed names and turns a blank into the shipped wording', async () => {
    const update = chain({ data: [{ status: 'Leads' }], error: null });
    await saveStageName('Leads', { en: ' Prospect ', id: '' });
    expect(mockFrom).toHaveBeenCalledWith('pipeline_stage_config');
    expect(update).toHaveBeenCalledWith({ label_en: 'Prospect', label_id: null });
  });

  it('throws when the row policy let nothing change', async () => {
    chain({ data: [], error: null });
    await expect(saveStageName('Leads', { en: 'Prospect', id: '' })).rejects.toThrow();
  });
});

describe('listStageNames', () => {
  it('reads the twelve rows in a stable order', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ limit }));
    mockFrom.mockReturnValue({ select: vi.fn(() => ({ order })) });
    await listStageNames();
    expect(order).toHaveBeenCalledWith('status');
    expect(limit).toHaveBeenCalledWith(12);
  });
});
