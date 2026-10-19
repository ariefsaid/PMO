import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({
  searchHook: vi.fn((_query: string, _options: { enabled: boolean }) => ({
    data: undefined as {
      items: Array<{
        kind: 'project' | 'invoice' | 'receipt';
        id: string;
        title: string;
        context: string | null;
        reference: string;
        aliases: string[];
        exact: boolean;
      }>;
      hasMore: boolean;
    } | undefined,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  })),
  navigate: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('react-router', async (importOriginal) => ({
  ...await importOriginal(),
  useNavigate: () => state.navigate,
}));
vi.mock('@/src/hooks/useReferenceRecordSearch', () => ({
  useReferenceRecordSearch: state.searchHook,
}));

import { CommandPalette, type PaletteItem } from '../CommandPalette';

const items: PaletteItem[] = [
  { id: 'nav-sales', group: 'Navigate', title: 'Sales Pipeline', icon: 'pipe', run: vi.fn() },
  { id: 'nav-proc', group: 'Navigate', title: 'Procurement', icon: 'cart', run: vi.fn() },
  { id: 'act-new', group: 'Actions', title: 'New project', icon: 'plus', run: vi.fn() },
];

function setReferenceResult(result: {
  data?: ReturnType<typeof referencePage>;
  isFetching?: boolean;
  isError?: boolean;
}) {
  state.searchHook.mockImplementation((query, options) => {
    const eligible = options.enabled && query.trim().length >= 2;
    return {
      data: eligible ? result.data : undefined,
      isFetching: eligible && Boolean(result.isFetching),
      isError: eligible && Boolean(result.isError),
      refetch: state.refetch,
    };
  });
}

function referencePage(...hits: Array<{
  kind: 'project' | 'invoice' | 'receipt';
  id: string;
  title: string;
  context: string | null;
  reference: string;
  aliases: string[];
  exact: boolean;
}>) {
  return { items: hits, hasMore: false };
}

beforeEach(() => {
  state.searchHook.mockReset();
  state.searchHook.mockReturnValue({ data: undefined, isFetching: false, isError: false, refetch: state.refetch });
  state.navigate.mockReset();
  state.refetch.mockReset();
});

describe('CommandPalette', () => {
  it('renders a modal dialog when open', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toMatch(/shadow-\[0_24px_60px_hsl\(var\(--scrim\)\/0\.35\)\]/);
    expect(dialog.className).not.toMatch(/240_10%_4%/);
    expect(screen.getByTestId('cmdk-backdrop').className).toContain('bg-foreground/40');
  });

  it('UXS-006: finds a destination by its localized route label', async () => {
    const run = vi.fn();
    render(
      <CommandPalette
        open
        items={[{
          id: 'nav-companies', group: 'Navigate', title: 'Perusahaan',
          icon: 'companies', run,
        }]}
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByRole('combobox'), 'companies');
    expect(await screen.findByText('Perusahaan')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
  });

  it('UXS-007: shows the assignee-scoped context beneath My Tasks', () => {
    const personalWork: PaletteItem[] = [{
      id: 'nav-my-tasks', group: 'Navigate', title: 'My Tasks',
      sub: 'Your assigned work across projects', icon: 'tasks', run: vi.fn(),
    }];
    render(<CommandPalette open items={personalWork} onClose={vi.fn()} />);
    expect(screen.getByText('My Tasks')).toBeInTheDocument();
    expect(screen.getByText('Your assigned work across projects')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<CommandPalette open={false} items={items} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('typing filters the options (after the debounce)', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'proc');
    // 120ms debounce before the filter applies.
    expect(await screen.findByText('Procurement')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Sales Pipeline')).not.toBeInTheDocument()
    );
  });

  it('ArrowDown moves aria-selected; Enter runs the selected item', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onClose={onClose} />);
    // first option is selected by default
    const opts = screen.getAllByRole('option');
    expect(opts[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(items[1].run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc closes', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onClose={onClose} />);
    await userEvent.click(screen.getByTestId('cmdk-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('no-match shows an empty state (after the debounce)', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'zzzzz');
    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
  });

  it('returns focus to the trigger on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(
      <CommandPalette open items={items} onClose={vi.fn()} returnFocusTo={trigger} />
    );
    rerender(<CommandPalette open={false} items={items} onClose={vi.fn()} returnFocusTo={trigger} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  // I1 — active option must carry a clearly-perceptible visible-selection class
  it('I1: active option carries visible-selection class (bg-primary/10) — not just bg-accent', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const opts = screen.getAllByRole('option');
    // First item is selected by default
    expect(opts[0]).toHaveAttribute('aria-selected', 'true');
    // Must have the primary tint class for perceptible contrast, not the invisible accent
    expect(opts[0].className).toMatch(/bg-primary\/10/);
  });

  it('I1: non-active options do NOT carry bg-primary/10', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const opts = screen.getAllByRole('option');
    expect(opts[1]).toHaveAttribute('aria-selected', 'false');
    expect(opts[1].className).not.toMatch(/bg-primary\/10/);
  });

  // ── Phase E: record search states ──────────────────────────────────────────

  // AC-CMDK-004: record lists still fetching → skeleton rows, Navigate still shows.
  it('AC-CMDK-004: loading shows skeleton rows (not a spinner) and Navigate still renders', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} loading />);
    expect(screen.getAllByTestId('cmdk-skeleton-row').length).toBeGreaterThan(0);
    // Navigate group still works during record-list loading (graceful degradation).
    expect(screen.getByText('Sales Pipeline')).toBeInTheDocument();
  });

  // AC-CMDK-005: a record list errored → inline retry note + Navigate still works.
  it('AC-CMDK-005: error shows an inline retry note and Navigate still renders', async () => {
    const onRetry = vi.fn();
    render(<CommandPalette open items={items} onClose={vi.fn()} error onRetry={onRetry} />);
    expect(screen.getByText(/couldn.t load records/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalled();
    // Module navigation is unaffected by the record-list error.
    expect(screen.getByText('Procurement')).toBeInTheDocument();
  });

  // AC-CMDK-006: a group with > cap matches shows 8 rows + a "+N more" footer.
  it('AC-CMDK-006: caps a group at 8 rows and shows a "+N more" footer', async () => {
    const many: PaletteItem[] = Array.from({ length: 11 }, (_, i) => ({
      id: `rec-${i}`,
      group: 'Records',
      title: `Record match ${i}`,
      sub: 'Project',
      icon: 'folder',
      run: vi.fn(),
    }));
    render(<CommandPalette open items={many} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'record match');
    // "+3 more" overflow footer (11 - 8), after the debounce.
    expect(await screen.findByText(/\+3 more/i)).toBeInTheDocument();
    expect(screen.getByText(/refine your search/i)).toBeInTheDocument();
    // Only the cap renders as options.
    const recordOptions = screen
      .getAllByRole('option')
      .filter((o) => /Record match/.test(o.textContent ?? ''));
    expect(recordOptions).toHaveLength(8);
  });

  // AC-CMDK-003: a Records row Enter runs its `run` and closes.
  it('AC-CMDK-003: pressing Enter on a record row runs it and closes', async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const recs: PaletteItem[] = [
      { id: 'rec-1', group: 'Records', title: 'Harbour Expansion', sub: 'Project', code: 'PRJ-0142', icon: 'folder', run },
      ...items,
    ];
    render(<CommandPalette open items={recs} onClose={onClose} />);
    await userEvent.type(screen.getByRole('combobox'), 'harbour');
    // Wait for the debounced filter so the record row is the selected option.
    await screen.findByText('Harbour Expansion');
    await userEvent.keyboard('{Enter}');
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // AC-CMDK-002: exact code match ranks first inside Records, even when a
  // competing substring match is present. Proven against the REAL rendered palette.
  it('AC-CMDK-002: an exact code match renders before a competing substring match', async () => {
    const recs: PaletteItem[] = [
      // Title-substring match for "pr-9": ranks AFTER the exact-code row.
      { id: 'rec-decoy', group: 'Records', title: 'PR-90 staging works', sub: 'Procurement', code: 'PRC-0500', icon: 'cart', run: vi.fn() },
      // Exact code match for "pr-9": must float to the top of Records.
      { id: 'rec-exact', group: 'Records', title: 'Crane hire', sub: 'Procurement', code: 'PR-9', icon: 'cart', run: vi.fn() },
      ...items,
    ];
    render(<CommandPalette open items={recs} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'pr-9');
    // After the debounce both rows match; the exact-code row must be first.
    await screen.findByText('Crane hire');
    const recordOptions = screen
      .getAllByRole('option')
      .filter((o) => /Procurement/.test(o.textContent ?? ''));
    expect(recordOptions).toHaveLength(2);
    expect(recordOptions[0]).toHaveTextContent('Crane hire'); // exact-code first
    expect(recordOptions[1]).toHaveTextContent('PR-90 staging works');
  });

  // a11y: a polite live region announces the result count as the filter narrows.
  it('exposes an aria-live result-count region', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const live = screen.getByTestId('cmdk-live-count');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await userEvent.type(screen.getByRole('combobox'), 'proc');
    await waitFor(() => expect(within(live).getByText(/result/i)).toBeInTheDocument());
  });

  it('AC-S40-004: merges bounded references, retains cached project identity, and ranks the canonical invoice for Enter', async () => {
    setReferenceResult({
      data: referencePage(
        { kind: 'project', id: 'project-1', title: 'Server project duplicate', context: 'Cedar Field Services', reference: 'REF-420', aliases: ['REF-420'], exact: true },
        { kind: 'invoice', id: 'invoice-1', title: 'SI-420', context: 'Cedar Field Services · Harbour Upgrade', reference: 'REF-420', aliases: ['REF-420'], exact: true },
        { kind: 'receipt', id: 'receipt-1', title: 'RCV-420', context: 'Cedar Field Services · Harbour Upgrade', reference: 'REF-420', aliases: ['REF-420'], exact: true },
        { kind: 'project', id: 'project-2', title: 'Pipeline project', context: null, reference: 'REF-420', aliases: ['REF-420'], exact: true },
      ),
    });
    const cachedProjectRun = vi.fn();
    const onClose = vi.fn();
    const cachedProject: PaletteItem = {
      id: 'projects:project-1', group: 'Records', title: 'Cached project', sub: 'Project',
      code: 'Customer order reference: REF-420', searchCodes: ['REF-420'], icon: 'projects', run: cachedProjectRun,
    };
    render(<CommandPalette open items={[cachedProject, ...items]} onClose={onClose} />);

    await userEvent.type(screen.getByRole('combobox'), 'REF-420');
    const invoice = await screen.findByText('SI-420');
    expect(screen.getByText('Cached project')).toBeInTheDocument();
    expect(screen.queryByText('Server project duplicate')).not.toBeInTheDocument();
    expect(screen.getByText('Pipeline project')).toBeInTheDocument();
    expect(screen.getAllByRole('option').filter((option) => option.textContent?.includes('Cached project'))).toHaveLength(1);
    expect(invoice.closest('[role="option"]')).toHaveTextContent('Cedar Field Services');
    expect(invoice.closest('[role="option"]')).toHaveTextContent('REF-420');

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(state.navigate).toHaveBeenCalledWith('/sales-invoices/invoice-1');
    expect(onClose).toHaveBeenCalled();
    expect(cachedProjectRun).not.toHaveBeenCalled();
  });

  it('AC-V24P-016: a server project hit already cached as a pipeline record appears once; distinct hits stay and open their canonical route', async () => {
    const hit = (id: string, title: string) => ({
      kind: 'project' as const, id, title, context: null, reference: 'REF-777', aliases: ['REF-777'], exact: true,
    });
    setReferenceResult({
      data: referencePage(
        hit('p-cached', 'Server copy of cached project'),
        hit('p-distinct', 'Distinct server project'),
        hit('p-distinct', 'Distinct server project'), // same server record repeated
      ),
    });
    const cachedRun = vi.fn();
    const onClose = vi.fn();
    const cachedPipeline: PaletteItem = {
      id: 'sales:p-cached', group: 'Records', title: 'Cached pipeline project', sub: 'Project',
      searchCodes: ['REF-777'], icon: 'projects', run: cachedRun,
    };
    render(<CommandPalette open items={[cachedPipeline, ...items]} onClose={onClose} />);

    await userEvent.type(screen.getByRole('combobox'), 'REF-777');
    await screen.findByText('Distinct server project');

    const rows = screen.getAllByRole('option');
    const count = (text: string) => rows.filter((row) => row.textContent?.includes(text)).length;
    expect(count('Cached pipeline project')).toBe(1);
    expect(count('Server copy of cached project')).toBe(0);
    expect(count('Distinct server project')).toBe(1);

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/projects/p-distinct');
    expect(cachedRun).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-S40-004: wraps long reference labels at word boundaries so identifiers stay readable', async () => {
    setReferenceResult({
      data: referencePage({
        kind: 'invoice', id: 'invoice-mobile', title: 'SI-420', context: 'Northwind Field Services · Harbor renewal',
        reference: 'PO-420', aliases: ['PO-420', 'SI-420', 'CX-420'], exact: true,
      }),
    });
    render(<CommandPalette open items={[]} onClose={vi.fn()} />);

    await userEvent.type(screen.getByRole('combobox'), 'PO-420');
    const invoice = await screen.findByRole('option', { name: /SI-420/ });
    const code = within(invoice).getByTitle('Reference: PO-420 · SI-420 · CX-420');
    expect(code).toHaveTextContent('Reference: PO-420 · SI-420 · CX-420');
    expect(code).toHaveClass('break-words');
    expect(code).not.toHaveClass('break-all');
    for (const identifier of ['PO-420', 'SI-420', 'CX-420']) {
      expect(within(code).getByText(identifier, { exact: true })).toHaveClass('whitespace-nowrap');
    }
  });

  it.each([
    { kind: 'project' as const, id: 'project-7', title: 'North pier project', reference: 'PROJ-7', path: '/projects/project-7' },
    { kind: 'invoice' as const, id: 'invoice-7', title: 'INV-7', reference: 'INV-7', path: '/sales-invoices/invoice-7' },
    { kind: 'receipt' as const, id: 'receipt-7', title: 'RCV-7', reference: 'RCV-7', path: '/incoming-payments/receipt-7' },
  ])('AC-S40-004: activates a $kind reference at its canonical route', async ({ kind, id, title, reference, path }) => {
    setReferenceResult({
      data: referencePage({ kind, id, title, context: 'Cedar Field Services', reference, aliases: [reference], exact: true }),
    });
    render(<CommandPalette open items={[]} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), reference);
    const result = await screen.findByRole('option');
    expect(result.querySelector('.truncate')).toHaveTextContent(title);
    await userEvent.keyboard('{Enter}');
    expect(state.navigate).toHaveBeenCalledWith(path);
  });

  it('AC-S40-004: reports server hasMore separately from local overflow', async () => {
    setReferenceResult({
      data: { ...referencePage({ kind: 'invoice', id: 'invoice-more', title: 'SI-MORE-42', context: null, reference: 'MORE-42', aliases: ['MORE-42'], exact: true }), hasMore: true },
    });
    render(<CommandPalette open items={[]} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'MORE-42');
    expect(await screen.findByText(/More reference matches; refine your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/\+\d+ more/i)).not.toBeInTheDocument();
  });

  it('AC-S40-004: keeps Navigate available during reference loading and retries both failed reads', async () => {
    setReferenceResult({ isFetching: true });
    const onRetry = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<CommandPalette open items={items} onClose={onClose} onRetry={onRetry} />);
    await userEvent.type(screen.getByRole('combobox'), 'sales');
    expect(await screen.findAllByTestId('cmdk-skeleton-row')).toHaveLength(4);
    expect(screen.getByText('Sales Pipeline')).toBeInTheDocument();
    setReferenceResult({ isError: true });
    rerender(<CommandPalette open items={items} onClose={onClose} onRetry={onRetry} />);
    expect(await screen.findByText(/couldn.t load records/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(screen.getByText('Sales Pipeline')).toBeInTheDocument();
  });
});
