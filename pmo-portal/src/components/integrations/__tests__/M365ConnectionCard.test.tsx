/**
 * AC-M365-012 — the Microsoft 365 activation card obeys the two-switch gate (entitlement + Admin).
 * AC-M365-013 — while live connect is HELD, the card is a disabled "available soon" stub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const { featureState } = vi.hoisted(() => ({ featureState: { value: false } }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => featureState.value }));

import { M365ConnectionCard } from '../M365ConnectionCard';

beforeEach(() => { featureState.value = false; });

describe('AC-M365-012 — activation card visibility (two-switch: entitlement + Admin)', () => {
  it('AC-M365-012: hidden when the org is NOT entitled', () => {
    featureState.value = false;
    const { container } = render(<M365ConnectionCard isAdmin />);
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-M365-012: hidden when entitled but the viewer is NOT Admin', () => {
    featureState.value = true;
    const { container } = render(<M365ConnectionCard isAdmin={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-M365-012: rendered when entitled AND Admin', () => {
    featureState.value = true;
    render(<M365ConnectionCard isAdmin />);
    expect(screen.getByTestId('m365-connection-card')).toBeInTheDocument();
  });
});

describe('AC-M365-013 — held connect affordance is a disabled available-soon stub', () => {
  it('AC-M365-013: shows Not connected and a disabled connect button', () => {
    featureState.value = true;
    render(<M365ConnectionCard isAdmin />);
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /connect microsoft 365/i });
    expect(btn).toBeDisabled();
  });
});
