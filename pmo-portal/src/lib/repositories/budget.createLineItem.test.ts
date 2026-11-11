import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: supabase.from },
}));

import { AppError } from '@/src/lib/appError';
import { budgetRepository } from './budget';

describe('budgetRepository.createLineItem error boundary', () => {
  beforeEach(() => {
    supabase.from.mockReset().mockReturnValue({ insert: supabase.insert });
    supabase.insert.mockReset().mockReturnValue({ select: supabase.select });
    supabase.select.mockReset().mockReturnValue({ single: supabase.single });
    supabase.single.mockReset();
  });

  it.each(['22003', '42501', 'P0001'])('preserves Supabase SQL code %s through the actual DAL and repository', async (code) => {
    supabase.single.mockResolvedValue({
      data: null,
      error: { message: 'private backend detail', code },
    });

    const write = budgetRepository.createLineItem('draft-1', {
      category: 'Labor',
      description: 'Reviewed line',
      budgeted_amount: 12.3,
    });

    await expect(write).rejects.toMatchObject({ name: 'AppError', code });
    await expect(write).rejects.toBeInstanceOf(AppError);
    expect(supabase.from).toHaveBeenCalledWith('budget_line_items');
    expect(supabase.insert).toHaveBeenCalledWith({
      budget_version_id: 'draft-1',
      category: 'Labor',
      description: 'Reviewed line',
      budgeted_amount: 12.3,
      fiscal_year: null,
    });
    expect(supabase.single).toHaveBeenCalledOnce();
  });

  it('normalizes a transport rejection without inventing a stable SQL outcome code', async () => {
    supabase.single.mockRejectedValue(new TypeError('fetch failed'));

    await expect(budgetRepository.createLineItem('draft-1', {
      category: 'Labor',
      description: null,
      budgeted_amount: 0.1,
    })).rejects.toMatchObject({ name: 'AppError', code: undefined });
  });
});
