import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('@/src/hooks/useProjectFinances', () => ({ useProjectFinances: () => ({ data: state.data }) }));

import { AttributedSpendingNote } from './AttributedSpendingNote';

describe('AttributedSpendingNote', () => {
  beforeEach(() => { state.data = undefined; });

  it('M10: names project-wide attributed spending apart from ERP-tagged spending', () => {
    state.data = { actuals: { currency: 'USD', tagged_total: '100.00', attributed_total: '50.00' } };
    render(<AttributedSpendingNote projectId="project-1" />);
    expect(screen.getByTestId('budget-attributed-note')).toHaveTextContent('Across all years, $50 of recorded spending is attributed by cost rules, not tagged to this project in the ERP.');
  });

  it('M10: leaves the forecast context quiet when there is no attributed amount', () => {
    state.data = { actuals: { currency: 'USD', tagged_total: '100.00', attributed_total: '0.00' } };
    render(<AttributedSpendingNote projectId="project-1" />);
    expect(screen.queryByTestId('budget-attributed-note')).not.toBeInTheDocument();
  });

  it.each([[null], [undefined]])('AC-CAT-016 renders nothing when attributed is %s', (attributed) => {
    state.data = { actuals: { currency: 'USD', tagged_total: '100.00', attributed_total: attributed } };
    const { container } = render(<AttributedSpendingNote projectId="project-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while finances are unread', () => {
    const { container } = render(<AttributedSpendingNote projectId="project-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
