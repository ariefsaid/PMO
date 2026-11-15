import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TFunction } from 'i18next';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { figureAgreementFixture } from '@/src/test/fixtures/figureAgreement';
import { projectTableColumns } from './projectTableColumns';

/** #design-1115 round 3: the Project cell's clauses and the Contract column's shared tax basis. */
const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/gu, (_m, name: string) => String(values?.[name] ?? ''))) as unknown as TFunction;
const project = {
  ...figureAgreementFixture.projects.primary,
  pmo_project_number: 'PRJ-26-0002',
  client: { id: 'company-figure-client', name: 'Cascade Foods Processing' },
  end_client: { id: 'company-end', name: 'Harbour Authority' },
} as unknown as ProjectWithRefs;
const columnsFor = (rows: ProjectWithRefs[]) => projectTableColumns({
  filtered: rows, deliverySummary: {}, deliveryPending: false, deliveryError: false,
  projectMoney: {}, moneyPending: false, moneyError: false, canViewMoney: true,
  viewerId: null, isAtRiskActual: () => false, onOpen: vi.fn(), t,
});

describe('Projects list columns', () => {
  it('keeps every separator with the clause after it, so a line never ends on "·"', () => {
    const projectColumn = columnsFor([project]).tableColumns.find((column) => column.key === 'project')!;
    render(<MemoryRouter>{projectColumn.secondaryCell!(project)}</MemoryRouter>);
    expect(screen.getByTitle('PRJ-26-0002 · S01-001').parentElement?.textContent).toMatch(/^·\u00a0/u);
    expect(screen.getByText(/Harbour Authority/u).textContent).toMatch(/^·\u00a0Harbour Authority$/u);
  });

  it('fits the 1440 track when the Project manager column shows, so the list never scrolls sideways', () => {
    const other = { ...project, id: 'project-other', project_manager_id: 'user-other', pm: { id: 'user-other', full_name: 'Other Manager' } } as unknown as ProjectWithRefs;
    const { tableColumns } = columnsFor([project, other]);
    expect(tableColumns.some((column) => column.key === 'pm')).toBe(true);
    expect(tableColumns.reduce((sum, column) => sum + (column.size ?? 0), 0)).toBeLessThanOrEqual(1120);
  });

  it('names the shared tax basis on the Contract header for screen readers and in the export', () => {
    const { tableColumns, exportColumns } = columnsFor([project]);
    render(<>{tableColumns.find((column) => column.key === 'contract')!.header}</>);
    expect(document.body.textContent?.replace(/\s+/gu, ' ')).toContain('Contract (excl. PPN)');
    expect(exportColumns.find((column) => column.key === 'contract')?.header).toBe('Contract (excl. PPN)');
  });
});
