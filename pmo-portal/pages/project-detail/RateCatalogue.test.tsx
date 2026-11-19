import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ listItems: vi.fn(), listRates: vi.fn(), listVariants: vi.fn(), addVariants: vi.fn(), setDefaultVariant: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { rateCatalogue: api } }));
vi.mock('@/src/components/import', () => ({ ImportWizard: () => <div>Import wizard</div> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
import RateCatalogue from './RateCatalogue';
describe('Rate catalogue', () => {
  beforeEach(() => { vi.clearAllMocks(); api.listItems.mockResolvedValue([]); api.listRates.mockResolvedValue([]); api.listVariants.mockResolvedValue([]); });
  it('shows an import action on the empty catalogue for a writer', async () => {
    api.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
    render(<RateCatalogue projectId="p1" currency="USD" canWrite />);
    expect(await screen.findByText('No catalogue items')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText('Import wizard')).toBeInTheDocument();
  });
  it('shows rates without a write action for a reader', async () => {
    api.listItems.mockResolvedValue([{ id: 'i', item_code: 'A', description: 'Weld', unit: 'm', category: '', class: '' }]);
    api.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
    api.listRates.mockResolvedValue([{ item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-01-01' }]);
    render(<RateCatalogue projectId="p1" currency="USD" canWrite={false} />);
    expect(await screen.findByText(/Weld/)).toBeInTheDocument();
    expect(screen.getByText(/120/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
  });
  it('lets a writer retry an unsuccessful read', async () => {
    api.listItems.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    render(<RateCatalogue projectId="p1" currency="USD" canWrite />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No catalogue items')).toBeInTheDocument());
  });
});
