import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DeliveriesSection } from './DeliveriesSection';

describe('DeliveriesSection (#1122 item 1)', () => {
  it('JOB-1122-1 shows "a delivery for you" with a link that opens the transfer to count it', () => {
    render(<MemoryRouter><DeliveriesSection deliveries={[{ id: 't9', number: 'TST-9', description: 'for the site', lineCount: 2 }]} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'A delivery for you' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /TST-9/ })).toHaveAttribute('href', '/stock/transfers/t9');
  });
  it('shows nothing while there is no delivery', () => {
    const { container } = render(<MemoryRouter><DeliveriesSection deliveries={[]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
