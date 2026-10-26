import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MoneyInPageHeader } from '../money-in/MoneyInPageHeader';

describe('MoneyInPageHeader', () => {
  it('keeps the page title, scope and primary action together in the local shell adapter', () => {
    const { container } = render(
      <MoneyInPageHeader
        title="Incoming payments"
        scope="Customer receipts across all projects"
        primaryAction={<button type="button">Record payment</button>}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Incoming payments' })).toBeVisible();
    expect(screen.getByText('Customer receipts across all projects')).toBeVisible();
    const heading = container.querySelector('[data-page-heading]');
    expect(heading).toBeInTheDocument();
    expect(within(heading as HTMLElement).getByRole('button', { name: 'Record payment' })).toBeVisible();
    expect(container.querySelector('[data-page-primary-action-slot="collection"]')).toBeInTheDocument();
  });
});
