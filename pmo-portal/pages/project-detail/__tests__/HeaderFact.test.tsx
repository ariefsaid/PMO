import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeaderFact } from '../HeaderFact';

/** #design-1115 round 3: a header fact reads as its label then its value, and a long value stays whole on hover. */
describe('HeaderFact', () => {
  it('reads label then value, and keeps the full value available when the line truncates it', () => {
    render(<HeaderFact label="Customer" title="Cascade Foods Processing International">Cascade Foods Processing International</HeaderFact>);
    const fact = screen.getByTitle('Cascade Foods Processing International');
    expect(fact).toHaveTextContent('Customer Cascade Foods Processing International');
  });
});
