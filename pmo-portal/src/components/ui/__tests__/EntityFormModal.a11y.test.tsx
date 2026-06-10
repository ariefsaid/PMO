import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntityFormModal } from '../EntityFormModal';

const base = {
  open: true,
  title: 'New deal',
  submitLabel: 'Create deal',
  onSubmit: () => {},
  onClose: () => {},
  children: <input aria-label="Name" />,
};

describe('EntityFormModal disabled-submit reason (G6)', () => {
  it('AC-W6-G6: a disabled submit exposes aria-describedby pointing to a visible reason', () => {
    render(<EntityFormModal {...base} submitDisabled />);
    const submit = screen.getByRole('button', { name: 'Create deal' });
    expect(submit).toBeDisabled();
    const describedBy = submit.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const reason = document.getElementById(describedBy!);
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toMatch(/required/i);
  });

  it('AC-W6-G6: an enabled submit has no aria-describedby reason', () => {
    render(<EntityFormModal {...base} submitDisabled={false} />);
    const submit = screen.getByRole('button', { name: 'Create deal' });
    expect(submit).not.toBeDisabled();
    expect(submit.getAttribute('aria-describedby')).toBeNull();
  });
});
