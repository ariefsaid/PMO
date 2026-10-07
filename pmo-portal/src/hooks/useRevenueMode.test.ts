import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn() }));

import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { useRevenueMode } from './useRevenueMode';

describe('useRevenueMode (#784)', () => {
  it('AC-NAR-001 reads native while no ERP owns revenue', () => {
    vi.mocked(routeDomainWrite).mockReturnValue('pmo');
    expect(renderHook(() => useRevenueMode()).result.current).toBe('native');
    expect(routeDomainWrite).toHaveBeenCalledWith('revenue');
  });
  it('AC-NAR-004 reads erp once an ERP owns revenue', () => {
    vi.mocked(routeDomainWrite).mockReturnValue('external');
    expect(renderHook(() => useRevenueMode()).result.current).toBe('erp');
  });
});
