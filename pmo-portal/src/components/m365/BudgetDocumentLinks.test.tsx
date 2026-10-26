import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import idCatalogue from '../../../public/locales/id/common.json';
import enM365Catalogue from '../../../public/locales/en/m365Documents.json';
import idM365Catalogue from '../../../public/locales/id/m365Documents.json';
import { AppError } from '@/src/lib/appError';
import { BudgetDocumentLinks } from './BudgetDocumentLinks';

vi.unmock('./BudgetDocumentLinks');

i18n.addResourceBundle('en', 'm365Documents', enM365Catalogue, true, true);
i18n.addResourceBundle('id', 'm365Documents', idM365Catalogue, true, true);

const mock = vi.hoisted(() => ({
  mayMutate: vi.fn(),
  links: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  add: vi.fn(), remove: vi.fn(), usedVersion: [] as string[],
  connection: { connected: true, status: 'active' } as { connected: boolean; status: string | null } | undefined,
  pickerProps: null as null | { open: boolean; context: unknown; onSelect: (r: unknown) => Promise<void> },
}));
vi.mock('./DocumentLinkPermissions', () => ({ useDocumentLinkPermissions: () => ({ budgetEdit: (s: string) => mock.mayMutate(s) }) }));
vi.mock('@/src/hooks/useBudgetDocumentLinks', () => ({
  useBudgetDocumentLinks: (id: string) => {
    mock.usedVersion.push(id);
    return { query: mock.links, add: { mutateAsync: mock.add }, remove: { mutateAsync: mock.remove, isPending: false } };
  },
}));
vi.mock('@/src/hooks/useMicrosoftDocuments', () => ({ useMicrosoftDocuments: () => ({ connection: mock.connection }) }));
vi.mock('./MicrosoftDocumentPicker', () => ({
  MicrosoftDocumentPicker: (props: NonNullable<typeof mock.pickerProps>) => { mock.pickerProps = props; return props.open ? <div role="dialog">picker</div> : null; },
}));
vi.mock('@/src/lib/m365/graphClient', () => ({ getItem: vi.fn(), listVersions: vi.fn() }));

