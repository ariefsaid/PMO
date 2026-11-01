import { describe, it, expect } from 'vitest';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import {
  matchesPipelineSearch,
  filterPipelineTable,
  filterPipelineBoard,
  DEAL_SCOPES,
} from '../pipelineListModel';

const makeProject = (overrides: Partial<PipelineProject>): PipelineProject => ({
  id: 'p-1',
  name: 'Alpha Energy Expansion',
  short_name: 'AlphaExp',
  status: 'Leads',
  contract_value: 100000,
  currency: 'USD',
  win_probability: 0.1,
  service_line: 'Engineering',
  sector: 'Energy',
  location: 'Jakarta',
  award_type: 'Direct',
  bidding_entity: 'PT Utama',
  pmo_project_number: 'PMO-2026-001',
  code: 'CLIENT-999',
  client_name: 'Pertamina',
  client_legal_name: 'PT Pertamina Persero',
  end_client_name: 'PLN',
  end_client_legal_name: 'PT PLN Persero',
  last_update: '2026-10-01T00:00:00Z',
  pm_name: 'Budi Santoso',
  tax_treatment: null,
  ...overrides,
});

describe('pipelineListModel — search and filtering (THEME-CROSS-76, OE04-004, PGA05-008)', () => {
  it('exposes the standard deal scopes', () => {
    expect(DEAL_SCOPES).toEqual(['Open', 'Won', 'Lost', 'Needs attention']);
  });

  describe('matchesPipelineSearch', () => {
    const project = makeProject({});

    it('returns true when search query is empty', () => {
      expect(matchesPipelineSearch(project, '')).toBe(true);
      expect(matchesPipelineSearch(project, '   ')).toBe(true);
    });

    it.each([
      ['name', 'Alpha Energy'],
      ['short_name', 'AlphaExp'],
      ['pmo_project_number', 'PMO-2026'],
      ['code', 'CLIENT-999'],
      ['client_name', 'Pertamina'],
      ['end_client_name', 'PLN'],
      ['client_legal_name', 'Pertamina Persero'],
      ['end_client_legal_name', 'PLN Persero'],
    ])('matches case-insensitively on %s', (_field, term) => {
      expect(matchesPipelineSearch(project, term.toLowerCase())).toBe(true);
      expect(matchesPipelineSearch(project, term.toUpperCase())).toBe(true);
    });

    it('returns false when no fields match', () => {
      expect(matchesPipelineSearch(project, 'NonexistentTerm')).toBe(false);
    });
  });

  describe('filterPipelineTable', () => {
    const open1 = makeProject({ id: 'o1', status: 'Leads' });
    const open2 = makeProject({ id: 'o2', status: 'Quotation Submitted' });
    const won1 = makeProject({ id: 'w1', status: 'Won, Pending KoM' });
    const lost1 = makeProject({ id: 'l1', status: 'Loss Tender', last_update: '2026-01-01T00:00:00Z' });

    it('filters by Open scope by default', () => {
      const res = filterPipelineTable({
        openProjects: [open1, open2],
        wonProjects: [won1],
        lostProjects: [lost1],
        scope: 'Open',
      });
      expect(res.map((p) => p.id)).toEqual(['o1', 'o2']);
    });

    it('filters by Won scope', () => {
      const res = filterPipelineTable({
        openProjects: [open1, open2],
        wonProjects: [won1],
        lostProjects: [lost1],
        scope: 'Won',
      });
      expect(res.map((p) => p.id)).toEqual(['w1']);
    });

    it('filters by Lost scope', () => {
      const res = filterPipelineTable({
        openProjects: [open1, open2],
        wonProjects: [won1],
        lostProjects: [lost1],
        scope: 'Lost',
      });
      expect(res.map((p) => p.id)).toEqual(['l1']);
    });

    it('filters by funnel stage status when selectedStatus is provided', () => {
      const res = filterPipelineTable({
        openProjects: [open1, open2],
        wonProjects: [won1],
        lostProjects: [lost1],
        scope: 'Open',
        selectedStatus: 'Quotation Submitted',
      });
      expect(res.map((p) => p.id)).toEqual(['o2']);
    });

    it('applies search filter in table scope', () => {
      const res = filterPipelineTable({
        openProjects: [
          makeProject({ id: 'o1', name: 'Alpha Project' }),
          makeProject({ id: 'o2', name: 'Beta Project', short_name: 'BetaExp' }),
        ],
        wonProjects: [],
        lostProjects: [],
        scope: 'Open',
        search: 'Alpha',
      });
      expect(res.map((p) => p.id)).toEqual(['o1']);
    });
  });

  describe('filterPipelineBoard', () => {
    it('unions open, won, and lost projects and applies search across all stages', () => {
      const open = makeProject({ id: 'o1', name: 'Open Deal Beta' });
      const won = makeProject({ id: 'w1', name: 'Won Deal Gamma' });
      const lost = makeProject({ id: 'l1', name: 'Lost Deal Delta' });

      const all = filterPipelineBoard({
        openProjects: [open],
        wonProjects: [won],
        lostProjects: [lost],
      });
      expect(all.map((p) => p.id)).toEqual(['o1', 'w1', 'l1']);

      const searched = filterPipelineBoard({
        openProjects: [open],
        wonProjects: [won],
        lostProjects: [lost],
        search: 'Gamma',
      });
      expect(searched.map((p) => p.id)).toEqual(['w1']);
    });
  });
});
