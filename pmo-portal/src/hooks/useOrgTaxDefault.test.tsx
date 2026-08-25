import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { useState } from 'react';

/**
 * `OD-TAX-1` §1 — "it PRE-SELECTS only".
 *
 * Two hooks, two jobs. `useOrgTaxDefault` READS the org row; `useTaxTreatmentPreselect` decides
 * what a form does with the value. The second takes the first's result as a parameter, so the rule
 * can be stated here without standing up react-query or an AuthContext — and, more to the point,
 * what the rule REFUSES is what these tests are for: it must not overwrite a choice, must not
 * re-seed after the user clears the control, and must not invent a marker when the org states none.
 */
const h = vi.hoisted(() => ({ getTaxDefault: vi.fn() }));

vi.mock('@/src/lib/repositories', () => ({
  repositories: { orgSettings: { getTaxDefault: h.getTaxDefault } },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

import { useOrgTaxDefault, useTaxTreatmentPreselect } from './useOrgTaxDefault';
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return Wrapper;
}

/** A miniature form control: the shape every real call site has. */
function useControl(orgDefault: TaxTreatment | undefined, enabled = true) {
  const [value, setValue] = useState('');
  useTaxTreatmentPreselect(orgDefault, value, setValue, enabled);
  return { value, setValue };
}

beforeEach(() => vi.clearAllMocks());

describe('useOrgTaxDefault — the org pre-selection, read once per session', () => {
  it('returns the org value once it resolves', async () => {
    h.getTaxDefault.mockResolvedValue('inclusive');
    const { result } = renderHook(() => useOrgTaxDefault(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe('inclusive'));
  });

  it('returns the OTHER value for an org that holds it — not a constant', async () => {
    h.getTaxDefault.mockResolvedValue('exclusive');
    const { result } = renderHook(() => useOrgTaxDefault(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current).toBe('exclusive'));
  });

  it('is undefined — never a guess — while the org row is unread', () => {
    h.getTaxDefault.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useOrgTaxDefault(), { wrapper: makeWrapper() });
    expect(result.current).toBeUndefined();
  });

  it('is undefined when the org states nothing readable, rather than falling back to a marker', async () => {
    h.getTaxDefault.mockResolvedValue(null);
    const { result } = renderHook(() => useOrgTaxDefault(), { wrapper: makeWrapper() });
    await waitFor(() => expect(h.getTaxDefault).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});

describe('useTaxTreatmentPreselect — pre-selects only', () => {
  it('seeds an empty control with the org default when it arrives', async () => {
    const { result, rerender } = renderHook(
      ({ d }: { d: TaxTreatment | undefined }) => useControl(d),
      { initialProps: { d: undefined as TaxTreatment | undefined } },
    );
    expect(result.current.value).toBe('');
    rerender({ d: 'inclusive' });
    await waitFor(() => expect(result.current.value).toBe('inclusive'));
  });

  it('seeds whichever value the ORG holds — an exclusive org gets exclusive', async () => {
    const { result } = renderHook(() => useControl('exclusive'));
    await waitFor(() => expect(result.current.value).toBe('exclusive'));
  });

  it('leaves the control empty when the org states nothing — the submit guard stays in charge', async () => {
    const { result } = renderHook(() => useControl(undefined));
    await waitFor(() => expect(result.current.value).toBe(''));
  });

  it("never overwrites a value already in the control — the user's answer wins over the default", async () => {
    const { result, rerender } = renderHook(
      ({ d }: { d: TaxTreatment | undefined }) => useControl(d),
      { initialProps: { d: undefined as TaxTreatment | undefined } },
    );
    act(() => result.current.setValue('inclusive'));
    expect(result.current.value).toBe('inclusive');
    rerender({ d: 'exclusive' });
    await waitFor(() => expect(result.current.value).toBe('inclusive'));
  });

  it('does not re-seed after the user clears the control back to "— choose —"', async () => {
    const { result } = renderHook(() => useControl('exclusive'));
    await waitFor(() => expect(result.current.value).toBe('exclusive'));
    act(() => result.current.setValue(''));
    // The latch has already fired; a re-render must not type the default back in under the cursor.
    await waitFor(() => expect(result.current.value).toBe(''));
  });

  it('seeds NOTHING when disabled — the edit case, where a stored treatment owns the control', async () => {
    const { result } = renderHook(() => useControl('exclusive', false));
    await waitFor(() => expect(result.current.value).toBe(''));
  });
});

// ⚑ THE LATCH'S REAL ORACLE (spec review Critical). The neighbouring test — "does not re-seed after
// the user clears the control" — CANNOT fail: the effect's deps are [enabled, orgDefault], and
// clearing the control changes neither, so the effect never re-runs and `seeded.current` is never
// consulted. Removing the latch left that suite 10/10 green.
//
// The scenario the latch actually exists for, and the hook's own docstring names: the Admin flips
// the org posture MID-SESSION, ORG_TAX_DEFAULT_KEY is invalidated, a NEW default arrives — and the
// user, who has deliberately cleared or changed the control, must not have it typed back in under
// their cursor. Only a changing `orgDefault` re-runs the effect, so only this shape binds the latch.
describe('the seed-once latch (OD-TAX-1: pre-select, never re-impose)', () => {
  it('does not re-seed when the org default CHANGES after the user has already answered', () => {
    const apply = vi.fn();
    let current = '';
    const { rerender } = renderHook(
      ({ def }: { def: TaxTreatment | undefined }) =>
        useTaxTreatmentPreselect(def, current, apply, true),
      { initialProps: { def: 'exclusive' as TaxTreatment | undefined } },
    );
    expect(apply).toHaveBeenCalledWith('exclusive');

    // The user clears it on purpose, then an Admin flips the org posture mid-session.
    current = '';
    apply.mockClear();
    rerender({ def: 'inclusive' as TaxTreatment | undefined });

    expect(apply).not.toHaveBeenCalled();
  });
});
