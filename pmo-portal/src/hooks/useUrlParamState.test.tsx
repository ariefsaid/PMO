import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useUrlFlag, useUrlParam, useUrlSearchParam } from './useUrlParamState';

function Probe() {
  const [status, setStatus] = useUrlParam<string>('status', 'all', ['all', 'open', 'done']);
  const [arch, setArch] = useUrlFlag('archived');
  const [q, setQ] = useUrlSearchParam('q', 0);
  const loc = useLocation();
  return (
    <div>
      <output aria-label="search">{loc.search}</output>
      <p>status:{status} arch:{String(arch)}</p>
      <button onClick={() => setStatus('open')}>open</button>
      <button onClick={() => setStatus('all')}>all</button>
      <button onClick={() => setArch(true)}>arch</button>
      <input aria-label="q" value={q} onChange={(e) => setQ(e.target.value)} />
    </div>
  );
}

describe('useUrlParamState', () => {
  it('reads state from the URL and ignores values outside the allowed set', () => {
    render(<MemoryRouter initialEntries={['/p?status=done&archived=1']}><Probe /></MemoryRouter>);
    expect(screen.getByText('status:done arch:true')).toBeTruthy();
  });
  it('treats an unknown value as the default', () => {
    render(<MemoryRouter initialEntries={['/p?status=bogus']}><Probe /></MemoryRouter>);
    expect(screen.getByText('status:all arch:false')).toBeTruthy();
  });
  it('writes changes to the URL, omits defaults and keeps unrelated keys', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/p?view=board']}><Probe /></MemoryRouter>);
    await user.click(screen.getByText('open'));
    await user.click(screen.getByText('arch'));
    expect(screen.getByLabelText('search').textContent).toBe('?view=board&status=open&archived=1');
    await user.click(screen.getByText('all'));
    expect(screen.getByLabelText('search').textContent).toBe('?view=board&archived=1');
  });
  it('writes typed search text to the URL', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/p']}><Probe /></MemoryRouter>);
    await user.type(screen.getByLabelText('q'), 'abc');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByLabelText('search').textContent).toBe('?q=abc');
  });
});
