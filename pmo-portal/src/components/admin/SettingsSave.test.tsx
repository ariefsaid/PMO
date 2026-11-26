import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsSaveAction, SettingsSaveProvider } from './SettingsSave';
import { useSettingsSaveEntry } from './settingsSaveContext';

function Setting({ name, write }: { name: string; write: (value: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  useSettingsSaveEntry({ dirty: value !== saved, invalid: value === 'invalid', save: async () => { await write(value); setSaved(value); } });
  return <label>{name}<input value={value} onChange={(e) => setValue(e.target.value)} /></label>;
}
function mount(first: (value: string) => Promise<void>, second: (value: string) => Promise<void>) {
  render(<SettingsSaveProvider><SettingsSaveAction /><Setting name="First" write={first} /><Setting name="Second" write={second} /></SettingsSaveProvider>);
}
describe('One settings-page save', () => {
  it('saves every changed setting once, leaving unchanged settings alone', async () => {
    const first = vi.fn().mockResolvedValue(undefined); const second = vi.fn().mockResolvedValue(undefined);
    mount(first, second);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('First'), { target: { value: 'one' } });
    fireEvent.change(screen.getByLabelText('Second'), { target: { value: 'two' } });
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(second).toHaveBeenCalledWith('two'));
    expect(first).toHaveBeenCalledExactlyOnceWith('one');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
  });
  it('keeps a failed setting dirty and reports partial failure without hiding other writes', async () => {
    const first = vi.fn().mockRejectedValue(new Error('readable failure')); const second = vi.fn().mockResolvedValue(undefined);
    mount(first, second);
    fireEvent.change(screen.getByLabelText('First'), { target: { value: 'one' } });
    fireEvent.change(screen.getByLabelText('Second'), { target: { value: 'two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Some changes were not saved');
    expect(second).toHaveBeenCalledExactlyOnceWith('two');
    expect(screen.getByLabelText('First')).toHaveValue('one');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
  it('does not write any setting while one changed setting is invalid', () => {
    const first = vi.fn(); const second = vi.fn(); mount(first, second);
    fireEvent.change(screen.getByLabelText('First'), { target: { value: 'invalid' } });
    fireEvent.change(screen.getByLabelText('Second'), { target: { value: 'two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
  });
});
