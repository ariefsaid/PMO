import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WinDetailsFields } from './WinDetailsFields';
import { latestPickableDay } from '@/test/dateField';

vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-01' }));

describe('WinDetailsFields (#1638)', () => {
  it('AC-PSH-002: the contract date cannot be picked after the org\'s today (the server refuses the next move after a future-dated win)', async () => {
    render(<WinDetailsFields idPrefix="p1" contractRef="" contractDate="" onRef={vi.fn()} onDate={vi.fn()} />);
    expect(await latestPickableDay(userEvent.setup(), screen.getByLabelText('Contract date'))).toBe('2026-11-01');
  });
});
