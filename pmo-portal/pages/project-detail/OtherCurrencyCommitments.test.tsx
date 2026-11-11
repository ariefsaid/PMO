import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OtherCurrencyCommitments } from './OtherCurrencyCommitments';

// 0373: committed spend in other currencies is shown beside the project-currency figure, never folded into it.
describe('OtherCurrencyCommitments', () => {
  it('names each other-currency amount in its own currency', () => {
    render(<OtherCurrencyCommitments positions={[{ currency: 'USD', amount: 50 }, { currency: 'EUR', amount: 1200 }]} />);
    const note = screen.getByTestId('committed-other-currencies');
    expect(note).toHaveTextContent(/^Plus amounts in other currencies: \$50, €1,200$/);
  });

  it('renders nothing when every commitment is in the project currency', () => {
    const { container } = render(<OtherCurrencyCommitments positions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the positions are not known', () => {
    const { container } = render(<OtherCurrencyCommitments positions={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
