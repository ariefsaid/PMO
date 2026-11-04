import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthInput, ErrorBanner } from '../authFormPrimitives';

describe('authFormPrimitives: ErrorBanner contrast', () => {
  it('uses the accessible destructive text token on its tinted background', () => {
    render(<ErrorBanner message="This link is invalid or expired." />);

    const message = screen.getByText('This link is invalid or expired.');
    expect(message).toHaveClass('text-destructive-text');
    expect(message).not.toHaveAttribute('style');
  });
});

describe('authFormPrimitives: AuthInput (HKA-018)', () => {
  it('password reveal button is in the normal tab sequence and toggles password mask', async () => {
    const Harness = () => {
      const [val, setVal] = React.useState('supersecret');
      return (
        <AuthInput
          id="pwd"
          label="Password"
          type="password"
          value={val}
          onChange={setVal}
        />
      );
    };
    render(<Harness />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');

    const toggle = screen.getByRole('button', { name: 'Show value' });
    expect(toggle).not.toHaveAttribute('tabindex', '-1');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Hide value' })).toBeInTheDocument();
  });
});
