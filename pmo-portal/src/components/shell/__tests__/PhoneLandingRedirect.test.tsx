/**
 * #2061 — a phone OPENS on the my-queue Home; desktop keeps today's landing, and every other URL
 * (a deep link to a record, a report, anything with an id) is never redirected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { PhoneLandingRedirect } from '../PhoneLandingRedirect';

const state = vi.hoisted(() => ({ narrow: true }));
vi.mock('@/src/components/ui/useIsNarrow', () => ({ useIsNarrow: () => state.narrow }));

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <PhoneLandingRedirect />
      <Routes>
        <Route path="/" element={<div>dashboard landing</div>} />
        <Route path="/home" element={<div>my queue home</div>} />
        <Route path="/projects/:id" element={<div>project record</div>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  state.narrow = true;
});

describe('#2061 phone landing', () => {
  it('a phone that lands on / opens the my-queue Home', () => {
    renderAt('/');
    expect(screen.getByText('my queue home')).toBeInTheDocument();
    expect(screen.queryByText('dashboard landing')).not.toBeInTheDocument();
  });

  it('desktop keeps the executive dashboard as the landing', () => {
    state.narrow = false;
    renderAt('/');
    expect(screen.getByText('dashboard landing')).toBeInTheDocument();
    expect(screen.queryByText('my queue home')).not.toBeInTheDocument();
  });

  it('deep links are untouched on a phone', () => {
    state.narrow = true;
    renderAt('/projects/p-42');
    expect(screen.getByText('project record')).toBeInTheDocument();
  });
});
