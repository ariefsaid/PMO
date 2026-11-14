import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import SalesKanbanBoard from './SalesKanbanBoard';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { formatCurrency } from '@/src/lib/format';

// FR-L10N-020: the board reads useOrgCurrency for its per-COLUMN totals only — a column total sums
// across deals and has no single record currency. The deal CARDS take each project's own currency
// (0201) and, since #578, its own tax basis (0208). Pinned rather than left to a real
// query. ⚑ At LINE-START on purpose — inserted inside a neighbouring vi.mock call it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

const projects: PipelineProject[] = [
  { id: 'q1', name: 'Quotation Deal Alpha', short_name: null, client_name: 'Acme', status: 'Quotation Submitted', contract_value: 500_000, currency: 'USD', tax_treatment: 'exclusive', go_probability: 0.4, get_probability: 0.25, win_probability: 0.1 },
  { id: 't1', name: 'Tender Deal Bravo', short_name: null, client_name: null, status: 'Tender Submitted', contract_value: 1_200_000, currency: 'USD', tax_treatment: 'inclusive', win_probability: 0.5 },
  { id: 'w1', name: 'Won Deal Charlie', short_name: null, client_name: 'Globex', status: 'Won, Pending KoM', contract_value: 2_000_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 1 },
  { id: 'l1', name: 'Lost Deal Delta', short_name: null, client_name: 'Initech', status: 'Loss Tender', contract_value: 700_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0 },
  // #530 / FR-L10N-020: a mixed-currency pair proves a card renders ITS OWN currency, not the
  // USD org default — a single-currency fixture set cannot tell a record currency from a
  // hardcoded literal (which is exactly how this issue shipped in 0044).
  { id: 'idr1', name: 'IDR Deal', short_name: null, client_name: 'Garuda', status: 'Quotation Submitted', contract_value: 1_234, currency: 'IDR', tax_treatment: 'inclusive', go_probability: 0.4, get_probability: 0.25, win_probability: 0.1 },
  { id: 'usd1', name: 'USD Deal', short_name: null, client_name: 'Acme Corp', status: 'Quotation Submitted', contract_value: 9_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.4 },
  // 0197 permits a NULL basis ONLY at zero value, and OD-TAX-1 says render NOTHING for it rather
  // than invent one. Without this row the "unknown renders nothing" branch has no witness here.
  { id: 'nb1', name: 'Unpriced Deal', short_name: null, client_name: 'Umbrella', status: 'Quotation Submitted', contract_value: 0, currency: 'USD', tax_treatment: null, win_probability: 0.4 },
];

