import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { projectsToolbar } from './ProjectsToolbar';

vi.mock('@/src/components/export', () => ({ ExportButton: ({ entity }: { entity: string }) => <span data-testid="export-entity">{entity}</span> }));
vi.mock('./ProjectFilterBuilder', () => ({ ProjectFilterBuilder: () => null }));
vi.mock('@/src/components/import', () => ({ ImportButton: () => null }));

describe('project export wording', () => {
  it('uses the translated organisation label for the workbook and filename', () => {
    const model = { all: [], filtered: [], filterLabels: {}, filter: 'All', view: 'table', search: '', setWorkingSet: vi.fn(), setSearch: vi.fn(), onViewChange: vi.fn(), refetch: vi.fn() };
    const t = ((key: string, fallback: string) => key === 'projects.title' ? 'Engagements' : fallback) as never;
    const toolbar = projectsToolbar({ model: model as never, exportColumns: [], t, canViewMoney: false, moreOpen: true, setMoreOpen: vi.fn() });
    render(<>{toolbar.headerControls}{toolbar.mobileToolbar}</>);
    expect(screen.getAllByTestId('export-entity').map((node) => node.textContent)).toEqual(['Engagements', 'Engagements']);
  });
});
