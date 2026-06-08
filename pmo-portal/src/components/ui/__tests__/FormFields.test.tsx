import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import {
  TextField,
  NumberField,
  TextArea,
  SelectField,
  FieldError,
  FormRow,
  FormGrid,
  FormSection,
  FormActions,
} from '../FormFields';

// ---------------------------------------------------------------------------
// Shared form field primitives (crud-components §2.1, §2.2). Each is built on
// the shipped `input` token shell; the wrapper wires the field a11y
// (label/htmlFor, aria-required/invalid/describedby) — the single source of
// field accessibility. Tests assert real rendered a11y + behavior, not mocks.
// ---------------------------------------------------------------------------

describe('TextField: label + a11y wiring', () => {
  it('renders a visible <label> associated to the input via htmlFor/id', () => {
    render(<TextField label="Opportunity name" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Opportunity name');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('id');
  });

  it('required => asterisk + aria-required on the input', () => {
    render(<TextField label="Opportunity name" required value="" onChange={() => {}} />);
    const input = screen.getByLabelText(/Opportunity name/);
    expect(input).toHaveAttribute('aria-required', 'true');
    // the visible asterisk (color-not-only: text + destructive, not red alone)
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('error => aria-invalid + a role="alert" message wired via aria-describedby (state never by color alone)', () => {
    render(
      <TextField
        label="Opportunity name"
        value=""
        onChange={() => {}}
        error="Opportunity name is required."
      />,
    );
    const input = screen.getByLabelText('Opportunity name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Opportunity name is required.');
    const describedby = input.getAttribute('aria-describedby');
    expect(describedby).toBeTruthy();
    expect(document.getElementById(describedby!.split(' ').pop()!)).toBe(alert);
    // the error carries a leading icon, not red text alone
    expect(alert.querySelector('svg')).toBeTruthy();
  });

  it('helper text is wired via aria-describedby when present', () => {
    render(
      <TextField
        label="Reference"
        value=""
        onChange={() => {}}
        helper="Optional customer contract reference"
      />,
    );
    const input = screen.getByLabelText('Reference');
    const describedby = input.getAttribute('aria-describedby');
    expect(describedby).toBeTruthy();
    expect(
      screen.getByText('Optional customer contract reference'),
    ).toBeInTheDocument();
  });

  it('fires onChange with the typed value', async () => {
    const onChange = vi.fn();
    render(<TextField label="Name" value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Name'), 'A');
    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('disabled => disabled input (distinct from read-only)', () => {
    render(<TextField label="Name" value="x" onChange={() => {}} disabled />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });
});

describe('NumberField: numeric, right-aligned tabular, decimal inputmode', () => {
  it('uses inputMode="decimal" and the tabular utility', () => {
    render(<NumberField label="Estimated value" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Estimated value');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input.className).toContain('tabular');
  });

  it('renders a currency adornment when prefix is given, without breaking the label', () => {
    render(<NumberField label="Estimated value" value="4,820,000" onChange={() => {}} prefix="$" />);
    expect(screen.getByLabelText('Estimated value')).toHaveValue('4,820,000');
    expect(screen.getByText('$')).toBeInTheDocument();
  });
});

describe('NumberField: fires onChange', () => {
  it('fires onChange with the raw typed value', async () => {
    const onChange = vi.fn();
    render(<NumberField label="Value" value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Value'), '5');
    expect(onChange).toHaveBeenCalledWith('5');
  });
});

describe('TextArea: multi-line', () => {
  it('renders a labelled textarea and fires onChange', async () => {
    const onChange = vi.fn();
    render(<TextArea label="Description" value="" onChange={onChange} />);
    const ta = screen.getByLabelText('Description');
    expect(ta.tagName).toBe('TEXTAREA');
    await userEvent.type(ta, 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('error => aria-invalid + role="alert"', () => {
    render(<TextArea label="Notes" value="" onChange={() => {}} error="Notes required." />);
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Notes required.');
  });
});

describe('FormSection: fieldset/legend grouping', () => {
  it('renders a fieldset with the legend and its children', () => {
    render(
      <FormSection legend="Contact details">
        <TextField label="Email" value="" onChange={() => {}} />
      </FormSection>,
    );
    expect(screen.getByText('Contact details').tagName).toBe('LEGEND');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });
});

describe('SelectField: native select for short fixed enums', () => {
  it('renders a native <select> with the provided options and current value', () => {
    render(
      <SelectField
        label="Origination stage"
        value="Lead"
        onChange={() => {}}
        options={[
          { value: 'Lead', label: 'Lead' },
          { value: 'Internal project', label: 'Internal project' },
        ]}
      />,
    );
    const select = screen.getByLabelText('Origination stage');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('Lead');
    expect(screen.getByRole('option', { name: 'Internal project' })).toBeInTheDocument();
  });

  it('fires onChange with the selected value', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Stage"
        value="Lead"
        onChange={onChange}
        options={[
          { value: 'Lead', label: 'Lead' },
          { value: 'Internal project', label: 'Internal project' },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'Internal project' } });
    expect(onChange).toHaveBeenCalledWith('Internal project');
  });

  it('renders a disabled placeholder option when placeholder is given', () => {
    render(
      <SelectField
        label="Type"
        value=""
        onChange={() => {}}
        placeholder="Select a type…"
        options={[{ value: 'client', label: 'Client' }]}
      />,
    );
    const placeholder = screen.getByRole('option', { name: 'Select a type…' });
    expect(placeholder).toBeDisabled();
  });

  it('hideLabel keeps the label as the accessible name but renders no visible label text', () => {
    render(
      <SelectField
        hideLabel
        label="Status for Survey the site"
        value="To Do"
        onChange={() => {}}
        options={[
          { value: 'To Do', label: 'To Do' },
          { value: 'Done', label: 'Done' },
        ]}
      />,
    );
    // Still reachable by its accessible name (sr-only label), so a11y is preserved.
    const select = screen.getByLabelText('Status for Survey the site');
    expect(select.tagName).toBe('SELECT');
    // The visible label is hidden (sr-only), never a visible field caption in the row.
    const label = document.querySelector('label');
    expect(label).not.toBeNull();
    expect(label).toHaveClass('sr-only');
  });

  it('renders the tokened 32px control (h-8), never a 28px one', () => {
    render(
      <SelectField
        label="Status"
        value="To Do"
        onChange={() => {}}
        options={[{ value: 'To Do', label: 'To Do' }]}
      />,
    );
    const select = screen.getByLabelText('Status');
    expect(select).toHaveClass('h-8');
    expect(select).not.toHaveClass('h-7');
  });
});

describe('FieldError: standalone inline error', () => {
  it('renders role="alert" with an icon + text', () => {
    render(<FieldError id="x-err">Select a client company.</FieldError>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('id', 'x-err');
    expect(alert).toHaveTextContent('Select a client company.');
    expect(alert.querySelector('svg')).toBeTruthy();
  });

  it('renders nothing when no children', () => {
    const { container } = render(<FieldError id="x-err">{null}</FieldError>);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('FormRow / FormGrid / FormActions: composition', () => {
  it('FormGrid renders its children', () => {
    render(
      <FormGrid>
        <TextField label="A" value="" onChange={() => {}} />
        <TextField label="B" value="" onChange={() => {}} />
      </FormGrid>,
    );
    expect(screen.getByLabelText('A')).toBeInTheDocument();
    expect(screen.getByLabelText('B')).toBeInTheDocument();
  });

  it('FormActions renders Cancel (outline) + a primary submit; primary last in DOM order', () => {
    render(
      <FormActions
        submitLabel="Create deal"
        onCancel={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Cancel');
    expect(buttons[1]).toHaveTextContent('Create deal');
    expect(buttons[1].className).toContain('bg-primary');
  });

  it('FormActions disables submit when disabled, shows spinner + aria-busy when loading', () => {
    const { rerender } = render(
      <FormActions submitLabel="Save" onCancel={() => {}} disabled />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    rerender(<FormActions submitLabel="Save" onCancel={() => {}} loading />);
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');
  });

  it('FormActions wires onCancel + the submit button is type=submit (form submit path)', async () => {
    const onCancel = vi.fn();
    render(<FormActions submitLabel="Save" onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });

  it('FormRow renders its children inline', () => {
    render(
      <FormRow>
        <span>child-a</span>
      </FormRow>,
    );
    expect(screen.getByText('child-a')).toBeInTheDocument();
  });
});
