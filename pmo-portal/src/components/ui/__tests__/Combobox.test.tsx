import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Combobox, type ComboboxOption } from '../Combobox';
import { TextField } from '../FormFields';

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
  it('uses the form-field shell by default', () => {
    render(
      <>
        <TextField label="Reference text" value="" onChange={() => {}} />
        <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} />
      </>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Client company' });
    const field = screen.getByLabelText('Reference text');
    const sharedShell = [
      'h-auto',
      'min-h-[var(--control-height)]',
      'rounded-md',
      'bg-card',
      'px-3',
      'py-1',
      'border-border',
      'hover:enabled:border-input',
      '[@media(pointer:coarse)]:min-h-11',
    ];
    sharedShell.forEach((token) => expect(field).toHaveClass(token));
    expect(trigger).toHaveClass(
      ...sharedShell,
    );
    expect(trigger).not.toHaveClass('min-h-8', 'bg-background', 'hover:border-input');
  });

  it('uses the compact token only when explicitly requested', () => {
    render(
      <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} compact />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Client company' });
    expect(trigger).toHaveClass('min-h-[var(--control-height-sm)]', 'rounded-[var(--control-radius-sm)]', 'px-2');
    expect(trigger).not.toHaveClass('min-h-[var(--control-height)]');
  });

  it('scopes border hover to enabled triggers, including the disabled shell', () => {
    const view = render(
      <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} />,
    );
    const enabledTrigger = screen.getByRole('combobox', { name: 'Client company' });
    expect(enabledTrigger).toHaveClass('hover:enabled:border-input');
    expect(enabledTrigger.className).not.toMatch(/(?:^|\s)hover:border-/);

    view.rerender(
      <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} disabled />,
    );
    const disabledTrigger = screen.getByRole('combobox', { name: 'Client company' });
    expect(disabledTrigger).toBeDisabled();
    expect(disabledTrigger).toHaveClass('hover:enabled:border-input');
    expect(disabledTrigger.className).not.toMatch(/(?:^|\s)hover:border-/);
  });

  it('renders a placeholder + role="combobox" with aria-expanded=false when closed', () => {
    render(
      <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} placeholder="Select a company…" />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Client company' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Select a company…')).toBeInTheDocument();
  });

  it('AC-SI-2 exposes the stable form id on the focusable trigger', () => {
    render(<Combobox id="sales-invoice-form-projectId" label="Project" value={null} onChange={() => {}} loadOptions={loadOk} />);
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveAttribute('id', 'sales-invoice-form-projectId');
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

    await userEvent.type(await screen.findByRole('combobox', { name: /^(search|cari) /i }), 'camden');
    expect(screen.getByRole('option', { name: /Camden Waterworks/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Cascade Port Authority/ })).not.toBeInTheDocument();
  });

  it('explains an empty list and gives a next step, while a search miss suggests another query', async () => {
    render(<Combobox label="Supplier" noun="supplier" value={null} onChange={() => {}} loadOptions={async () => []} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Supplier' }));

    expect(await screen.findByText(/Nothing is available to select yet.*ask an administrator to add an option/i)).toBeInTheDocument();
    const search = await screen.findByRole('combobox', { name: /^(search|cari) /i });
    await userEvent.type(search, 'Northwind');
    expect(await screen.findByText(/No supplier matches "Northwind"\. Try a different search\./i)).toBeInTheDocument();
  });
});

