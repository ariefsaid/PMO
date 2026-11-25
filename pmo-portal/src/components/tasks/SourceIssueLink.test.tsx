import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { SourceIssueLink } from './SourceIssueLink';

/** #2905: the link's accessible name is its visible words, so voice control saying the visible
 *  words ("From issue") activates it (WCAG 2.5.3 Label in Name). */
describe('SourceIssueLink', () => {
  it('the accessible name is exactly the visible words', () => {
    render(<MemoryRouter><SourceIssueLink incidentId="inc-1" /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'From issue' });
    expect(link).toHaveAttribute('href', '/incidents/inc-1');
    expect(link).toHaveTextContent('From issue');
  });
});
