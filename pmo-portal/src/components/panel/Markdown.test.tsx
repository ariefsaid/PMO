/**
 * Markdown — safe GFM markdown rendering for assistant transcript prose (ADR-0054).
 * FR-AXP-001/002/004.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Markdown } from './Markdown';

function renderMarkdown(text: string) {
  return render(
    <MemoryRouter>
      <Markdown text={text} />
    </MemoryRouter>,
  );
}

describe('Markdown', () => {
  it('AC-AXP-001 assistant markdown renders formatted', () => {
    renderMarkdown('**Done.** Here are the steps:\n\n1. First\n2. Second');

    expect(screen.getByText('Done.').tagName).toBe('STRONG');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.queryByText(/^1\./)).toBeNull();
  });

  it('AC-AXP-002 markdown pipe table renders as table', () => {
    renderMarkdown('| Project | Budget |\n|---|---|\n| Alpha | 100 |');

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.queryByText(/^\| Project/)).toBeNull();
  });

  it('AC-AXP-004 partial streaming markdown does not throw', () => {
    const partial = 'Here:\n\n```ts\nconst x = 1';
    const { rerender } = render(
      <MemoryRouter>
        <Markdown text={partial} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Here:/)).toBeInTheDocument();

    const partialTable = '| A | B |\n|---|';
    expect(() =>
      rerender(
        <MemoryRouter>
          <Markdown text={partialTable} />
        </MemoryRouter>,
      ),
    ).not.toThrow();

    const complete = 'Here:\n\n```ts\nconst x = 1;\n```';
    rerender(
      <MemoryRouter>
        <Markdown text={complete} />
      </MemoryRouter>,
    );
    expect(document.querySelector('pre code')).not.toBeNull();
  });
});
