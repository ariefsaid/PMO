import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormFooter } from '../FormFooter';

describe('FormFooter', () => {
  it('places Cancel to the LEFT of the primary submit (primary first from the right)', () => {
    render(
      <form>
        <FormFooter submitLabel="Save draft" cancelLabel="Cancel" onCancel={vi.fn()} />
      </form>,
    );
    const footer = screen.getByTestId('form-footer');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const submit = screen.getByRole('button', { name: 'Save draft' });
    expect(cancel).toBeInstanceOf(HTMLButtonElement);
    // DOM order: cancel precedes the primary, so the primary is first from the right.
    expect(cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer).toContainElement(cancel);
    expect(footer).toContainElement(submit);
  });

  it('is the sticky viewport-bottom footer: rides --phone-nav-height (phone bar + safe area) with an opaque surface', () => {
    render(<FormFooter submitLabel="Save" cancelLabel="Cancel" onCancel={vi.fn()} />);
    const footer = screen.getByTestId('form-footer');
    expect(footer.className).toContain('sticky');
    expect(footer.className).toContain('bottom-[var(--phone-nav-height)]');
    expect(footer.className).toContain('bg-background');
    expect(footer.className).toContain('border-t');
  });

  it('renders an optional hint to the LEFT of the actions, keeping the cluster right-aligned', () => {
    render(
      <FormFooter submitLabel="Submit" cancelLabel="Cancel" onCancel={vi.fn()} hint={<span>Enter hours to submit</span>} />,
    );
    const footer = screen.getByTestId('form-footer');
    const hint = screen.getByText('Enter hours to submit');
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(hint.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The mr-auto wrapper (not the passed node) pushes the action cluster right.
    expect(hint.parentElement).toHaveClass('mr-auto');
    expect(footer).toContainElement(hint.parentElement as HTMLElement);
  });

  it('passes disabled and loading through to the primary submit only', () => {
    render(<FormFooter submitLabel="Save" cancelLabel="Cancel" onCancel={vi.fn()} disabled loading />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
  });

  it('submit drives the wrapping form (type=submit), Cancel does not', () => {
    const onCancel = vi.fn();
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <FormFooter submitLabel="Save" cancelLabel="Cancel" onCancel={onCancel} />
      </form>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('children replace the Cancel+primary pair for multi-action footers (e.g. Save draft + Submit week), keeping the same sticky layout', () => {
    render(
      <FormFooter testId="timesheets-footer" hint={<span>Enter hours to submit</span>} className="px-3.5">
        <button type="button">Save draft</button>
        <button type="button">Submit week</button>
      </FormFooter>,
    );
    const footer = screen.getByTestId('timesheets-footer');
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    const save = screen.getByRole('button', { name: 'Save draft' });
    const submit = screen.getByRole('button', { name: 'Submit week' });
    // Primary first from the right.
    expect(save.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.className).toContain('sticky');
    expect(footer.className).toContain('bottom-[var(--phone-nav-height)]');
    expect(footer.className).toContain('px-3.5');
  });
});
