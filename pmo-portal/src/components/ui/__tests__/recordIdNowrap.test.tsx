import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// jsdom does not load index.css, so the style is injected from the shipped file: the class must carry nowrap.
const css = readFileSync(join(process.cwd(), 'index.css'), 'utf8');
const rule = /\.record-id\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

describe('record-id role: a record number never breaks mid-token', () => {
  it('renders a 20-character number with white-space: nowrap', () => {
    const style = document.createElement('style');
    style.textContent = `.record-id{${rule}}`;
    document.head.appendChild(style);
    render(<span className="record-id">DEMO-SI-2401-0000001</span>);
    expect('DEMO-SI-2401-0000001').toHaveLength(20);
    expect(getComputedStyle(screen.getByText('DEMO-SI-2401-0000001')).whiteSpace).toBe('nowrap');
    style.remove();
  });
});
