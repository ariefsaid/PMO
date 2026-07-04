/**
 * Tests for AgentContextProvider + useAgentContext (ADR-0045 §3, Task X3).
 * FR-ATC-015: route from the router, entity via an opt-in imperative setter.
 * FR-ATC-019: read-only — no setter drives navigation from context.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { it, expect } from 'vitest';
import { AgentContextProvider } from './AgentContextProvider';
import { useAgentContext } from './useAgentContext';

const Probe: React.FC = () => {
  const { getContext, setEntity } = useAgentContext();
  const ctx = getContext();
  return (
    <div>
      <span data-testid="route">{ctx.route}</span>
      <span data-testid="entity">{ctx.entity ? JSON.stringify(ctx.entity) : 'none'}</span>
      <button
        data-testid="set-entity"
        onClick={() => setEntity({ type: 'project', id: '123', label: 'Alpha' })}
      >
        Set entity
      </button>
    </div>
  );
};

it('FR-ATC-015 getContext().route reflects the current router location', () => {
  render(
    <MemoryRouter initialEntries={['/projects/123']}>
      <AgentContextProvider>
        <Routes>
          <Route path="/projects/:id" element={<Probe />} />
        </Routes>
      </AgentContextProvider>
    </MemoryRouter>,
  );

  expect(screen.getByTestId('route').textContent).toBe('/projects/123');
  expect(screen.getByTestId('entity').textContent).toBe('none');
});

it('FR-ATC-015 setEntity populates getContext().entity for subsequent reads', () => {
  render(
    <MemoryRouter initialEntries={['/projects/123']}>
      <AgentContextProvider>
        <Probe />
      </AgentContextProvider>
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByTestId('set-entity'));

  expect(screen.getByTestId('entity').textContent).toBe(
    JSON.stringify({ type: 'project', id: '123', label: 'Alpha' }),
  );
});

it('FR-ATC-019 the provider never navigates — it has no router-driving setter', () => {
  // Type-level + behavioral proof: useAgentContext's return shape exposes only
  // getContext/setEntity/setSelection — no navigate/setRoute member exists.
  const AssertNoNavSetter: React.FC = () => {
    const ctx = useAgentContext();
    const keys = Object.keys(ctx).sort();
    return <span data-testid="keys">{keys.join(',')}</span>;
  };

  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AgentContextProvider>
        <AssertNoNavSetter />
      </AgentContextProvider>
    </MemoryRouter>,
  );

  const keys = screen.getByTestId('keys').textContent;
  expect(keys).not.toMatch(/navigate/i);
  expect(keys).not.toMatch(/setRoute/i);
});
