import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ data: h.data }) }));

import { AttributedSpendingNote } from './AttributedSpendingNote';

const actuals = (attributed_total: string | null | undefined) => ({ actuals: {
  currency: 'USD', total: '150.00', tagged_total: '100.00', attributed_total, excludes_restricted_rows: false, categories: [],
} });

beforeEach(() => { h.data = undefined; });

describe('AttributedSpendingNote (#1271 AC-3, budget vs actual)', () => {
  it('AC-CAT-016 names attributed spending apart from tagged spending when there is some', () => {
    h.data = actuals('50.00');
    render(<AttributedSpendingNote projectId="p1" />);
    expect(screen.getByTestId('budget-attributed-note')).toHaveTextContent('$50.00 of recorded spending is attributed by cost rules');
  });

  it.each([['0.00'], [null], [undefined]])('AC-CAT-016 renders nothing when attributed is %s', (attributed) => {
    h.data = actuals(attributed);
    const { container } = render(<AttributedSpendingNote projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while finances are unread', () => {
    const { container } = render(<AttributedSpendingNote projectId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
