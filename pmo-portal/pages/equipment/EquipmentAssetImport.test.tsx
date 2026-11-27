import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { company: { list: h.list } } }));
vi.mock('@/src/components/import', () => ({ ImportButton: () => <button>Import equipment</button> }));
vi.mock('@/src/lib/import', () => ({ makeEquipmentImportDescriptor: () => ({}) }));
import { EquipmentAssetImport } from './EquipmentAssetImport';
it('blocks import after a vendor read failure and allows a successful retry', async () => {
  h.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
  render(<EquipmentAssetImport onImported={() => {}} />);
  await userEvent.click(await screen.findByRole('button', { name: /retry/i }));
  expect(await screen.findByRole('button', { name: 'Import equipment' })).toBeInTheDocument();
});
