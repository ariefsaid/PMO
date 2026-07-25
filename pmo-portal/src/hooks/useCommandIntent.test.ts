/**
 * useCommandIntent / useCommandIntentMap — the per-INTENT command identity the money paths thread
 * to the repository seam (BLOCK 2, ADR-0058).
 *
 * The invariant these tests lock: an identity is stable for the LIFETIME of one form/verb session
 * (so a retry after a lost response reuses it and reconciles), and a NEW session gets a NEW one
 * (so a genuinely new document never adopts the previous one's ERP doc).
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommandIntent, useCommandIntentMap } from './useCommandIntent';

describe('useCommandIntent — one identity per component (form) session', () => {
  it('returns the SAME {id, idempotencyKey} across re-renders', () => {
    const { result, rerender } = renderHook(() => useCommandIntent());
    const first = result.current;
    rerender();
    rerender();

    expect(result.current).toBe(first);
    expect(first.id).toMatch(/[0-9a-f-]{36}/);
    expect(first.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(first.id).not.toBe(first.idempotencyKey);
  });

  it('a NEW mount (a new form session) mints a DIFFERENT identity', () => {
    const a = renderHook(() => useCommandIntent()).result.current;
    const b = renderHook(() => useCommandIntent()).result.current;

    expect(b.id).not.toBe(a.id);
    expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
  });
});

describe('useCommandIntentMap — one identity per (record, verb) key', () => {
  it('is stable per key across renders and DISTINCT across keys', () => {
    const { result, rerender } = renderHook(() => useCommandIntentMap());

    const si1 = result.current.intentFor('si-1');
    const si2 = result.current.intentFor('si-2');
    rerender();

    expect(result.current.intentFor('si-1')).toEqual(si1);
    expect(si2.id).not.toBe(si1.id);
    expect(si2.idempotencyKey).not.toBe(si1.idempotencyKey);
  });

  it('release(key) ends the session — the next call to that key mints a new identity', () => {
    const { result } = renderHook(() => useCommandIntentMap());

    const first = result.current.intentFor('si-1');
    act(() => result.current.release('si-1'));

    expect(result.current.intentFor('si-1').id).not.toBe(first.id);
  });

  it('release(key) leaves OTHER keys untouched', () => {
    const { result } = renderHook(() => useCommandIntentMap());

    const si1 = result.current.intentFor('si-1');
    const si2 = result.current.intentFor('si-2');
    act(() => result.current.release('si-2'));

    expect(result.current.intentFor('si-1')).toEqual(si1);
    expect(result.current.intentFor('si-2').id).not.toBe(si2.id);
  });
});
