import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ContactFormModal } from './ContactFormModal';

/**
 * #2092 (WIG, Forms) — a contact record is a THIRD PARTY'S details: the browser must not offer
 * the signed-in user's own address or phone, the phone field must open the phone keypad, and the
 * job title carries its real autofill token.
 */
describe('#2092 Contact form: third-party details, not the user’s own', () => {
  const mount = () =>
    render(
      <ContactFormModal
        contact={null}
        ownership="pmo"
        companyOptions={[{ value: 'c1', label: 'Acme' }]}
        onClose={() => {}}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onError={() => {}}
      />,
    );

  it('#2092 AC2: the email field is not autofilled with the signed-in user’s address', () => {
    mount();
    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'off');
  });

  it('#2092 AC3: the phone field is type="tel" so a phone opens the telephone keypad', () => {
    mount();
    expect(screen.getByLabelText('Phone')).toHaveAttribute('type', 'tel');
  });

  it('the job title advertises the organization-title autofill token', () => {
    mount();
    expect(screen.getByLabelText('Title')).toHaveAttribute('autocomplete', 'organization-title');
  });
});
