// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { useDebouncedUrlFilters } from './useDebouncedUrlFilters';

afterEach(() => vi.useRealTimers());

it('settles search and its page reset together while preserving other filters', () => {
  vi.useFakeTimers();
  function List() {
    const { search, setSearch } = useDebouncedUrlFilters(['q', 'page', 'status'], { page: '' });
    const location = useLocation();
    return <><input aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} /><output>{location.search}</output></>;
  }
  render(<MemoryRouter initialEntries={['/list?page=3&status=Open&unrelated=kept']}><List /></MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'settled' } });
  expect(screen.getByRole('status')).toHaveTextContent('page=3');
  act(() => { vi.advanceTimersByTime(250); });
  const params = new URLSearchParams(screen.getByRole('status').textContent ?? '');
  expect(params.get('q')).toBe('settled');
  expect(params.has('page')).toBe(false);
  expect(params.get('status')).toBe('Open');
  expect(params.get('unrelated')).toBe('kept');
});

it('ten keystrokes produce one settled read and Back leaves the list in one step', () => {
  vi.useFakeTimers();
  const read = vi.fn();
  function List() {
    const { values, search, setSearch } = useDebouncedUrlFilters(['q']);
    const location = useLocation();
    const navigate = useNavigate();
    useEffect(() => { read(values.q); }, [values.q]);
    return <><input aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} /><output>{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button></>;
  }
  render(<MemoryRouter initialEntries={['/home', '/list']} initialIndex={1}><List /></MemoryRouter>);
  read.mockClear();
  for (let i = 1; i <= 10; i++) {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abcdefghij'.slice(0, i) } });
    act(() => { vi.advanceTimersByTime(20); });
  }
  expect(read).toHaveBeenCalledTimes(0);
  expect(screen.getByRole('textbox')).toHaveValue('abcdefghij');
  act(() => { vi.advanceTimersByTime(250); });
  expect(read).toHaveBeenCalledExactlyOnceWith('abcdefghij');
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByRole('status')).toHaveTextContent('/home');
});

it('clear cancels an unsettled search', () => {
  vi.useFakeTimers();
  function List() {
    const { values, search, setSearch, clear } = useDebouncedUrlFilters(['q']);
    return <><input aria-label="Search" value={search} onChange={e => setSearch(e.target.value)} /><output>{values.q || 'empty'}</output><button onClick={clear}>Clear</button></>;
  }
  render(<MemoryRouter><List /></MemoryRouter>);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pending' } });
  fireEvent.click(screen.getByText('Clear'));
  act(() => { vi.advanceTimersByTime(300); });
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(screen.getByRole('status')).toHaveTextContent('empty');
});
