import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Proves the React 19 + Testing Library + jsdom + jest-dom chain cooperates under Vitest.
function Hello({ name }: { name: string }) {
  return <button type="button">Hello {name}</button>;
}

describe('react + testing-library + jsdom', () => {
  it('renders a component into jsdom', () => {
    render(<Hello name="PMO" />);
    expect(screen.getByRole('button', { name: 'Hello PMO' })).toBeInTheDocument();
  });
});
