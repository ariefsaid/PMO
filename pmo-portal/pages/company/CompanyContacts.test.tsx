import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';

const h = vi.hoisted(() => ({
  contacts: [{ id: 'c1', full_name: 'Rina Example', title: 'Procurement lead' }],
}));
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => ({ data: h.contacts, isPending: false, isError: false, refetch: vi.fn() }),
}));

import { CompanyContactsList, PrimaryContactField } from './CompanyContacts';

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

describe('CompanyContactsList rows (#2077)', () => {
  it('each contact row is a real link to the contact page (openable in a new tab) and a click navigates in-app', () => {
    render(<MemoryRouter initialEntries={['/companies/x']}><CompanyContactsList companyId="x" /><Where /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'Open Rina Example' });
    expect(link).toHaveAttribute('href', '/contacts/c1');
    expect(screen.queryByRole('button', { name: /Rina Example/ })).not.toBeInTheDocument();
    const click = createEvent.click(link, { button: 0 });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByTestId('where')).toHaveTextContent('/contacts/c1');
  });
});

it('labels the alphabetically first contact neutrally without claiming primary status', () => {
  h.contacts = [{ id: 'a', full_name: 'Alpha', title: '' }, { id: 'z', full_name: 'Zeta', title: '' }];
  render(<MemoryRouter><PrimaryContactField companyId="c" /></MemoryRouter>);
  expect(screen.queryByText('Primary contact')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/contacts/a');
});
