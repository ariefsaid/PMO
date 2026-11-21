import { describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
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
const columnsFor = (rows: ProjectWithRefs[], onOpen = vi.fn(), onPrefetch = vi.fn()) => projectTableColumns({
  filtered: rows, deliverySummary: {}, deliveryPending: false, deliveryError: false,
  projectMoney: {}, moneyPending: false, moneyError: false, canViewMoney: true,
  viewerId: null, isAtRiskActual: () => false, onOpen, onPrefetch, t,
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
    // The 1440 data track: 1440 − 224 sidebar − 2 × 24 gutters − 2 border − 40 row menu = 1126 px.
    expect(tableColumns.reduce((sum, column) => sum + Math.max(column.size ?? 0, column.key === 'project' ? 240 : 0), 0)).toBeLessThanOrEqual(1126);
  });

  it('names the shared tax basis on the Contract header for screen readers and in the export', () => {
    const { tableColumns, exportColumns } = columnsFor([project]);
    render(<>{tableColumns.find((column) => column.key === 'contract')!.header}</>);
    expect(document.body.textContent?.replace(/\s+/gu, ' ')).toContain('Contract (excl. PPN)');
    expect(exportColumns.find((column) => column.key === 'contract')?.header).toBe('Contract (excl. PPN)');
  });

  it('AC-2077 project name is a real record link while plain click preserves the existing list-return action', () => {
    const onOpen = vi.fn();
    const onPrefetch = vi.fn();
    const projectColumn = columnsFor([project], onOpen, onPrefetch).tableColumns.find((column) => column.key === 'project')!;
    const { container } = render(
      <MemoryRouter initialEntries={['/projects']}>
        <div>{projectColumn.cell(project)}</div>
        <div>{projectColumn.secondaryCell!(project)}</div>
      </MemoryRouter>,
    );

    const nameLink = container.querySelector<HTMLAnchorElement>(`a[href="/projects/${project.id}"]`)!;
    expect(nameLink).toBeInTheDocument();
    expect(nameLink).toHaveAttribute('data-list-return-focus', `projects:${project.id}`);
    expect(nameLink.querySelector('a')).toBeNull();
    expect(container.querySelector(`a[href="/companies/${project.client_id}"]`)).not.toBeNull();
    expect(nameLink.contains(container.querySelector(`a[href="/companies/${project.client_id}"]`))).toBe(false);

    fireEvent.pointerEnter(nameLink);
    fireEvent.focus(nameLink);
    expect(onPrefetch).toHaveBeenNthCalledWith(1, project.id);
    expect(onPrefetch).toHaveBeenNthCalledWith(2, project.id);

    const click = createEvent.click(nameLink, { button: 0 });
    fireEvent(nameLink, click);
    expect(click.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(project);

    const modified = createEvent.click(nameLink, { button: 0, metaKey: true });
    fireEvent(nameLink, modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
