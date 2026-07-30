import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';

/**
 * EntityFormModal — focus behaviour + rejected-save error region.
 *
 * Graduated from the 2026-07-28 rendered Discover pass (ADR-0030), which found two
 * WCAG Level A defects in the shared primitive behind every entity form:
 *
 *  - AC-A11Y-FORM-001 (WCAG 2.1.2 No Keyboard Trap) — `useEntityForm` surfaces a
 *    field error on BLUR; the modal then moved focus to the first invalid field
 *    whenever an error summary was present. Blur → summary → refocus → loop: focus
 *    could never leave the first required field. Only a SUBMIT-surfaced summary may
 *    move focus.
 *  - AC-ERR-001 / AC-A11Y-MODAL-001 — a rejected save left no persistent in-dialog
 *    evidence (only a corner toast that self-dismissed) and dumped focus on <body>,
 *    from where Tab walked into the background behind the dialog.
 */

const analytics = vi.hoisted(() => ({ trackFormValidationFailed: vi.fn() }));
vi.mock('@/src/lib/analytics', () => ({
  trackFormValidationFailed: analytics.trackFormValidationFailed,
}));

import { EntityFormModal } from '../EntityFormModal';
import { useEntityForm } from '../useEntityForm';
import { TextField, SelectField } from '../FormFields';

interface Values {
  full_name: string;
  company_id: string;
}

const validate = (v: Values) => {
  const e: Partial<Record<keyof Values, string>> = {};
  if (!v.full_name.trim()) e.full_name = 'A contact name is required.';
  if (!v.company_id) e.company_id = 'Select a company.';
  return e;
};

const RLS_DENIAL = Object.assign(
  new Error('new row violates row-level security policy for table "contacts"'),
  { code: '42501' },
);

/**
 * Mirrors the real Contacts create form: two CONSECUTIVE required fields — the
 * shape the Discover pass found unescapable, because tabbing out of field 1
 * surfaced its error and bounced focus back, and field 2 did the same.
 */
const Harness: React.FC<{ onValid?: (v: Values) => Promise<void> }> = ({ onValid }) => {
  const form = useEntityForm<Values>({
    initialValues: { full_name: '', company_id: '' },
    validate,
    idPrefix: 'contact-form',
    requiredFields: ['full_name', 'company_id'],
  });
  const [saveError, setSaveError] = useState<{ headline: string; detail?: string } | null>(null);

  const nameField = form.fieldProps('full_name');
  const companyField = form.fieldProps('company_id');

  const errorSummary = [
    form.errors.full_name ? { fieldId: nameField.id, message: form.errors.full_name } : null,
    form.errors.company_id ? { fieldId: companyField.id, message: form.errors.company_id } : null,
  ].filter(Boolean) as { fieldId: string; message: string }[];

  return (
    <EntityFormModal
      open
      title="New contact"
      submitLabel="Create contact"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit(async (values) => {
          if (!onValid) return;
          try {
            await onValid(values);
          } catch {
            setSaveError({
              headline: "You don't have permission to do that.",
              detail: 'Ask an administrator to grant you access, then try again.',
            });
          }
        });
      }}
      onClose={() => {}}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      errorSummary={errorSummary.length ? errorSummary : undefined}
      submitError={saveError}
    >
      <TextField
        id={nameField.id}
        label="Full name"
        required
        value={nameField.value}
        onChange={nameField.onChange}
        onBlur={nameField.onBlur}
        error={nameField.error}
      />
      <SelectField
        id={companyField.id}
        label="Company"
        required
        value={companyField.value}
        onChange={companyField.onChange}
        onBlur={companyField.onBlur}
        error={companyField.error}
        options={[
          { value: '', label: 'Select a company…' },
          { value: 'co-1', label: 'Cascade Port Authority' },
        ]}
      />
      <TextField id="contact-form-title" label="Title" value="" onChange={() => {}} />
    </EntityFormModal>
  );
};

