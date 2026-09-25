import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ImpersonationProvider, useEffectiveRole } from './impersonation';
import type { DemoEligibility } from './impersonation';
import type { Role } from './AuthContext';

/** Surfaces the effective-role context so tests can drive + assert it. */
function Probe() {
  const { realRole, effectiveRole, canImpersonate, viewAs } = useEffectiveRole();
  return (
    <div>
      <span data-testid="real">{realRole}</span>
      <span data-testid="eff">{effectiveRole}</span>
      <span data-testid="can">{String(canImpersonate)}</span>
      <button type="button" onClick={() => viewAs('Engineer')}>
        view-as-engineer
      </button>
    </div>
  );
}

const wrap =
  (realRole: Role | null, demoEligibility?: DemoEligibility) =>
  ({ children }: { children: React.ReactNode }) => (
    <ImpersonationProvider realRole={realRole} demoEligibility={demoEligibility}>
      {children}
    </ImpersonationProvider>
  );

/** Harness whose eligibility can flip mid-test (for the stale-selection lifecycle). */
function FlipHarness({ realRole, initial }: { realRole: Role | null; initial: DemoEligibility }) {
  const [eligibility, setEligibility] = useState<DemoEligibility>(initial);
  return (
    <ImpersonationProvider realRole={realRole} demoEligibility={eligibility}>
      <Probe />
      <button type="button" onClick={() => setEligibility('ineligible')}>
        flip-ineligible
      </button>
      <button type="button" onClick={() => setEligibility('eligible')}>
        flip-eligible
      </button>
    </ImpersonationProvider>
  );
}

const eff = () => screen.getByTestId('eff').textContent;
const can = () => screen.getByTestId('can').textContent;

describe('ImpersonationProvider — demo-org-gated Admin view-as (AC-AUTH-013/014/015)', () => {
  it('AC-AUTH-013 (demo): a demo-org Admin can view as another role, real role unchanged', () => {
    render(<Probe />, { wrapper: wrap('Admin', 'eligible') });
    expect(can()).toBe('true');
    act(() => {
      screen.getByText('view-as-engineer').click();
    });
    expect(eff()).toBe('Engineer');
    expect(screen.getByTestId('real').textContent).toBe('Admin');
  });

  it('AC-AUTH-013 (live): a live-org Admin is denied — no affordance, viewAs inert, displayed role stays Admin', () => {
    render(<Probe />, { wrapper: wrap('Admin', 'ineligible') });
    expect(can()).toBe('false');
    act(() => {
      screen.getByText('view-as-engineer').click();
    });
    expect(eff()).toBe('Admin');
    expect(screen.getByTestId('real').textContent).toBe('Admin');
  });

  it('AC-AUTH-014 (loading/error): fails closed while the org state is pending — viewAs cannot move effectiveRole', () => {
    render(<Probe />, { wrapper: wrap('Admin', 'pending') });
    expect(can()).toBe('false');
    act(() => {
      screen.getByText('view-as-engineer').click();
    });
    expect(eff()).toBe('Admin');
  });

  it('AC-AUTH-014: the eligibility prop is OPTIONAL and defaults to pending (fail closed when unthreaded)', () => {
    render(<Probe />, { wrapper: wrap('Admin') });
    expect(can()).toBe('false');
    act(() => {
      screen.getByText('view-as-engineer').click();
    });
    expect(eff()).toBe('Admin');
  });

  it('AC-AUTH-011 (kept): a non-Admin of a demo org is still denied', () => {
    render(<Probe />, { wrapper: wrap('Finance', 'eligible') });
    expect(can()).toBe('false');
    act(() => {
      screen.getByText('view-as-engineer').click();
    });
    expect(eff()).toBe('Finance');
  });

  it('AC-AUTH-013: a null real role is denied even in a demo org', () => {
    render(<Probe />, { wrapper: wrap(null, 'eligible') });
    expect(can()).toBe('false');
    expect(eff()).toBe('');
  });

  it('AC-AUTH-015: when eligibility disappears the displayed role reverts and a stale selection never resurrects', () => {
    render(<FlipHarness realRole="Admin" initial="eligible" />);
    act(() => {
      screen.getByText('view-as-engineer').click();
    });
    expect(eff()).toBe('Engineer');

    // Org flips out of demo: displayed role reverts to the real role in the SAME render.
    act(() => {
      screen.getByText('flip-ineligible').click();
    });
    expect(eff()).toBe('Admin');
    expect(can()).toBe('false');

    // Eligibility later returns (org re-marked demo): the stale Engineer selection must
    // NOT resurrect — the cleared state is gone, not merely masked.
    act(() => {
      screen.getByText('flip-eligible').click();
    });
    expect(can()).toBe('true');
    expect(eff()).toBe('Admin');
  });
});
