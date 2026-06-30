/**
 * Tests for ToolCallCard
 * AC-AP-013: tool-call card renders human label (D-A2-7)
 * FR-AP-015: "Looked up {entity} · N rows" or "Checking your data…" fallback
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToolCallCard } from './ToolCallCard';

describe('ToolCallCard', () => {
  it('AC-AP-013 renders a tool-call card with the human label', () => {
    render(<ToolCallCard payload={{ entity: 'projects', rowCount: 3 }} />);

    const text = screen.getByText(/Looked up projects/i);
    expect(text).toBeInTheDocument();

    // Ensure row count appears
    expect(text.textContent).toContain('3');

    // Ensure no raw JSON payload
    expect(text.textContent).not.toContain('{');
  });

  it('AC-AP-013 fallback: unknown payload renders "Checking your data"', () => {
    render(<ToolCallCard payload={{}} />);
    expect(screen.getByText(/Checking your data/i)).toBeInTheDocument();
  });

  it('AC-AP-013 entity without rowCount omits the row count', () => {
    render(<ToolCallCard payload={{ entity: 'companies' }} />);
    const el = screen.getByText(/Looked up companies/i);
    expect(el).toBeInTheDocument();
    expect(el.textContent).not.toMatch(/·/);
  });
});
