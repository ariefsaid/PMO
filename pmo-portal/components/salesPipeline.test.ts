import { describe, it, expect, vi } from 'vitest';
import {
  SALES_COLUMNS,
  weightedValue,
  pillVariantForStatus,
  openOpportunity,
  dealJourneySteps,
  formatPercent,
} from './salesPipeline';
import type { PipelineProject } from '@/src/lib/db/dashboard';

const project = (over: Partial<PipelineProject> = {}): PipelineProject => ({
  id: 'p1',
  name: 'Northwind ERP',
  client_name: 'Northwind',
  status: 'Tender Submitted',
  contract_value: 1_200_000,
  win_probability: 0.5,
  ...over,
});

describe('salesPipeline presentation helpers (AC-SP-204)', () => {
  it('AC-SP-204: SALES_COLUMNS are the six fixed columns in OD-SP-1 order with one terminal Won/Lost column', () => {
    expect(SALES_COLUMNS.map((c) => c.title)).toEqual([
      'Leads',
      'Pre-Qual',
      'Quotation',
      'Tender',
      'Negotiation',
      'Won / Lost',
    ]);
    // the terminal column matches BOTH won + lost statuses (Director decision 7)
    const terminal = SALES_COLUMNS[5];
    expect(terminal.terminal).toBe(true);
    expect(terminal.statuses).toContain('Won, Pending KoM');
    expect(terminal.statuses).toContain('Loss Tender');
    // only the terminal column is flagged terminal (funnel excludes exactly one)
    expect(SALES_COLUMNS.filter((c) => c.terminal)).toHaveLength(1);
    // open columns map to exactly one pipeline status each
    expect(SALES_COLUMNS[3].statuses).toEqual(['Tender Submitted']);
  });

  it('C2: every dotColor is a DESIGN.md token (no off-palette cyan/orange literals)', () => {
    for (const col of SALES_COLUMNS) {
      expect(col.dotColor).toMatch(/^hsl\(var\(--/);
    }
    // the off-palette cyan (Quotation) and orange (Negotiation) are gone
    const colors = SALES_COLUMNS.map((c) => c.dotColor);
    expect(colors).not.toContain('hsl(199 89% 48%)'); // cyan
    expect(colors).not.toContain('hsl(25 95% 53%)'); // orange
    expect(colors).not.toContain('hsl(262 83% 58%)'); // categorical violet (was Pre-Qual)
  });

  it('C2: calm neutral upstream, exactly one --primary open stage (active), success terminal', () => {
    // upstream open stages are quiet neutral; Negotiation (closest-to-close) is
    // the single blue accent on the band (One Blue Rule); terminal is success.
    expect(SALES_COLUMNS[0].dotColor).toBe('hsl(var(--muted-foreground))'); // Leads
    expect(SALES_COLUMNS[1].dotColor).toBe('hsl(var(--muted-foreground))'); // Pre-Qual
    expect(SALES_COLUMNS[2].dotColor).toBe('hsl(var(--muted-foreground))'); // Quotation
    expect(SALES_COLUMNS[3].dotColor).toBe('hsl(var(--muted-foreground))'); // Tender
    expect(SALES_COLUMNS[4].dotColor).toBe('hsl(var(--primary))'); // Negotiation (active)
    expect(SALES_COLUMNS[5].dotColor).toBe('hsl(var(--success))'); // Won/Lost terminal
    // exactly one OPEN column carries the blue accent
    const openPrimary = SALES_COLUMNS.filter(
      (c) => !c.terminal && c.dotColor === 'hsl(var(--primary))',
    );
    expect(openPrimary).toHaveLength(1);
  });

  it('AC-SP-204: weightedValue multiplies contract_value by win_probability (computed client-side)', () => {
    expect(weightedValue(project())).toBe(600_000);
    expect(weightedValue(project({ contract_value: 800_000, win_probability: 0.25 }))).toBe(200_000);
    expect(weightedValue(project({ win_probability: 0 }))).toBe(0);
  });

  it('AC-SP-204: pillVariantForStatus maps groups → open / won / lost', () => {
    expect(pillVariantForStatus('Tender Submitted')).toBe('open');
    expect(pillVariantForStatus('Won, Pending KoM')).toBe('won');
    expect(pillVariantForStatus('Loss Tender')).toBe('lost');
  });

  it('AC-SP-207: openOpportunity opens a record tab with the human label, code and module', () => {
    const openRecord = vi.fn();
    openOpportunity({ openRecord } as never, project({ id: 'abc', name: 'Acme Deal' }));
    expect(openRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sales:abc',
        kind: 'record',
        path: '/sales/abc',
        icon: 'pipe',
        label: 'Acme Deal',
        code: 'abc',
        module: 'sales',
      }),
    );
  });

  it('AC-SP-208: dealJourneySteps marks done/current/upcoming from the pipeline index', () => {
    const steps = dealJourneySteps('Quotation Submitted');
    // Leads, PQ done; Quotation current; Tender, Negotiation upcoming
    expect(steps.map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ]);
  });

  it('AC-SP-208: dealJourneySteps marks the won deal as terminal done (paid)', () => {
    const steps = dealJourneySteps('Won, Pending KoM');
    expect(steps[steps.length - 1].state).toBe('paid');
    expect(steps.slice(0, 5).every((s) => s.state === 'done')).toBe(true);
  });

  it('AC-SP-208: dealJourneySteps marks the lost deal as terminal skipped', () => {
    const steps = dealJourneySteps('Loss Tender');
    expect(steps[steps.length - 1].state).toBe('skipped');
  });

  it('AC-SP-205: formatPercent renders the RPC probability as a whole-number percent', () => {
    expect(formatPercent(0.5)).toBe('50%');
    expect(formatPercent(0.25)).toBe('25%');
    expect(formatPercent(0)).toBe('0%');
  });
});
