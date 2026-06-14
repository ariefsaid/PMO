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
  // Model B (ADR-0020, AC-IXD-PROJ-007): the terminal "Won / Lost" column is split into separate
  // "Won" and "Lost" terminal columns so a Loss Tender deal is reachable as its own column.
  it('AC-IXD-PROJ-007: SALES_COLUMNS are the five open stages + separate terminal Won and Lost columns', () => {
    expect(SALES_COLUMNS.map((c) => c.title)).toEqual([
      'Leads',
      'Pre-Qual',
      'Quotation',
      'Tender',
      'Negotiation',
      'Won',
      'Lost',
    ]);
    const won = SALES_COLUMNS.find((c) => c.title === 'Won')!;
    const lost = SALES_COLUMNS.find((c) => c.title === 'Lost')!;
    // Won collects the on-hand statuses; Lost collects ONLY the lost statuses (reachable alone).
    expect(won.terminal).toBe(true);
    expect(won.statuses).toContain('Won, Pending KoM');
    expect(won.statuses).not.toContain('Loss Tender');
    expect(lost.terminal).toBe(true);
    expect(lost.statuses).toEqual(['Loss Tender']);
    expect(lost.testId).toBe('stage-Lost');
    // both terminal columns are excluded from the funnel/weighted totals
    expect(SALES_COLUMNS.filter((c) => c.terminal)).toHaveLength(2);
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
    expect(SALES_COLUMNS.find((c) => c.title === 'Won')!.dotColor).toBe('hsl(var(--success))');
    expect(SALES_COLUMNS.find((c) => c.title === 'Lost')!.dotColor).toBe('hsl(var(--destructive))');
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

  // Freed-Blue Status Rule (CW-2) + ADR-0029: `pillVariantForStatus` now delegates
  // to `workflowVariant` (the registry). Pre-win pipeline statuses map to `draft`
  // (neutral grey, not the old group-derived `progress`). Won → `won`, Lost → `lost`.
  // The distinct stage LABEL carries identity; no status uses the action-blue `open`.
  it('AC-SP-204: pillVariantForStatus maps via registry — draft for pipeline / won / lost (never blue, ADR-0029)', () => {
    expect(pillVariantForStatus('Tender Submitted')).toBe('draft'); // registry: pre-win → draft
    expect(pillVariantForStatus('Tender Submitted')).not.toBe('open');
    expect(pillVariantForStatus('Won, Pending KoM')).toBe('won');
    expect(pillVariantForStatus('Loss Tender')).toBe('lost');
  });

  // Model B (ADR-0020): the deal's canonical detail route is /projects/:id (was /sales/:id).
  it('AC-IXD-PROJ-001: openOpportunity navigates to the canonical /projects/:id detail route', () => {
    const navigate = vi.fn();
    openOpportunity(navigate, project({ id: 'abc', name: 'Acme Deal' }));
    expect(navigate).toHaveBeenCalledWith('/projects/abc');
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
