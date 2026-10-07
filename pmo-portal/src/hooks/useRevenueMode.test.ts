import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  state: { data: undefined as unknown, isError: false },
}));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => h.state }));

import { useRevenueMode } from './useRevenueMode';

const row = (domain: string) => ({ id: `o-${domain}`, orgId: 'org-1', externalTier: 'erpnext', domain });

beforeEach(() => {
  h.state = { data: undefined, isError: false };
});

describe('useRevenueMode (#784) — derived from the ownership query, by the repository\'s routeWrite rule', () => {
  it('AC-NAR-001 reads native while no ERP owns revenue', () => {
    h.state = { data: [row('procurement')], isError: false };
    expect(renderHook(() => useRevenueMode()).result.current).toBe('native');
  });
  it('AC-NAR-001 an org with no ERP domains at all reads native', () => {
    h.state = { data: [], isError: false };
    expect(renderHook(() => useRevenueMode()).result.current).toBe('native');
  });
  it('AC-NAR-004 reads erp once an ERP owns revenue', () => {
    h.state = { data: [row('revenue')], isError: false };
    expect(renderHook(() => useRevenueMode()).result.current).toBe('erp');
  });
  it('#784 is undefined while ownership loads, so no surface flashes the wrong mode', () => {
    expect(renderHook(() => useRevenueMode()).result.current).toBeUndefined();
  });
  it('#784 re-renders into erp when ownership arrives after the first render', () => {
    const { result, rerender } = renderHook(() => useRevenueMode());
    expect(result.current).toBeUndefined();
    h.state = { data: [row('revenue')], isError: false };
    rerender();
    expect(result.current).toBe('erp');
  });
  it('#784 a failed ownership read falls back to native — the same fail-closed route the repository takes', () => {
    h.state = { data: undefined, isError: true };
    expect(renderHook(() => useRevenueMode()).result.current).toBe('native');
  });
});
