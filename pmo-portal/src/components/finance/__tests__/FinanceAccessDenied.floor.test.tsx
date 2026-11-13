import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { FinanceAccessDenied } from '../FinanceAccessDenied';

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

it('floor: Back to dashboard opens the dashboard from denied Reports', () => {
  render(
    <MemoryRouter initialEntries={['/finance/reports']}>
      <FinanceAccessDenied surface="reports" />
      <CurrentLocation />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }));
  expect(screen.getByLabelText('Current location').textContent).toBe('/');
});