describe('Combobox: disabled while open', () => {
  it('closes the open picker, blocks stale interactions and permits selection after re-enabling', async () => {
    const onChange = vi.fn();
    const props = { label: 'Client company', value: null, onChange, loadOptions: loadOk };
    const view = render(<Combobox {...props} />);
    await userEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /Cascade Port Authority/ });
    const search = await screen.findByRole('combobox', { name: /^(search|cari) /i });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    view.rerender(<Combobox {...props} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(option);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<Combobox {...props} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /Camden Waterworks/ }));
    expect(onChange).toHaveBeenCalledWith('c2', OPTIONS[1]);
  });

  it('disables the clear action with the selected picker', async () => {
    const onClear = vi.fn();
    const view = render(<Combobox label="Client company" value="c1" selectedOption={OPTIONS[0]} onChange={() => {}} loadOptions={loadOk} clearable onClear={onClear} disabled />);
    expect(screen.getByRole('button', { name: /clear option/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /clear option/i }));
    expect(onClear).not.toHaveBeenCalled();
    view.rerender(<Combobox label="Client company" value="c1" selectedOption={OPTIONS[0]} onChange={() => {}} loadOptions={loadOk} clearable onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: /clear option/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('clearWhileDisabled keeps the clear action usable while browsing stays locked (AC-S11-002/004)', async () => {
    const onClear = vi.fn();
    render(<Combobox label="Down payment item" noun="item" value="c1" selectedOption={OPTIONS[0]} onChange={() => {}} loadOptions={loadOk} clearable onClear={onClear} disabled clearWhileDisabled />);
    const clear = screen.getByRole('button', { name: /clear item/i });
    expect(clear).toBeEnabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await userEvent.click(clear);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('discards an in-flight load on disable and reloads after re-enabling', async () => {
    let resolveFirst!: (options: ComboboxOption[]) => void;
    const loadOptions = vi.fn().mockImplementationOnce(() => new Promise<ComboboxOption[]>((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce([OPTIONS[1]]);
    const props = { label: 'Client company', value: null, onChange: vi.fn(), loadOptions };
    const view = render(<Combobox {...props} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByTestId('combo-loading')).toBeInTheDocument();
    view.rerender(<Combobox {...props} disabled />);
    await act(async () => { resolveFirst([OPTIONS[0]]); });
    view.rerender(<Combobox {...props} />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: /Camden Waterworks/ })).toBeVisible();
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

    const search = await screen.findByRole('combobox', { name: /^(search|cari) /i });
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
    fireEvent.keyDown(await screen.findByRole('combobox', { name: /^(search|cari) /i }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('scrolls the active option into view when the active index changes', async () => {
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {});
    try {
      render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} />);
      await userEvent.click(screen.getByRole('combobox'));
      await screen.findByRole('listbox');
      const search = await screen.findByRole('combobox', { name: /^(search|cari) /i });
      fireEvent.keyDown(search, { key: 'ArrowDown' }); // active -> 0
      expect(scrollSpy).toHaveBeenCalled();
    } finally {
      scrollSpy.mockRestore();
    }
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
    await userEvent.type(await screen.findByRole('combobox', { name: /^(search|cari) /i }), 'zzzz');
    expect(screen.getByText(/No .*matches/i)).toBeInTheDocument();
  });

  it('drops a STALE load that resolves after the popover closed (no setState leak, no stale options)', async () => {
    // A load that we resolve manually AFTER closing — its result must be ignored.
    let resolveFn: (v: ComboboxOption[]) => void = () => {};
    const slowLoad = vi.fn(
      () =>
        new Promise<ComboboxOption[]>((res) => {
          resolveFn = res;
        }),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={slowLoad} />);
      // Open -> kicks off the load (still pending).
      await userEvent.click(screen.getByRole('combobox'));
      expect(await screen.findByTestId('combo-loading')).toBeInTheDocument();

      // Close before the load resolves (Escape).
      fireEvent.keyDown(await screen.findByRole('combobox', { name: /^(search|cari) /i }), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

      // The stale promise resolves now — its result must be dropped.
      resolveFn(OPTIONS);
      // Give microtasks a chance to flush, then assert nothing leaked.
      await Promise.resolve();
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
      // No "can't update state on an unmounted/closed component" warning.
      expect(errSpy).not.toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('reloads when loadOptions changes while open (async source data arrives after an initial empty load)', async () => {
    // Regression (AC-PRJ-001): the FK source (useClientCompanies) may resolve to []
    // on the very first open, then populate. If the combobox cached the empty
    // result and never re-loaded, no options would EVER render. Opening before the
    // data source is ready must not permanently strand the picker empty.
    // The source populates asynchronously (the React Query data resolving), NOT via
    // a user click — so the popover stays open the whole time.
    let populate: () => void = () => {};
    const Harness: React.FC = () => {
      const [opts, setOpts] = React.useState<ComboboxOption[]>([]);
      populate = () => setOpts(OPTIONS);
      // Identity changes whenever `opts` changes, mirroring the inline loader the
      // form passes (recreated each render off the live query data).
      const loadOptions = React.useCallback(() => Promise.resolve(opts), [opts]);
      return <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOptions} />;
    };
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox'));
    // First load resolves empty -> the empty message, NOT options.
    expect(await screen.findByText(/Nothing is available to select yet.*ask an administrator to add an option/i)).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    // The data source populates while the popover is still open (async, no click).
    await act(async () => {
      populate();
    });

    // GOAL: the combobox re-loads and now renders the options (no reopen needed).
    await screen.findByRole('option', { name: /Cascade Port Authority/ });
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

describe('Combobox: long sub-lines preserve the option text', () => {
  it('keeps the complete sub-line and label available', async () => {
    const sub = 'VoltEdge Inverters · Purchase Order · different supplier · different currency';
    render(
      <Combobox
        label="Purchase"
        value={null}
        onChange={() => {}}
        loadOptions={() => Promise.resolve([{ value: 'p1', label: 'Central Inverters & Transformers', sub }])}
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /Central Inverters/ });
    const subEl = option.querySelector(`[title="${sub}"]`);
    expect(subEl).not.toBeNull();
    expect(subEl).toHaveTextContent(sub);
    expect(option).toHaveTextContent('Central Inverters & Transformers');
  });
});

// ---------------------------------------------------------------------------
// #2044 perf acceptance: "1,000 options → ≤~100 in DOM". The library filters the
// FULL set and renders at most MAX_RENDERED_OPTIONS matches, so a big FK list
// stays cheap without losing reachability: typing still finds option #1000.
// ---------------------------------------------------------------------------
const MANY_OPTIONS: ComboboxOption[] = Array.from({ length: 1000 }, (_, i) => ({
  value: `o${i}`,
  label: `Option ${String(i).padStart(4, '0')}`,
}));
// The match sits far beyond the rendered cap.
const FAR_OPTION: ComboboxOption = { value: 'z1', label: 'Zebra Holdings' };
const THOUSAND: ComboboxOption[] = [...MANY_OPTIONS, FAR_OPTION];

describe('Combobox: large lists render a capped page of options (#2044 perf acceptance)', () => {
  it('renders at most 100 of 1,000 options and tells the user how many more there are', async () => {
    render(
      <Combobox label="Client company" value={null} onChange={() => {}} loadOptions={() => Promise.resolve(MANY_OPTIONS)} />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');

    const rendered = await screen.findAllByRole('option');
    expect(rendered.length).toBeLessThanOrEqual(100);
    expect(rendered.length).toBe(100);
    // The user is told the list continues, so a capped page never reads as "this is all".
    expect(screen.getByText(/type to narrow \(900 more\)/i)).toBeInTheDocument();
  });

  it('the cap never truncates the SEARCH: an option past the cap is still found by typing', async () => {
    const onChange = vi.fn();
    render(
      <Combobox label="Client company" value={null} onChange={onChange} loadOptions={() => Promise.resolve(THOUSAND)} />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findAllByRole('option');

    await userEvent.type(await screen.findByRole('combobox', { name: /^(search|cari) /i }), 'zebra');
    const matches = await screen.findAllByRole('option');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toHaveTextContent('Zebra Holdings');
    // Narrowing below the cap drops the "more" note.
    expect(screen.queryByText(/type to narrow/i)).not.toBeInTheDocument();

    await userEvent.click(matches[0]);
    expect(onChange).toHaveBeenCalledWith('z1', FAR_OPTION);
  });

  it('a list at or under the cap renders every option with no "more" note', async () => {
    render(<Combobox label="Client company" value={null} onChange={() => {}} loadOptions={loadOk} />);
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');
    expect(await screen.findAllByRole('option')).toHaveLength(OPTIONS.length);
    expect(screen.queryByText(/type to narrow/i)).not.toBeInTheDocument();
  });
});

describe('short-name project picker disclosure (AC-002 #1325)', () => {
  it('keeps the contractual title on the selected trigger when the alias is visible', () => {
    render(<Combobox label="Project" value="p1" selectedOption={{ value: 'p1', label: 'Depot', sub: 'Contractual Project Name' }} onChange={() => {}} loadOptions={loadOk} />);
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveAttribute('title', 'Depot — Contractual Project Name');
    expect(screen.getByText('Depot')).toBeInTheDocument();
  });
});
