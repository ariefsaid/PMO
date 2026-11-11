import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import { DocumentViewerProvider } from './DocumentViewerProvider';
import { target } from './testkit';
import { Harness } from './Harness';

function Where() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="where">{location.pathname + location.search}</output>
      <button onClick={() => navigate('/projects/1?filter=open')}>filter</button>
      <button onClick={() => navigate('/procurement')}>go elsewhere</button>
    </>
  );
}

function app() {
  return (
    <MemoryRouter initialEntries={['/projects/1']}>
      <DocumentViewerProvider><Where /><Harness targets={[target()]} /></DocumentViewerProvider>
    </MemoryRouter>
  );
}

describe('document-preview AC-001 the panel never moves the user', () => {
  it('opening and closing leave the route, search and scroll untouched', async () => {
    window.scrollTo = () => {};
    const view = render(app());
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    await screen.findByRole('dialog');
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/1');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/projects\/1$/);
    expect(window.scrollY).toBe(240);
    view.unmount();
  });

  it('a filter (search) change keeps the panel and the user\'s place', async () => {
    render(app());
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'filter' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/projects/1?filter=open');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a route change closes the panel so a stale document never covers a new page', async () => {
    render(app());
    await userEvent.click(screen.getByRole('button', { name: 'Preview Plan.png' }));
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: 'go elsewhere' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
