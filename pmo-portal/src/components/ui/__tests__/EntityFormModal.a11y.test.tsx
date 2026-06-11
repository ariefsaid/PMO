import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
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

describe('EntityFormModal a11y: initial focus + unmount restore (C-1, C-2)', () => {
  it('C-1: initial focus lands on the first FORM field, not the close button', () => {
    render(
      <EntityFormModal {...base}>
        <input aria-label="Name" />
      </EntityFormModal>,
    );
    // The first form field (input[aria-label="Name"]) should have focus, NOT the close button.
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveFocus();
    expect(screen.getByRole('button', { name: /close/i })).not.toHaveFocus();
  });

  it('C-2: focus restores to the trigger when the modal UNMOUNTS (conditional-render consumer)', () => {
    // Simulate MilestoneStrip pattern: trigger btn → open modal → unmount modal.
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-label', 'open-trigger');
    document.body.appendChild(trigger);

    act(() => { trigger.focus(); });
    expect(trigger).toHaveFocus();

    const { unmount } = render(
      <EntityFormModal {...base}>
        <input aria-label="Name" />
      </EntityFormModal>,
    );

    // Modal is open — trigger no longer has focus.
    expect(trigger).not.toHaveFocus();

    // Simulate the conditional unmount (formTarget = null).
    act(() => { unmount(); });

    // Focus must restore to the trigger.
    expect(trigger).toHaveFocus();

    trigger.remove();
  });
});
