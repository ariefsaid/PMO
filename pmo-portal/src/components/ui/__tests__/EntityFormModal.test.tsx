import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EntityFormModal } from '../EntityFormModal';
import { TextField } from '../FormFields';

// ---------------------------------------------------------------------------
// EntityFormModal — the create / focused-edit composite (crud-components §2.2).
// Portal + scrim + focus-trap (reusing the ConfirmDialog machinery) + form
// slots + sticky FormActions + an error summary with focus-move. a11y:
// role="dialog" + aria-modal + aria-labelledby. Tests assert real behavior.
// ---------------------------------------------------------------------------

const baseProps = {
  open: true,
  title: 'New deal',
  submitLabel: 'Create deal',
  onSubmit: vi.fn(),
  onClose: vi.fn(),
};

describe('EntityFormModal: render gating + a11y', () => {
  it('renders nothing when !open', () => {
    render(
      <EntityFormModal {...baseProps} open={false}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders role="dialog" + aria-modal + aria-labelledby wired to the title', () => {
    render(
      <EntityFormModal {...baseProps}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toContain('New deal');
  });

  it('renders the title, subtitle, the form body slot, and the FormActions footer', () => {
    render(
      <EntityFormModal {...baseProps} subtitle="Create an opportunity">
        <TextField label="Opportunity name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(screen.getByText('New deal')).toBeInTheDocument();
    expect(screen.getByText('Create an opportunity')).toBeInTheDocument();
    expect(screen.getByLabelText('Opportunity name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create deal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

describe('EntityFormModal: submit / cancel wiring', () => {
  it('Submit fires onSubmit (form submit path)', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <EntityFormModal {...baseProps} onSubmit={onSubmit}>
        <TextField label="Name" value="x" onChange={() => {}} />
      </EntityFormModal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create deal' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Cancel (clean form) fires onClose with no discard confirm', async () => {
    const onClose = vi.fn();
    render(
      <EntityFormModal {...baseProps} onClose={onClose}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Discard/i)).not.toBeInTheDocument();
  });

  it('the close icon button has an accessible name', () => {
    render(
      <EntityFormModal {...baseProps}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });
});

describe('EntityFormModal: disabled submit while invalid + loading', () => {
  it('submitDisabled => submit button disabled', () => {
    render(
      <EntityFormModal {...baseProps} submitDisabled>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(screen.getByRole('button', { name: 'Create deal' })).toBeDisabled();
  });

  it('loading => spinner + aria-busy and the Esc/scrim close is blocked', async () => {
    const onClose = vi.fn();
    render(
      <EntityFormModal {...baseProps} loading onClose={onClose}>
        <TextField label="Name" value="x" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create deal' })).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EntityFormModal: error summary with focus-move', () => {
  it('renders an error summary (role="alert") listing the field errors when errorSummary is given', () => {
    render(
      <EntityFormModal
        {...baseProps}
        errorSummary={[
          { fieldId: 'f-name', message: 'Opportunity name is required' },
          { fieldId: 'f-client', message: 'Select a client company' },
        ]}
      >
        <TextField id="f-name" label="Name" value="" onChange={() => {}} error="Opportunity name is required" />
      </EntityFormModal>,
    );
    const summary = screen.getByRole('alert', { name: 'Form errors' });
    expect(summary).toHaveTextContent('Fix 2 fields');
    expect(summary).toHaveTextContent('Opportunity name is required');
    expect(summary).toHaveTextContent('Select a client company');
  });

  it('no error summary rendered when errorSummary is empty', () => {
    render(
      <EntityFormModal {...baseProps} errorSummary={[]}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('EntityFormModal: dirty-discard confirm', () => {
  it('Cancel on a DIRTY form asks to confirm discard; confirming fires onClose', async () => {
    const onClose = vi.fn();
    render(
      <EntityFormModal {...baseProps} dirty onClose={onClose}>
        <TextField label="Name" value="x" onChange={() => {}} />
      </EntityFormModal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // a discard confirmation appears; onClose has NOT yet fired
    expect(onClose).not.toHaveBeenCalled();
    const discard = await screen.findByRole('button', { name: /Discard/i });
    await userEvent.click(discard);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel on a DIRTY form then "Keep editing" keeps the modal open', async () => {
    const onClose = vi.fn();
    render(
      <EntityFormModal {...baseProps} dirty onClose={onClose}>
        <TextField label="Name" value="x" onChange={() => {}} />
      </EntityFormModal>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: /Keep editing/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('EntityFormModal: error summary anchor focus-move', () => {
  it('clicking a summary link moves focus to the named field without navigating', async () => {
    render(
      <EntityFormModal
        {...baseProps}
        errorSummary={[{ fieldId: 'f-client', message: 'Select a client company' }]}
      >
        <TextField id="f-name" label="Name" value="" onChange={() => {}} />
        <TextField id="f-client" label="Client" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    const link = screen.getByRole('link', { name: 'Select a client company' });
    await userEvent.click(link);
    expect(screen.getByLabelText('Client')).toHaveFocus();
  });
});

describe('EntityFormModal: scrim + Esc close (clean + loading)', () => {
  it('scrim click on a clean form closes via onClose', async () => {
    const onClose = vi.fn();
    render(
      <EntityFormModal {...baseProps} onClose={onClose}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    await userEvent.click(screen.getByTestId('entity-modal-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc on a clean form closes via onClose', () => {
    const onClose = vi.fn();
    render(
      <EntityFormModal {...baseProps} onClose={onClose}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('scrim click while loading does NOT close', async () => {
    const onClose = vi.fn();
    render(
      <EntityFormModal {...baseProps} loading onClose={onClose}>
        <TextField label="Name" value="x" onChange={() => {}} />
      </EntityFormModal>,
    );
    await userEvent.click(screen.getByTestId('entity-modal-scrim'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EntityFormModal: focus trap', () => {
  it('Tab from the last focusable wraps to the first (focus trap)', () => {
    render(
      <EntityFormModal {...baseProps}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
  });

  it('Shift+Tab from the first focusable wraps to the last', () => {
    render(
      <EntityFormModal {...baseProps}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

describe('EntityFormModal: lg width', () => {
  it('width="lg" applies the 640px max-width preset', () => {
    render(
      <EntityFormModal {...baseProps} width="lg">
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(screen.getByRole('dialog').className).toContain('max-w-[640px]');
  });
});

describe('EntityFormModal: focus management', () => {
  it('moves focus into the dialog on open and restores to the trigger on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <EntityFormModal {...baseProps}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(trigger).not.toHaveFocus();
    rerender(
      <EntityFormModal {...baseProps} open={false}>
        <TextField label="Name" value="" onChange={() => {}} />
      </EntityFormModal>,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
