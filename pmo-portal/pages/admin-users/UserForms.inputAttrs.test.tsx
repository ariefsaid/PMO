import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { InviteFormModal } from './UserForms';

/**
 * #2092 (WIG, Forms) — inviting a colleague: the admin types SOMEONE ELSE'S address, so the
 * browser must not offer the admin's own saved address, and the field must open the email
 * keyboard (type=email) without spellcheck squiggles.
 */
describe('#2092 Invite user: the email field is somebody else’s address', () => {
  const mount = () =>
    render(
      <InviteFormModal isOperator={false} loading={false} submitError={null} onClose={() => {}} onSubmit={vi.fn()} />,
    );

  it('#2092 AC2: focus/typing never prompts the admin’s own saved address', () => {
    mount();
    expect(screen.getByLabelText(/Email/)).toHaveAttribute('autocomplete', 'off');
  });

  it('#2092 AC3: the email field is typed email with no spellcheck', () => {
    mount();
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });
});