describe('SalesKanbanBoard compact list presentation (AC-S24-002)', () => {
  it('keeps the compact opportunity list first and states the tax basis under it once, with no Chance key', () => {
    render(<SalesKanbanBoard projects={[projects[0]]} onOpen={vi.fn()} presentation="list" selectedStatus={projects[0].status} />);
    const context = screen.getByTestId('sales-phone-figure-context');
    expect(context).toHaveTextContent('excl. PPN');
    const list = screen.getByTestId('sales-phone-stage-list');
    expect(list.firstElementChild).toBeInTheDocument();
    expect(list.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Move 4 (judging): the "Chance" word named a column the board does not have; each row carries
    // its own percent instead.
    expect(screen.queryByText('Chance', { exact: true })).toBeNull();
    const card = screen.getByTestId('project-card');
    expect(within(card).queryByTestId('tax-basis')).toBeNull();
    expect(within(card).queryByText(/chance$/)).toBeNull();
    expect(within(card).getByLabelText(/Chance to win 10%; % Go 40%, % Get 25%/)).toBeInTheDocument();
  });

  it('SUB-H keeps full identity, value, basis and Go/Get estimates visible with no details disclosure', async () => {
    const longProject: PipelineProject = {
      ...projects[4],
      id: 'compact-long-id',
      name: 'Integrated maintenance planning for regional facilities and remote teams',
      short_name: 'Remote teams',
      client_name: 'PT Garuda Regional Infrastructure Services',
      pmo_project_number: 'PMO-26-0042',
      code: 'CLIENT-77',
    };
    const onOpen = vi.fn();
    // The temporary widened type lets this first red prove the new runtime presentation is missing.
    const ListPresentation = SalesKanbanBoard as React.ComponentType<
      React.ComponentProps<typeof SalesKanbanBoard> & { presentation: 'list' }
    >;
    render(<ListPresentation projects={[longProject]} onOpen={onOpen} presentation="list" selectedStatus={longProject.status} />);

    expect(screen.queryByTestId('stage-Tender Submitted')).toBeNull();
    const card = screen.getByTestId('project-card');
    expect(within(card).getByText(longProject.short_name!)).toBeVisible();
    expect(within(card).getByTitle(longProject.name)).toHaveTextContent(longProject.short_name!);
    expect(within(card).getByText(longProject.client_name!)).toBeVisible();
    expect(within(card).queryByText(longProject.status)).toBeNull();
    expect(within(card).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
    expect(within(card).getAllByText((_, node) => node?.textContent?.includes('IDR\u00A01,234') ?? false).length).toBeGreaterThan(0);

    expect(card.querySelector('details')).toBeNull();
    expect(within(card).getByLabelText(/% Go 40%/)).toBeVisible();
    expect(within(card).getByLabelText(/% Get 25%/)).toBeVisible();
    expect(within(card).queryByText(/wtd/)).toBeNull();

    await userEvent.click(within(card).getByRole('button', { name: new RegExp(longProject.short_name!) }));
    expect(onOpen).toHaveBeenCalledWith(longProject);
  });
});

describe('SalesKanbanBoard (AC-SP-204 / AC-IXD-PROJ-007)', () => {
  it('AC-002 #1325: the avatar initial stays the client\'s first letter, not the short name\'s', () => {
    const project = { ...projects[0], name: 'Contractual pipeline deal', short_name: 'Zulu Terminal', client_name: 'Acme' };
    render(<SalesKanbanBoard projects={[project]} onOpen={vi.fn()} />);
    const card = screen.getByTestId('project-card');
    expect(within(card).getByText('A')).toBeInTheDocument();
    expect(within(card).queryByText('Z')).toBeNull();
  });
  it('AC-002 #1325: open pipeline DealCard shows the alias and preserves the contractual title', () => {
    const project = { ...projects[0], name: 'Contractual pipeline deal', short_name: 'North Terminal' };
    render(<SalesKanbanBoard projects={[project]} onOpen={vi.fn()} />);
    const card = screen.getByTestId('project-card');
    expect(within(card).getByText('North Terminal')).toBeVisible();
    expect(within(card).getByTitle('Contractual pipeline deal')).toHaveTextContent('North Terminal');
  });
  // Model B (ADR-0020): the terminal column is split into separate "Won" and "Lost" columns.
  it('AC-IXD-PROJ-007: renders the five open stages + separate terminal Won and Lost columns in fixed order', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const titles = ['Leads', 'PQ submitted', 'Quotation submitted', 'Tender submitted', 'Negotiation', 'Won', 'Lost'];
    for (const t of titles) {
      const col = screen.getByTestId(
        t === 'Won' ? 'stage-Won' : t === 'Lost' ? 'stage-Lost' : `stage-${t === 'PQ submitted' ? 'PQ Submitted' : t === 'Quotation submitted' ? 'Quotation Submitted' : t === 'Tender submitted' ? 'Tender Submitted' : t}`,
      );
      // The column title is the first match in its column; a lost card's status pill also reads "Lost".
      expect(within(col).getAllByText(t, { exact: true })[0]).toBeInTheDocument();
    }
  });

  it('floor #31: tapping a stage indicator scrolls its stage into view', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollTo,
    });
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);

    const targetColumn = screen.getByTestId('stage-Negotiation');
    Object.defineProperty(targetColumn, 'offsetLeft', { configurable: true, value: 987 });
    const stageNavigation = screen.getByRole('navigation', { name: 'Pipeline stage navigation' });
    const target = within(stageNavigation).getByRole('button', { name: 'Negotiation' });

    await userEvent.click(target);

    expect(scrollTo).toHaveBeenCalledWith({ left: 987, behavior: 'smooth' });
    expect(target).toHaveAttribute('aria-current', 'true');
  });

  it('CW-3b: each deal renders the shared canonical ProjectCardShell (one project-card vocabulary)', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    // The shared shell stamps every card with the canonical `project-card` testid — the SAME
    // molecule the Projects cards-view and Projects kanban use, so a project looks identical
    // wherever it appears.
    const cards = screen.getAllByTestId('project-card');
    expect(cards).toHaveLength(projects.length);
  });

  it('AC-IXD-PROJ-007: a lost deal lands in the terminal "Lost" column, not the "Won" column', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const lostCol = screen.getByTestId('stage-Lost');
    expect(within(lostCol).getByText('Lost Deal Delta')).toBeInTheDocument();
    expect(within(screen.getByTestId('stage-Won')).queryByText('Lost Deal Delta')).toBeNull();
  });

  // #774: Declined shares the closed Lost column but is counted separately.
  it('AC-DEC-001: the Lost column shows Lost and Declined counts separately', () => {
    const withDeclined: PipelineProject[] = [
      ...projects,
      { id: 'dc1', name: 'Declined Deal Echo', short_name: null, client_name: 'Echo', status: 'Declined', contract_value: 300_000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0 },
    ];
    render(<SalesKanbanBoard projects={withDeclined} onOpen={vi.fn()} />);
    const lostCol = screen.getByTestId('stage-Lost');
    expect(within(lostCol).getByText('Declined Deal Echo')).toBeInTheDocument();
    expect(within(lostCol).getByTestId('lost-column-counts')).toHaveTextContent('Lost 1 · Declined 1');
  });

  it('AC-SP-204: a Quotation deal renders name, customer, value and Go/Get (no weighted chip, SUB-H)', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const card = screen.getByText('Quotation Deal Alpha').closest('[role="button"]')!;
    const c = within(card as HTMLElement);
    expect(c.getByText('Acme')).toBeInTheDocument();
    expect(c.getByText(formatCurrency(500_000, 'USD'))).toBeInTheDocument();
    expect(c.queryByText(/wtd/)).toBeNull();
    // Independent probability inputs from the RPC, not a single hard-coded legacy win percentage.
    expect(c.getByLabelText(/% Go 40%/)).toBeInTheDocument();
    expect(c.getByLabelText(/% Get 25%/)).toBeInTheDocument();
  });

  it('AC-SP-204: a deal with no customer renders an em-dash, never blank', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const card = screen.getByText('Tender Deal Bravo').closest('[role="button"]')!;
    const customerPlaceholder = within(card as HTMLElement).getAllByText('—')[0];
    const value = within(card as HTMLElement).getByText(formatCurrency(projects[1].contract_value, projects[1].currency));
    expect(customerPlaceholder).toBeVisible();
    expect(customerPlaceholder.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps stage context and the assigned project manager ahead of the deal value', () => {
    const assigned = {
      ...projects[0],
      id: 'pm-stage-context',
      pm_name: 'Assigned PM',
      stage_started_at: '2026-10-12T00:00:00+00:00',
    };
    render(<SalesKanbanBoard projects={[assigned]} onOpen={vi.fn()} />);

    const card = within(screen.getByText(assigned.name).closest('[data-testid="project-card"]') as HTMLElement);
    const stage = card.getByTestId('stage-line-pm-stage-context');
    const manager = card.getByText('Assigned PM');
    const value = card.getByText(formatCurrency(assigned.contract_value, assigned.currency));

    expect(stage).toBeInTheDocument();
    expect(manager).toBeInTheDocument();
    expect(value).toBeInTheDocument();
    expect(stage.compareDocumentPosition(manager) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(manager.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('AC-SP-204: clicking a card calls onOpen with the row', () => {
    const onOpen = vi.fn();
    render(<SalesKanbanBoard projects={projects} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Tender Deal Bravo').closest('[role="button"]')!);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('AC-SP-204: an empty column shows the per-stage empty message', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    expect(screen.getByText('No projects in Leads')).toBeInTheDocument();
  });

  it('AC-SP-204: a won deal shows a won status pill and lands in the terminal Won column', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const wonCol = screen.getByTestId('stage-Won');
    const card = within(wonCol).getByText('Won Deal Charlie').closest('[role="button"]')!;
    expect(within(card as HTMLElement).getByText('Won, pending kickoff')).toBeInTheDocument();
  });

  it('AC-1441: warns on open bids after 90 stage-days in both board and phone list cards', () => {
    const staleOpen: PipelineProject = {
      ...projects[0],
      id: 'stale-open-1',
      stage_started_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const board = render(<SalesKanbanBoard projects={[staleOpen, projects[2]]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('stale-bid-stale-open-1')).toHaveTextContent(/90\+ days/i);
    expect(screen.queryByTestId('stale-bid-w1')).toBeNull();
    board.unmount();

    const CompactBoard = SalesKanbanBoard as React.ComponentType<
      React.ComponentProps<typeof SalesKanbanBoard> & { presentation: 'list' }
    >;
    const { unmount } = render(<CompactBoard projects={[staleOpen]} onOpen={vi.fn()} presentation="list" />);
    expect(screen.getByTestId('stale-bid-stale-open-1')).toBeVisible();
    unmount();
  });

  it('C2: every rendered stage-column dot is a DESIGN.md token (no raw cyan/orange literal)', () => {
    const { container } = render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const dots = Array.from(
      container.querySelectorAll<HTMLElement>('span.size-\\[9px\\].rounded-full'),
    );
    // one column-head dot per stage (6 columns)
    expect(dots.length).toBeGreaterThanOrEqual(6);
    const backgrounds = dots.map((d) => d.style.background);
    for (const bg of backgrounds) {
      expect(bg).toMatch(/^hsl\(var\(--/);
    }
    expect(backgrounds.some((b) => b.includes('hsl(199'))).toBe(false); // no cyan
    expect(backgrounds.some((b) => b.includes('hsl(25 95'))).toBe(false); // no orange
  });

  it('AC-1117 / SUB-H: an open column header keeps its count; the stage value lives once, in the funnel', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    const tender = screen.getByTestId('stage-Tender Submitted');
    expect(within(tender).queryByText(/wtd/)).toBeNull();
    expect(within(tender).getByText('1')).toBeInTheDocument();
  });

  it('#530 / AC-L10N-020: cards render each deal in its own currency, not the USD org default', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    // IDR card: shows the code-style NBSP currency (U+00A0, Intl en-US separates a code-style
    // currency with a non-breaking space), and NO dollar sign. We assert on the RAW node text
    // content for the NBSP — getByText's default normalizer collapses NBSP to a space before
    // comparing, so a plain-space assertion could be satisfied by a hardcoded "IDR 1,234".
    const idrCard = screen.getByText('IDR Deal').closest('[role="button"]')!;
    const idr = within(idrCard as HTMLElement);
    // SOME element inside the card carries the raw NBSP currency (the value span and its
    // ancestors both contain it in textContent, so this is a presence check, not unique-node).
    expect(
      idr.getAllByText((_, node) => node?.textContent?.includes('IDR\u00A01,234') ?? false)
        .length,
    ).toBeGreaterThan(0);
    expect(idr.queryByText(/\$/)).toBeNull();
    // USD card (same column, same board): renders its own dollar value and NO IDR.
    const usdCard = screen.getByText('USD Deal').closest('[role="button"]')!;
    const usd = within(usdCard as HTMLElement);
    expect(usd.getByText('$9,000')).toBeInTheDocument();
    expect(usd.queryByText(/IDR/)).toBeNull();
  });
});

// ⚑ OD-TAX-1 §2 on the pipeline board (#578). The two assertions below are deliberately keyed to
// DIFFERENT deals with DIFFERENT bases: a fixture where every card shares one treatment cannot
// tell a rendered value from a hardcoded literal, which is exactly how the currency gap shipped in
// 0044 and how #566's drawdown label passed 26 tests while hardcoded.
describe('OD-TAX-1 §2: the pipeline board states shared tax basis once (#578)', () => {
  // ⚑ NO FALLBACK CHAIN, deliberately. An earlier version fell back to `closest('article')` and
  // then `parentElement` — and those dead branches were not harmless: rename the card testid and
  // the scope silently collapses to the <span> holding the deal name, where queryByTestId is null
  // whatever the app renders. The POSITIVE oracle goes red and gets fixed; the NEGATIVE one below
  // goes on passing for the wrong reason. A missing card must throw here instead.
  const cardFor = (name: string) =>
    screen.getByText(name).closest('[data-testid="project-card"]') as HTMLElement;

  it('AC-TAX-309: states a shared exclusive basis once for the page (the band caption) and labels inclusive rows here', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    expect(within(cardFor('Tender Deal Bravo')).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
    // Move 4: the shared word and the "Chance" header no longer float over the board — the word is
    // stated once in the pipeline band's caption (page test AC-TAX-309), the header is dropped
    // because each card carries its own percent.
    expect(screen.queryByText('excl. PPN', { exact: true })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Board figure context' })).toBeNull();
    expect(screen.queryByText('Chance', { exact: true })).toBeNull();
    expect(within(cardFor('Quotation Deal Alpha')).queryByTestId('tax-basis')).toBeNull();
    expect(within(cardFor('Won Deal Charlie')).queryByTestId('tax-basis')).toBeNull();
    expect(within(cardFor('Lost Deal Delta')).queryByTestId('tax-basis')).toBeNull();
    expect(within(cardFor('Tender Deal Bravo')).queryByText(/chance$/)).toBeNull();
  });

  it('AC-TAX-310: renders NOTHING for a deal whose basis is unknown — a guess would be a claim the row does not make', () => {
    render(<SalesKanbanBoard projects={projects} onOpen={vi.fn()} />);
    expect(within(cardFor('Unpriced Deal')).queryByTestId('tax-basis')).toBeNull();
  });

  it('keeps row-level basis labels when a priced row has no tax treatment', () => {
    const unknown = { ...projects[0], id: 'unknown-priced', name: 'Unknown priced deal', contract_value: 100, tax_treatment: null };
    render(<SalesKanbanBoard projects={[projects[0], unknown]} onOpen={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Board figure context' })).toBeNull();
    expect(within(cardFor('Quotation Deal Alpha')).getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'exclusive');
  });
});

// One percent sign, not two. The badge template carries the "%", so the number it is given must
// not already include one — every card and phone row read "2.5%%" before this.
describe('the chance badge states the percent once', () => {
  const lowChance = (id: string, name: string): PipelineProject => ({
    ...projects[0], id, name, go_probability: 0.1, get_probability: 0.25,
  });

  it('reads "2.5%" on a board card, with the same number in its accessible name', () => {
    render(<SalesKanbanBoard projects={[lowChance('chance-card', 'Low chance deal')]} onOpen={vi.fn()} />);
    const badge = within(screen.getByText('Low chance deal').closest('[data-testid="project-card"]') as HTMLElement)
      .getByLabelText(/^Chance to win 2\.5%/);
    expect(badge.textContent).toBe('2.5%');
  });

  it('reads "2.5%" on the phone list row', () => {
    const CompactBoard = SalesKanbanBoard as React.ComponentType<
      React.ComponentProps<typeof SalesKanbanBoard> & { presentation: 'list' }
    >;
    render(<CompactBoard projects={[lowChance('chance-row', 'Low chance row')]} onOpen={vi.fn()} presentation="list" />);
    const badge = within(screen.getByTestId('project-card')).getByLabelText(/^Chance to win 2\.5%/);
    expect(badge.textContent).toBe('2.5%');
  });
});

describe('SalesKanbanBoard stage line + Signed pill (#1638)', () => {
  beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-11-01T05:00:00Z'), toFake: ['Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('AC-PSH-011: an open deal card shows one stage line for its latest entry', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[0], id: 'd1', stage_started_at: '2026-10-12T00:00:00+00:00' }]} onOpen={vi.fn()} />);
    const lines = screen.getAllByTestId('stage-line-d1');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('Quoted 12 Oct · 20 d');
  });
  it('AC-PSH-011: a lost deal dates its line from the decision', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[3], id: 'l9', decided_at: '2026-10-04T02:00:00+00:00' }]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('stage-line-l9')).toHaveTextContent('Lost 04 Oct · 28 d');
  });
  it('AC-PSH-012: a won deal shows a Signed pill with its contract date and no stage line', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[2], id: 'w1', contract_date: '2026-09-03', stage_started_at: '2026-09-03T00:00:00+00:00' }]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('signed-pill-w1')).toHaveTextContent('Signed 03 Sep');
    expect(screen.queryByTestId('stage-line-w1')).toBeNull();
  });
  it('AC-PSH-012: a won deal without a contract date shows "Signed" alone', () => {
    render(<SalesKanbanBoard projects={[{ ...projects[2], id: 'w2', status: 'Ongoing Project', contract_date: null }]} onOpen={vi.fn()} />);
    expect(screen.getByTestId('signed-pill-w2')).toHaveTextContent(/^Signed$/);
  });
});
