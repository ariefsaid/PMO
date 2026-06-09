import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import PlaceholderPage from './PlaceholderPage';

// Matches any emoji / pictographic codepoint (incl. the legacy 🏗️ tell).
const EMOJI = /\p{Extended_Pictographic}/u;

// PlaceholderPage now uses react-router <Link> for the back action, so all renders
// need a MemoryRouter context (B-10 addition — added router wrapper here).
const renderPage = (title: string) =>
  render(
    <MemoryRouter>
      <PlaceholderPage title={title} />
    </MemoryRouter>,
  );

describe('PlaceholderPage (C5 — calm on-brand empty state)', () => {
  it('C5/AS-1: renders no emoji in any markup', () => {
    const { container } = renderPage('Tasks');
    expect(container.textContent ?? '').not.toMatch(EMOJI);
    expect(container.innerHTML).not.toMatch(EMOJI);
  });

  it('C5/AS-2: renders the design-system empty state — icon tile + heading + sub', () => {
    const { container } = renderPage('Reports');
    // the DS empty-state icon tile (52px secondary tile)
    expect(container.querySelector('.size-\\[52px\\]')).not.toBeNull();
    // the page title as the heading
    expect(screen.getByText('Reports')).toBeInTheDocument();
    // a concrete supporting line in the muted sub style (no buzzword aphorism)
    const sub = screen.getByText(/Reporting arrives in a later release\./i);
    expect(sub).toBeInTheDocument();
    expect(sub.className).toContain('text-muted-foreground');
  });

  it('C5/AS-3: the supporting copy is concrete, with no em-dash placeholder', () => {
    const { container } = renderPage('Companies');
    const text = container.textContent ?? '';
    expect(text).not.toContain('—'); // no em-dash
    expect(text).not.toContain('under construction'); // the old vague copy
  });

  it('C5/AS-8: uses no legacy text-gray-* / dark: utility classes', () => {
    const { container } = renderPage('Work Orders');
    const html = container.innerHTML;
    expect(html).not.toContain('text-gray-');
    expect(html).not.toContain('dark:');
  });

  it('C5: renders no action button (nothing to do yet)', () => {
    renderPage('Administration');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('C5: distinct titles render distinct headings', () => {
    const { rerender } = render(
      <MemoryRouter>
        <PlaceholderPage title="Tasks" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <PlaceholderPage title="Administration" />
      </MemoryRouter>,
    );
    expect(screen.getByText('Administration')).toBeInTheDocument();
  });
});