const SP = 'https://tenant.sharepoint.com/sites/synthetic/Shared%20Documents';
const row = (id: string, name: string, kind: 'file' | 'folder' = 'file') => ({
  id, org_id: 'o', budget_version_id: 'v1', ms_drive_id: 'd', ms_item_id: `i-${id}`, ms_web_url: `${SP}/${name}`,
  ms_item_name: name, ms_item_kind: kind, ms_linked_by: 'u', ms_linked_at: '2026-10-01T09:00:00Z', ms_last_verified_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.usedVersion = []; mock.pickerProps = null;
  mock.mayMutate.mockImplementation((s: string) => s === 'Draft');
  mock.links = { data: [row('1', 'Quote.pdf'), row('2', 'Archive', 'folder')], isPending: false, isError: false, refetch: vi.fn() };
  mock.connection = { connected: true, status: 'active' };
  mock.add.mockResolvedValue(undefined); mock.remove.mockResolvedValue(undefined);
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

describe('BudgetDocumentLinks rendering', () => {
  it('AC-M365DOC-058 renders every reference of the selected version; a folder has no versions or approval controls', () => {
    render(<BudgetDocumentLinks versionId="v1" status="Active" />);
    expect(mock.usedVersion).toContain('v1');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Versions of Quote\.pdf/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Versions of Archive/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Approved version|drift/i)).not.toBeInTheDocument();
  });

  it('AC-M365DOC-058 an Active or Archived version opens a link directly, is read-only, and offers no link or remove', async () => {
    for (const status of ['Active', 'Archived']) {
      const { unmount } = render(<BudgetDocumentLinks versionId="v1" status={status} />);
      expect(screen.getByText('Evidence is read-only on this version.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Link from Microsoft 365/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
      await userEvent.click(screen.getAllByRole('button', { name: /^Open in SharePoint/ })[0]);
      expect(window.open).toHaveBeenLastCalledWith(`${SP}/Quote.pdf`, '_blank', 'noopener,noreferrer');
      unmount();
    }
  });

  it('AC-M365DOC-059 an evidence read failure is its own error with retry; the empty list is distinct', async () => {
    mock.links = { data: [], isPending: false, isError: true, refetch: vi.fn() };
    const { rerender } = render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    expect(screen.getByText('Evidence documents could not be loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(mock.links.refetch).toHaveBeenCalled();
    mock.links = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    rerender(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    expect(screen.getByText('No evidence documents are linked to this version.')).toBeInTheDocument();
  });

  it('AC-M365DOC-052 a different version id reads a different list (no leakage between versions)', () => {
    const { rerender } = render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    rerender(<BudgetDocumentLinks versionId="v2" status="Draft" />);
    expect(mock.usedVersion).toEqual(expect.arrayContaining(['v1', 'v2']));
  });
});

describe('BudgetDocumentLinks Draft mutations', () => {
  it('AC-M365DOC-060 a Draft version with an active connection links through the budget picker with one insert', async () => {
    render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    await userEvent.click(screen.getByRole('button', { name: /Link from Microsoft 365/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mock.pickerProps?.context).toEqual({ kind: 'budget' });
    const ref = { drive_id: 'd', item_id: 'x', web_url: `${SP}/n.xlsx`, name: 'n.xlsx', item_kind: 'file' as const };
    await mock.pickerProps!.onSelect(ref);
    expect(mock.add).toHaveBeenCalledTimes(1);
    expect(mock.add).toHaveBeenCalledWith(ref);
  });

  it('AC-M365DOC-060 without an active connection the link action is disabled with a hint, while existing links stay visible', () => {
    mock.connection = { connected: false, status: null };
    render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    expect(screen.getByRole('button', { name: /Link from Microsoft 365/ })).toBeDisabled();
    expect(screen.getByText(/Connect Microsoft 365/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('AC-M365DOC-060 impersonation / non-editor (budgetEdit false on a Draft) gets the read-only view', () => {
    mock.mayMutate.mockReturnValue(false);
    render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    expect(screen.queryByRole('button', { name: /Link from Microsoft 365/ })).not.toBeInTheDocument();
    expect(screen.getByText('Evidence is read-only on this version.')).toBeInTheDocument();
  });

  it('AC-M365DOC-062 removal asks to confirm; Cancel removes nothing, Confirm calls only removeDocumentLink', async () => {
    render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove link to Quote.pdf' }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(mock.remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove link to Quote.pdf' }));
    const dialog = screen.getByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mock.remove).toHaveBeenCalledWith('1'));
    expect(mock.remove).toHaveBeenCalledTimes(1);
  });

  it('AC-M365DOC-062 a denied removal keeps the evidence listed and shows a persistent alert', async () => {
    mock.remove.mockRejectedValue(new AppError('permission denied for table budget_version_document_links', '42501'));
    render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove link to Quote.pdf' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText(/budget_version_document_links/)).not.toBeInTheDocument();
  });
});

describe('#1020 Discover fixes', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('F17: the link action uses the same wording and a document icon (not the plug) as every other register', () => {
    render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    const button = screen.getByRole('button', { name: 'Link from Microsoft 365' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.innerHTML).not.toMatch(/plug/i);
  });

  it('F3: in Indonesian the heading, link action and remove action are translated', async () => {
    i18n.addResourceBundle('id', 'common', idCatalogue, true, true);
    await i18n.changeLanguage('id');
    render(<BudgetDocumentLinks versionId="v1" status="Draft" />);
    expect(screen.getByRole('heading', { name: 'Dokumen bukti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tautkan dari Microsoft 365' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hapus tautan ke Quote.pdf' })).toBeInTheDocument();
  });
});
