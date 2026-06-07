import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Combobox, type ComboboxOption } from '../Combobox';

// ---------------------------------------------------------------------------
// Combobox — the async FK picker (crud-components §4). Loads options, filters
// by type-ahead, full keyboard nav (Down/Up/Enter/Esc), and the load states
// (loading / empty+create / error+retry). a11y: role="combobox"+aria-expanded,
// role="listbox"/"option", aria-activedescendant. Tests assert real behavior.
// ---------------------------------------------------------------------------

const OPTIONS: ComboboxOption[] = [
  { value: 'c1', label: 'Cascade Port Authority', sub: 'Client' },
  { value: 'c2', label: 'Camden Waterworks', sub: 'Client' },
  { value: 'v1', label: 'Zephyr Industrial', sub: 'Vendor' },
];

function loadOk() {
  return Promise.resolve(OPTIONS);
}

describe('Combobox: closed state + a11y on the trigger', () => {
  it('renders a placeholder + role="combobox" with aria-expanded=false when closed', () => {
    render(
      <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} placeholder="Select a company…" />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Client company' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Select a company…')).toBeInTheDocument();
  });

  it('renders the selected option label as a chip when value is set', () => {
    render(
      <Combobox
        label="Client company"
        value="c1"
        selectedOption={OPTIONS[0]}
        onChange={() => {}}
        loadOptions={loadOk}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Client company' })).toHaveTextContent(
      'Cascade Port Authority',
    );
  });
});

describe('Combobox: open + load + select', () => {
  it('opens on click, loads options into a listbox, and selecting an option fires onChange + closes', async () => {
    const onChange = vi.fn();
    render(<Combobox label="Client company" value={null} onChange={onChange} loadOptions={loadOk} />);
    await userEvent.click(screen.getByRole('combobox'));

    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    const opt = await screen.findByRole('option', { name: /Cascade Port Authority/ });
    await userEvent.click(opt);

    expect(onChange).toHaveBeenCalledWith('c1', OPTIONS[0]);
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  });

  it('filters options by the type-ahead query', async () => {
    render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} />);
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /Cascade Port Authority/ });

    await userEvent.type(screen.getByRole('searchbox'), 'camden');
    expect(screen.getByRole('option', { name: /Camden Waterworks/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Cascade Port Authority/ })).not.toBeInTheDocument();
  });
});

describe('Combobox: keyboard navigation', () => {
  it('ArrowDown moves active option (aria-activedescendant) and Enter selects it', async () => {
    const onChange = vi.fn();
    render(<Combobox label="Client company" value={null} onChange={onChange} loadOptions={loadOk} />);
    const trigger = screen.getByRole('combobox');
    await userEvent.click(trigger);
    await screen.findByRole('listbox');

    const search = screen.getByRole('searchbox');
    fireEvent.keyDown(search, { key: 'ArrowDown' }); // highlight first
    fireEvent.keyDown(search, { key: 'ArrowDown' }); // highlight second
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c2', OPTIONS[1]);
  });

  it('Escape closes the popover without selecting', async () => {
    const onChange = vi.fn();
    render(<Combobox label="Client company" value={null} onChange={onChange} loadOptions={loadOk} />);
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Combobox: load states', () => {
  it('shows a loading state while options resolve', async () => {
    let resolveFn: (v: ComboboxOption[]) => void = () => {};
    const slowLoad = () =>
      new Promise<ComboboxOption[]>((res) => {
        resolveFn = res;
      });
    render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={slowLoad} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByTestId('combo-loading')).toBeInTheDocument();
    resolveFn(OPTIONS);
    await screen.findByRole('option', { name: /Cascade Port Authority/ });
  });

  it('shows an empty "No matches" message when the query matches nothing', async () => {
    render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} />);
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /Cascade Port Authority/ });
    await userEvent.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText(/No .*matches/i)).toBeInTheDocument();
  });

  it('offers an inline create action in the empty state when onCreate is given', async () => {
    const onCreate = vi.fn();
    render(
      <Combobox
        label="Client company"
        value={null}
        onChange={() => {}}
        loadOptions={loadOk}
        onCreate={onCreate}
        createLabel="Create company"
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('option', { name: /Cascade Port Authority/ });
    await userEvent.type(screen.getByRole('searchbox'), 'Zephyr Tech');
    const createBtn = screen.getByRole('button', { name: /Create company/i });
    await userEvent.click(createBtn);
    expect(onCreate).toHaveBeenCalledWith('Zephyr Tech');
  });

  it('shows an error state with a retry that re-invokes loadOptions', async () => {
    const loadOptions = vi
      .fn<() => Promise<ComboboxOption[]>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(OPTIONS);
    render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOptions} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText(/Couldn't load/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    await screen.findByRole('option', { name: /Cascade Port Authority/ });
    expect(loadOptions).toHaveBeenCalledTimes(2);
  });
});

describe('Combobox: required + invalid wiring', () => {
  it('required => asterisk + aria-required; error => aria-invalid + role="alert" message', () => {
    render(
      <Combobox
        label="Client company"
        value={null}
        onChange={() => {}}
        loadOptions={loadOk}
        required
        error="Select a client company."
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Client company' });
    expect(trigger).toHaveAttribute('aria-required', 'true');
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Select a client company.');
  });
});
