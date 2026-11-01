import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WinDetailsFields } from './WinDetailsFields';

vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-01' }));

describe('WinDetailsFields (#1638)', () => {
  it('AC-PSH-002: the contract date cannot be picked after the org\'s today (the server refuses the next move after a future-dated win)', () => {
    render(<WinDetailsFields idPrefix="p1" contractRef="" contractDate="" onRef={vi.fn()} onDate={vi.fn()} />);
    expect(screen.getByLabelText('Contract date')).toHaveAttribute('max', '2026-11-01');
  });
});
