import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ProjectClassificationFilters from './ProjectClassificationFilters';
import type { ProjectClassificationFilters as FilterValues } from '@/src/lib/projectClassification';

const rows = [{ service_line: 'Engineering', sector: 'Energy' }];

function setup(initial: FilterValues = {}, hideAppliedSummary = false) {
  const onChange = vi.fn();
  const ui = (value: FilterValues) => (
    <ProjectClassificationFilters rows={rows} value={value} onChange={onChange} hideAppliedSummary={hideAppliedSummary} panel={(fields) => fields} />
  );
  const view = render(ui(initial));
  return { onChange, rerenderWith: (value: FilterValues) => view.rerender(ui(value)) };
}

describe('ProjectClassificationFilters location box', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('AC-TAG-002 keeps typed location when several own select changes commit in separate renders', () => {
    const { onChange, rerenderWith } = setup();
    fireEvent.change(screen.getByLabelText('Filter by service line'), { target: { value: 'Engineering' } });
    fireEvent.change(screen.getByLabelText('Filter by sector'), { target: { value: 'Energy' } });
    fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'West Java' } });
    // The URL-backed value catches up in two sequential commits (router transitions).
    act(() => rerenderWith({ serviceLine: 'Engineering' }));
    act(() => rerenderWith({ serviceLine: 'Engineering', sector: 'Energy' }));
    expect(screen.getByLabelText('Filter by location')).toHaveValue('West Java');
    act(() => { vi.advanceTimersByTime(300); });
    expect(onChange).toHaveBeenLastCalledWith({ location: 'West Java' });
  });

  it('AC-TAG-002 replaces typed text when an outside change moves the location', () => {
    const { onChange, rerenderWith } = setup();
    fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'West Java' } });
    act(() => rerenderWith({ location: 'Bali' }));
    expect(screen.getByLabelText('Filter by location')).toHaveValue('Bali');
    act(() => { vi.advanceTimersByTime(300); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('AC-TAG-002 keeps text typed after the debounce fired while the URL catches up to the earlier emit', () => {
    const { onChange, rerenderWith } = setup();
    const box = screen.getByLabelText('Filter by location');
    fireEvent.change(box, { target: { value: 'West' } });
    act(() => { vi.advanceTimersByTime(300); });
    expect(onChange).toHaveBeenLastCalledWith({ location: 'West' });
    fireEvent.change(box, { target: { value: 'West Java' } });
    act(() => rerenderWith({ location: 'West' }));
    expect(box).toHaveValue('West Java');
  });

  it('AC-TAG-002 retains location focus when its first URL update adds the clear control', () => {
    // Projects hosts a combined applied summary outside this panel.
    const { rerenderWith } = setup({}, true);
    const box = screen.getByLabelText('Filter by location');
    box.focus();
    fireEvent.change(box, { target: { value: 'Bali' } });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => rerenderWith({ location: 'Bali' }));
    expect(screen.getByLabelText('Filter by location')).toHaveValue('Bali');
    expect(screen.getByLabelText('Filter by location')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Clear classifications' })).toBeInTheDocument();
  });

  it('AC-TAG-002 a resetToken bump cancels a pending location even when value.location never moves', () => {
    const onChange = vi.fn();
    const ui = (token: number) => <ProjectClassificationFilters rows={rows} value={{}} onChange={onChange} panel={(fields) => fields} resetToken={token} />;
    const view = render(ui(0));
    fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Bali' } });
    act(() => view.rerender(ui(1)));
    expect(screen.getByLabelText('Filter by location')).toHaveValue('');
    act(() => { vi.advanceTimersByTime(500); });
    expect(onChange).not.toHaveBeenCalled();
  });
  it('AC-TAG-002 ignores delayed echoes of earlier location emits while retaining the final typed value', () => {
    const { onChange, rerenderWith } = setup();
    const box = screen.getByLabelText('Filter by location');
    fireEvent.change(box, { target: { value: 'B' } });
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.change(box, { target: { value: 'Ba' } });
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.change(box, { target: { value: 'Bali' } });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => rerenderWith({ location: 'B' }));
    expect(box).toHaveValue('Bali');
    act(() => { vi.advanceTimersByTime(200); });
    expect(onChange).toHaveBeenLastCalledWith({ location: 'Bali' });
    act(() => rerenderWith({ location: 'Bali' }));
    act(() => rerenderWith({ location: 'Jakarta' }));
    expect(box).toHaveValue('Jakarta');
  });

  it('AC-TAG-002 a repeated older URL value during another filter commit cannot overwrite a newer emit', () => {
    const { rerenderWith } = setup();
    const box = screen.getByLabelText('Filter by location');
    fireEvent.change(box, { target: { value: 'Ba' } });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => rerenderWith({ location: 'Ba' }));
    fireEvent.change(box, { target: { value: 'Bali' } });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => rerenderWith({ location: 'Ba', serviceLine: 'Engineering' }));
    expect(box).toHaveValue('Bali');
  });

});