/** `useEntityForm` ignores blur until the first task after mount has elapsed. */
const flushMount = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('AC-A11Y-FORM-001: blur-surfaced errors must never move focus (WCAG 2.1.2)', () => {
  it('AC-A11Y-FORM-001: tabbing out of an empty required field moves focus onward and does not return', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await flushMount();

    const name = screen.getByLabelText(/^Full name/);
    const company = screen.getByLabelText(/^Company/);
    expect(name).toHaveFocus();

    await user.tab();
    expect(company).toHaveFocus();
    expect(name).not.toHaveFocus();
  });

  it('AC-A11Y-FORM-001: a SECOND consecutive required field is also escapable (the Contacts trap)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await flushMount();

    await user.tab(); // name → company (company_id is required + empty → its error surfaces too)
    await user.tab(); // company → title
    expect(screen.getByLabelText('Title')).toHaveFocus();
  });

  it('AC-A11Y-FORM-001: Shift+Tab out of an invalid field moves backward and does not return', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await flushMount();

    const name = screen.getByLabelText(/^Full name/);
    await user.tab({ shift: true });
    expect(name).not.toHaveFocus();
    expect(screen.getByRole('button', { name: /close/i })).toHaveFocus();
  });

  it('AC-A11Y-FORM-001: a SUBMIT-surfaced summary still moves focus to the first invalid field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await flushMount();

    // Leave both required fields empty and submit via the footer button.
    await user.click(screen.getByRole('button', { name: 'Create contact' }));
    await waitFor(() => expect(screen.getByLabelText(/^Full name/)).toHaveFocus());
    expect(screen.getByRole('alert', { name: 'Form errors' })).toHaveTextContent('Fix 2 fields');
  });
});

describe('AC-ERR-001: a rejected save leaves persistent in-dialog evidence', () => {
  it('AC-ERR-001: a rejected onValid renders a persistent in-dialog error and returns focus to an in-dialog control', async () => {
    const user = userEvent.setup();
    render(<Harness onValid={() => Promise.reject(RLS_DENIAL)} />);
    await flushMount();

    await user.type(screen.getByLabelText(/^Full name/), 'Jane Doe');
    await user.selectOptions(screen.getByLabelText(/^Company/), 'co-1');
    await user.click(screen.getByRole('button', { name: 'Create contact' }));

    // Persistent (not a transient toast) in-dialog error, inside the dialog.
    const dialog = screen.getByRole('dialog');
    const region = await screen.findByTestId('entity-modal-save-error');
    expect(dialog).toContainElement(region);
    expect(region).toHaveTextContent(/permission/i);

    // Focus is returned INTO the dialog, not left on <body>.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('AC-ERR-001: the in-dialog save error clears when the user submits again', async () => {
    const user = userEvent.setup();
    const onValid = vi
      .fn<(v: Values) => Promise<void>>()
      .mockRejectedValueOnce(RLS_DENIAL)
      .mockResolvedValueOnce(undefined);
    render(<Harness onValid={onValid} />);
    await flushMount();

    await user.type(screen.getByLabelText(/^Full name/), 'Jane Doe');
    await user.selectOptions(screen.getByLabelText(/^Company/), 'co-1');
    await user.click(screen.getByRole('button', { name: 'Create contact' }));
    await screen.findByTestId('entity-modal-save-error');

    await user.click(screen.getByRole('button', { name: 'Create contact' }));
    await waitFor(() =>
      expect(screen.queryByTestId('entity-modal-save-error')).not.toBeInTheDocument(),
    );
  });
});

describe('AC-A11Y-MODAL-001: the background cannot be tabbed into while the dialog is open', () => {
  it('AC-A11Y-MODAL-001: the app shell is inert while the dialog is open and restored on close', async () => {
    const shell = document.createElement('div');
    shell.setAttribute('data-app-shell', 'root');
    shell.innerHTML = '<a href="#main">Skip to main content</a>';
    document.body.appendChild(shell);

    const { unmount } = render(<Harness />);
    await flushMount();
    expect(shell).toHaveAttribute('inert');

    unmount();
    expect(shell).not.toHaveAttribute('inert');
    shell.remove();
  });
});
