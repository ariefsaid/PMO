import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoAccountingSystem } from './useNoAccountingSystem';

const ownership = vi.fn();
const mode = vi.fn();
vi.mock('./useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ownership() }));
vi.mock('./useDomainOwnershipMode', () => ({ useDomainOwnershipMode: () => mode() }));

describe('useNoAccountingSystem (AC-NEF-004, AC-NEF-005)', () => {
  beforeEach(() => { ownership.mockReset(); mode.mockReset(); });
  it('AC-NEF-004 is unknown while ownership loads or failed, or bindings are unknown', () => {
    mode.mockReturnValue({ orgBound: false });
    ownership.mockReturnValue({ data: undefined, isError: false });
    expect(renderHook(() => useNoAccountingSystem()).result.current).toBe('unknown');
    ownership.mockReturnValue({ data: [], isError: true });
    expect(renderHook(() => useNoAccountingSystem()).result.current).toBe('unknown');
    ownership.mockReturnValue({ data: [], isError: false });
    mode.mockReturnValue({ orgBound: null });
    expect(renderHook(() => useNoAccountingSystem()).result.current).toBe('unknown');
  });
  it('is true only with no ownership rows and no active binding', () => {
    ownership.mockReturnValue({ data: [], isError: false });
    mode.mockReturnValue({ orgBound: false });
    expect(renderHook(() => useNoAccountingSystem()).result.current).toBe(true);
  });
  it('AC-NEF-005 is false with an active binding or an externally-owned domain', () => {
    ownership.mockReturnValue({ data: [], isError: false });
    mode.mockReturnValue({ orgBound: true });
    expect(renderHook(() => useNoAccountingSystem()).result.current).toBe(false);
    ownership.mockReturnValue({ data: [{ domain: 'revenue', externalTier: 'erpnext' }], isError: false });
    mode.mockReturnValue({ orgBound: false });
    expect(renderHook(() => useNoAccountingSystem()).result.current).toBe(false);
  });
});
