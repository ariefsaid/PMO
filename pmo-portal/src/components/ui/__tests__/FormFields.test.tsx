import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatMoneyInputDraft, parseMoneyInputAtScale } from '@/src/lib/format';
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

afterEach(() => resetActiveLocale());

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

  it('#694: a multi-character adornment (a currency code) reserves more room than a single glyph', () => {
    const { unmount } = render(<NumberField label="Value" value="" onChange={() => {}} prefix="$" />);
    expect(screen.getByLabelText('Value').style.paddingLeft).toBe('');
    unmount();
    render(<NumberField label="Value" value="" onChange={() => {}} prefix="IDR" />);
    expect(parseInt(screen.getByLabelText('Value').style.paddingLeft, 10)).toBeGreaterThan(22);
  });
});

describe('NumberField: fires onChange', () => {
  it('fires onChange with the raw typed value', async () => {
    const onChange = vi.fn();
    render(<NumberField label="Value" value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Value'), '5');
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('AC-PLC-009: groups locale-aware amount drafts and preserves an unfinished decimal', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount');
    fireEvent.change(input, { target: { value: '1234.' } });
    expect(input).toHaveValue('1,234.');
  });

  it('AC-PLC-009: keeps sequentially typed digits parseable after the first grouping separator', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount');

    await userEvent.type(input, '4820000');

    expect(input).toHaveValue('4,820,000');
    expect(parseMoneyInputAtScale(input.getAttribute('value') ?? '', 2)).toBe(4_820_000);
  });

  it('AC-W3-NUM-001: keeps a sequentially typed exponent draft parseable', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount');

    await userEvent.type(input, '1e5');

    expect(input).toHaveValue('1e5');
    expect(parseMoneyInputAtScale(input.getAttribute('value') ?? '', 2)).toBe(100_000);
  });

  it('AC-PLC-009: leaves malformed grouping pasted by the user for validation', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount');
    input.focus();

    await userEvent.paste('12,34');

    expect(input).toHaveValue('12,34');
    expect(parseMoneyInputAtScale(input.getAttribute('value') ?? '', 2)).toBeNull();
  });

  it('AC-PLC-009: preserves digits and caret position during a mid-string locale-aware edit', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('12,345');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(1, 1);
    await userEvent.keyboard('9');
    expect(input).toHaveValue('192,345');
    expect(input.selectionStart).toBe(2);
  });

  it('AC-PLC-009: regroups the draft after a digit is backspaced so it stays parseable', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('1,234');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(5, 5);

    await userEvent.keyboard('{Backspace}');

    expect(input).toHaveValue('123');
    expect(parseMoneyInputAtScale(input.value, 2)).toBe(123);
    expect(input.selectionStart).toBe(3);
  });

  it('AC-PLC-009: keeps the caret beside the edit after a mid-string backspace', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('12,345,678');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    input.focus();
    // Caret after the `4`: `12,34|5,678`.
    input.setSelectionRange(5, 5);

    await userEvent.keyboard('{Backspace}');

    expect(input).toHaveValue('1,235,678');
    expect(parseMoneyInputAtScale(input.value, 2)).toBe(1_235_678);
    // Four digits precede the caret (`1,23|5,678`).
    expect(input.selectionStart).toBe(4);
  });

  it('AC-PLC-009: regroups after a forward delete in the Indonesian convention', async () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    const Wrapper = () => {
      const [value, setValue] = React.useState('1.234,5');
      return <NumberField label="Amount" value={value} onChange={setValue} localeAware />;
    };
    render(<Wrapper />);
    const input = screen.getByLabelText('Amount') as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 0);

    await userEvent.keyboard('{Delete}');

    expect(input).toHaveValue('234,5');
    expect(parseMoneyInputAtScale(input.value, 2)).toBe(234.5);
  });
});

describe('formatMoneyInputDraft', () => {
  it('formats grouping and decimal separators for Indonesian and English input', () => {
    expect(formatMoneyInputDraft('1234567,89', 'id-ID')).toBe('1.234.567,89');
    expect(formatMoneyInputDraft('1234567.89', 'en-US')).toBe('1,234,567.89');
    expect(formatMoneyInputDraft('1234,', 'id-ID')).toBe('1.234,');
    expect(formatMoneyInputDraft('1234.', 'en-US')).toBe('1,234.');
  });

  it('leaves an invalid draft available to validation without dropping digits', () => {
    expect(formatMoneyInputDraft('12x34', 'en-US')).toBe('12x34');
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

/**
 * I-4 (rendered Discover pass, 2026-07-22) — `hideLabel` on the text/number fields.
 *
 * `FieldShell` and `SelectField` already had it, for exactly this case: a control inside a table cell,
 * where a visible caption is noise. `NumberField` did not, so the budget ETC editor was hand-rolled
 * instead — and shipped with no `aria-invalid` / `aria-describedby` at all. Making the primitive cover
 * the case is what removes the reason to hand-roll one.
 */
describe('NumberField / TextField — hideLabel keeps the accessible name (I-4)', () => {
  it('NumberField with hideLabel is still named, and its label is visually hidden', () => {
    render(<NumberField label="Estimate to complete" hideLabel value="10" onChange={() => {}} />);
    const field = screen.getByLabelText('Estimate to complete');
    expect(field).toBeInTheDocument();
    expect(document.querySelector('label')).toHaveClass('sr-only');
  });

  it('NumberField with hideLabel still wires an error to the field (aria-invalid + describedby)', () => {
    render(
      <NumberField label="Estimate to complete" hideLabel value="-5" onChange={() => {}} error="Enter a valid amount" />,
    );
    const field = screen.getByLabelText('Estimate to complete');
    const alert = screen.getByRole('alert');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby') ?? '').toContain(alert.id);
  });

  it('TextField with hideLabel is still named', () => {
    render(<TextField label="Search term" hideLabel value="x" onChange={() => {}} />);
    expect(screen.getByLabelText('Search term')).toBeInTheDocument();
  });
});
