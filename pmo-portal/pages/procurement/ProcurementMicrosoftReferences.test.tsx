import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18n from 'i18next';
import idCatalogue from '../../public/locales/id/common.json';

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  state: { isPending: false, isError: false },
  perms: { create: true, edit: true },
  hook: {
    create: { mutateAsync: vi.fn(), isPending: false },
    link: { mutateAsync: vi.fn(), isPending: false },
    unlink: { mutateAsync: vi.fn(), isPending: false },
    clearLegacy: { mutateAsync: vi.fn(), isPending: false },
    invalidate: vi.fn(),
  },
  picker: { props: null as null | { open: boolean; context: unknown; onClose: () => void; onSelect: (r: unknown) => Promise<void> } },
  refresh: vi.fn(),
  folderAction: { props: null as null | { onChooseExisting?: () => void } },
}));

vi.mock('@/src/hooks/useProcurementMicrosoftReferences', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useProcurementMicrosoftReferences')>()),
  useProcurementMicrosoftReferences: () => ({
    query: { data: h.rows, isPending: h.state.isPending, isError: h.state.isError, refetch: vi.fn() },
    ...h.hook,
  }),
}));
vi.mock('@/src/components/m365/DocumentLinkPermissions', () => ({
  useDocumentLinkPermissions: () => ({
    procurementCreate: () => h.perms.create,
    procurementEdit: () => h.perms.edit,
  }),
}));
vi.mock('@/src/components/m365/MicrosoftDocumentPicker', () => ({
  MicrosoftDocumentPicker: (props: NonNullable<typeof h.picker.props>) => {
    h.picker.props = props;
    return props.open ? <div role="dialog" aria-label="picker" /> : null;
  },
}));
// The case register mounts RecordFolderAction (own coverage: RecordFolderAction.test / useStartRecordFolder tests).
vi.mock('@/src/components/m365/RecordFolderAction', () => ({
  RecordFolderAction: (props: { onChooseExisting?: () => void }) => { h.folderAction.props = props; return null; },
}));
vi.mock('@/src/lib/m365/graphClient', () => ({ refreshMicrosoftReferences: h.refresh }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }) }));

import { ProcurementMicrosoftReferences } from './ProcurementMicrosoftReferences';
import { matchingReferencePairs } from '@/src/hooks/useProcurementMicrosoftReferences';

const msRow = (over: Record<string, unknown> = {}) => ({
  id: 'ms-1', procurement_id: 'case-1', type: 'Microsoft reference', status: 'Draft', reference_number: 'REF-9', date: '2026-10-01',
  link: 'https://example.invalid/sites/x/folder', source: 'onedrive', ms_drive_id: 'drive-1', ms_item_id: 'item-1',
  ms_item_name: 'Synthetic folder', ms_item_kind: 'folder', ms_linked_by: 'user-1', ms_linked_at: '2026-10-02T00:00:00Z',
  ms_last_verified_at: null, org_id: 'org-1', ...over,
});
const legacyRow = (over: Record<string, unknown> = {}) => ({
  id: 'legacy-1', procurement_id: 'case-1', type: 'Quote', status: 'Issued', reference_number: 'Q-1', date: null,
  link: 'https://legacy.invalid/q.pdf', source: null, ms_drive_id: null, ms_item_id: null, ms_item_name: null,
  ms_item_kind: null, ms_linked_by: null, ms_linked_at: null, ms_last_verified_at: null, org_id: 'org-1', ...over,
});
const emptyRow = (over: Record<string, unknown> = {}) => legacyRow({ id: 'empty-1', type: 'Spec', link: null, ...over });

const picked = { drive_id: 'drive-2', item_id: 'item-2', web_url: 'https://example.invalid/sites/y/file', name: 'Picked file', item_kind: 'file' as const };

type Target = { value: string; label: string; recordKind: 'erp_document' | 'vendor_invoice'; recordId: string };
function renderIt(targets: Target[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProcurementMicrosoftReferences procurementId="case-1" requestNumber="PR-2026-001" createdAt="2026-10-01T00:00:00Z" targets={targets} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  h.state.isPending = false; h.state.isError = false;
  h.perms.create = true; h.perms.edit = true;
  h.picker.props = null;
  h.hook.create.mutateAsync.mockResolvedValue({ id: 'new' });
  h.hook.link.mutateAsync.mockResolvedValue(undefined);
  h.hook.unlink.mutateAsync.mockResolvedValue(undefined);
  h.hook.clearLegacy.mutateAsync.mockResolvedValue(undefined);
  h.refresh.mockResolvedValue(undefined);
});

describe('AC-M365DOC-058/059 case references on the Documents tab', () => {
  it('shows file and folder references and a legacy plain URL for a project-less case at any stage', () => {
    h.rows = [msRow(), msRow({ id: 'ms-2', ms_item_name: 'Synthetic file', ms_item_kind: 'file', ms_item_id: 'item-3' }), legacyRow()];
    renderIt();
    expect(screen.getByRole('heading', { name: 'SharePoint links for this case' })).toBeInTheDocument();
    expect(screen.getByText('Synthetic folder')).toBeInTheDocument();
    expect(screen.getByText('Synthetic file')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open folder in/ }).length).toBeGreaterThan(0);
    const legacy = screen.getAllByRole('link', { name: 'Open linked document' })[0];
    expect(legacy).toHaveAttribute('href', 'https://legacy.invalid/q.pdf');
    expect(legacy).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getAllByText('Plain link, not from Microsoft 365').length).toBeGreaterThan(0);
  });

  it('does not render an unsafe legacy URL as a link', () => {
    h.rows = [legacyRow({ link: 'javascript:alert(1)' })];
    renderIt();
    expect(screen.queryByRole('link', { name: 'Open linked document' })).toBeNull();
    expect(screen.getAllByText('This link cannot be opened.').length).toBeGreaterThan(0);
  });

  it('shows the empty state', () => {
    renderIt();
    expect(screen.getByText('No links yet')).toBeInTheDocument();
  });

  it('exposes no money or stage command', () => {
    h.rows = [msRow()];
    renderIt();
    expect(screen.queryByRole('button', { name: /approve|submit|activate|transition|push/i })).toBeNull();
  });
});

describe('AC-M365DOC-060 permissions (real-role procDoc matrix)', () => {
  it('hides link and unlink affordances without create/edit permission, while display and open stay', () => {
    h.perms.create = false; h.perms.edit = false;
    h.rows = [msRow(), legacyRow(), emptyRow()];
    renderIt();
    expect(screen.queryByRole('button', { name: 'Link from Microsoft 365' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unlink/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Clear link/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Open folder in/ }).length).toBeGreaterThan(0);
  });

  it('create without edit shows only the header link action', () => {
    h.perms.edit = false;
    h.rows = [msRow(), emptyRow()];
    renderIt();
    expect(screen.getByRole('button', { name: 'Link from Microsoft 365' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Unlink/ })).toBeNull();
  });
});

describe('AC-M365DOC-060/062 create flow, suggestion and failure retention', () => {
  it('passes the request number and creation date as the contextual suggestion source', () => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    expect(h.picker.props?.open).toBe(true);
    expect(h.picker.props?.context).toEqual({ kind: 'procurement', request_number: 'PR-2026-001', created_at: '2026-10-01T00:00:00Z' });
  });

  it('commits exactly one create straight after the picker selection, with no second details step', async () => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await act(async () => { await h.picker.props!.onSelect(picked); });
    expect(h.hook.create.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.hook.create.mutateAsync).toHaveBeenCalledWith({ reference: picked });
    expect(screen.queryByRole('dialog', { name: /Add case reference/ })).toBeNull();
  });

  it('a failed create rejects out of onSelect so the picker keeps the selection and reports it', async () => {
    h.hook.create.mutateAsync.mockRejectedValue(Object.assign(new Error('collision'), { code: '23514' }));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await expect(act(async () => { await h.picker.props!.onSelect(picked); })).rejects.toThrow('collision');
  });

  it('closing the picker without a selection creates nothing', () => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    act(() => h.picker.props!.onClose());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.hook.create.mutateAsync).not.toHaveBeenCalled();
  });

});

describe('AC-M365DOC-062/063 unlink and legacy clear retain metadata', () => {
  it('unlink asks first, says only the PMO reference is removed, and Cancel changes nothing', async () => {
    h.rows = [msRow()];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Synthetic folder' }));
    expect(await screen.findByText(/removes only the PMO reference/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.hook.unlink.mutateAsync).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('confirming unlink calls only the Microsoft unlink for that row', async () => {
    h.rows = [msRow()];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Synthetic folder' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(h.hook.unlink.mutateAsync).toHaveBeenCalledWith('ms-1'));
    expect(h.hook.clearLegacy.mutateAsync).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('a failed unlink keeps the dialog open with an in-dialog remedy', async () => {
    h.hook.unlink.mutateAsync.mockRejectedValue(new Error('denied'));
    h.rows = [msRow()];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Unlink Synthetic folder' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByText(/The reference was not changed/)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('a legacy plain link offers an explicit clear, which calls the legacy clear and not the Microsoft unlink', async () => {
    h.rows = [legacyRow()];
    renderIt();
    expect(screen.queryByRole('button', { name: /^Unlink/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear link on Quote' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clear link' }));
    await waitFor(() => expect(h.hook.clearLegacy.mutateAsync).toHaveBeenCalledWith('legacy-1'));
    expect(h.hook.unlink.mutateAsync).not.toHaveBeenCalled();
    expect(h.hook.link.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('AC-M365DOC-059/062 matching browse refresh', () => {
  it('matchingReferencePairs compares drive AND item, so one item id in two drives is not confused', () => {
    const rows = [msRow({ id: 'a', ms_drive_id: 'drive-A', ms_item_id: 'same' }), msRow({ id: 'b', ms_drive_id: 'drive-B', ms_item_id: 'same' }), legacyRow()] as never;
    expect(matchingReferencePairs([{ drive_id: 'drive-B', item_id: 'same' }], rows)).toEqual([{ drive_id: 'drive-B', item_id: 'same' }]);
    expect(matchingReferencePairs([{ drive_id: 'drive-C', item_id: 'same' }], rows)).toEqual([]);
  });

  it('matchingReferencePairs caps a refresh at twenty identities', () => {
    const rows = Array.from({ length: 30 }, (_, i) => msRow({ id: `r${i}`, ms_item_id: `i${i}` })) as never;
    const loaded = Array.from({ length: 30 }, (_, i) => ({ drive_id: 'drive-1', item_id: `i${i}` }));
    expect(matchingReferencePairs(loaded, rows)).toHaveLength(20);
  });

  it('refreshes only rows the selected item matches, then invalidates the register on success', async () => {
    h.rows = [msRow()];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await act(async () => { await h.picker.props!.onSelect({ ...picked, drive_id: 'drive-1', item_id: 'item-1' }); });
    expect(h.refresh).toHaveBeenCalledWith({ procurement_id: 'case-1', items: [{ drive_id: 'drive-1', item_id: 'item-1' }] });
  });

  it('does not refresh for an item that matches no case reference', async () => {
    h.rows = [msRow()];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await act(async () => { await h.picker.props!.onSelect(picked); });
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('a failed metadata read neither throws into the picker nor removes the reference', async () => {
    h.refresh.mockRejectedValue(new Error('graph'));
    h.rows = [msRow()];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Link from Microsoft 365' }));
    await act(async () => {
      await expect(h.picker.props!.onSelect({ ...picked, drive_id: 'drive-1', item_id: 'item-1' })).resolves.toBeUndefined();
    });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.hook.unlink.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Synthetic folder')).toBeInTheDocument();
  });
});

describe('F8: the case register is a plain list of SharePoint links, not a second ledger', () => {
  afterEach(async () => { await i18n.changeLanguage('en'); });

  it('F8: no table, no type/status/date columns, no ledger row without a link; each link shows name, when linked, open and unlink', () => {
    h.rows = [msRow({ ms_item_name: 'Spec folder' }), legacyRow(), emptyRow({ type: 'Capture RFQ', reference_number: 'RFQ-2026-004', status: 'Issued' })];
    renderIt();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('columnheader')).toBeNull();
    const items = within(screen.getByRole('list', { name: 'SharePoint links for this case' })).getAllByRole('listitem');
    expect(items).toHaveLength(2); // the link-less ledger record is not listed here
    expect(screen.queryByText('RFQ-2026-004')).toBeNull();
    expect(screen.queryByText('Issued')).toBeNull();
    expect(screen.queryByText('No file linked')).toBeNull();
    expect(within(items[0]).getByText('Spec folder')).toBeInTheDocument();
    expect(within(items[0]).getByText('Linked Oct 2, 2026')).toBeInTheDocument();
    expect(within(items[0]).getByRole('button', { name: /Open folder in/ })).toBeInTheDocument();
    expect(within(items[0]).getByRole('button', { name: 'Unlink Spec folder' })).toBeInTheDocument();
  });

  it('F8: legacy plain-link rows keep working (open + clear) inside the same list', () => {
    h.rows = [legacyRow()];
    renderIt();
    const item = within(screen.getByRole('list', { name: 'SharePoint links for this case' })).getByRole('listitem');
    expect(within(item).getByRole('link', { name: 'Open linked document' })).toHaveAttribute('href', 'https://legacy.invalid/q.pdf');
    expect(within(item).getByText('Plain link, not from Microsoft 365')).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: 'Clear link on Quote' })).toBeInTheDocument();
  });

  it('F8: exactly one link button, whatever the rows', () => {
    h.rows = [msRow(), legacyRow(), emptyRow()];
    renderIt();
    expect(screen.getAllByRole('button', { name: /from Microsoft 365/ })).toHaveLength(1);
  });

  it('F8: a link-less record cannot make the empty state disappear', () => {
    h.rows = [emptyRow()];
    renderIt();
    expect(screen.getByText('No links yet')).toBeInTheDocument();
  });

  it('F3: in Indonesian the heading, empty state and link action are translated', async () => {
    i18n.addResourceBundle('id', 'common', idCatalogue, true, true);
    await i18n.changeLanguage('id');
    renderIt();
    expect(screen.getByRole('heading', { name: 'Tautan SharePoint untuk kasus ini' })).toBeInTheDocument();
    expect(screen.getByText('Belum ada tautan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tautkan dari Microsoft 365' })).toBeInTheDocument();
  });
});

describe('F5 (case side): "Choose existing folder" opens the picker', () => {
  it('F5: RecordFolderAction receives onChooseExisting, which opens the picker with the case suggestion context', () => {
    renderIt();
    expect(h.folderAction.props?.onChooseExisting).toBeTypeOf('function');
    expect(h.picker.props?.open).toBe(false);
    act(() => h.folderAction.props!.onChooseExisting!());
    expect(h.picker.props?.open).toBe(true);
    expect(h.picker.props?.context).toEqual({ kind: 'procurement', request_number: 'PR-2026-001', created_at: '2026-10-01T00:00:00Z' });
  });

  it('F5: a folder picked that way is linked to the case like any other link', async () => {
    renderIt();
    act(() => h.folderAction.props!.onChooseExisting!());
    await act(async () => { await h.picker.props!.onSelect({ ...picked, item_kind: 'folder' }); });
    expect(h.hook.create.mutateAsync).toHaveBeenCalledWith({ reference: { ...picked, item_kind: 'folder' } });
  });

  it('F5: a reader without link permission gets no choose-existing handler', () => {
    h.perms.create = false;
    renderIt();
    expect(h.folderAction.props?.onChooseExisting).toBeUndefined();
  });
});

describe('AC-PFE-009 files per document and folders', () => {
  const erpTarget: Target = { value: 'erp_document:d1', label: 'Supplier invoice ACC-PINV-0001', recordKind: 'erp_document', recordId: 'd1' };

  it('AC-PFE-009: a linked folder shows as a folder without status or category; a file shows under its ERP invoice', () => {
    h.rows = [
      msRow({ id: 'f', ms_item_name: 'Supplier docs', status: 'Draft', record_kind: null, record_id: null }),
      msRow({ id: 'x', ms_item_name: 'Bill.pdf', ms_item_kind: 'file', ms_item_id: 'item-9', status: 'Draft', record_kind: 'erp_document', record_id: 'd1' }),
    ];
    renderIt([erpTarget]);
    const folder = screen.getByRole('listitem', { name: /Supplier docs/ });
    expect(folder).toHaveTextContent('Open folder');
    expect(folder).not.toHaveTextContent('Draft');
    expect(screen.getByRole('group', { name: 'Supplier invoice ACC-PINV-0001' })).toHaveTextContent('Bill.pdf');
  });

  it('a reference whose record is no longer a target stays in the plain list', () => {
    h.rows = [msRow({ id: 'x', ms_item_name: 'Orphan.pdf', ms_item_kind: 'file', record_kind: 'erp_document', record_id: 'gone' })];
    renderIt([erpTarget]);
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByText('Orphan.pdf')).toBeInTheDocument();
  });

  it('asks "Attach to" inside the link flow, only when the purchase has something to attach to, defaulting to this purchase', async () => {
    const { unmount } = renderIt();
    await act(async () => { await h.picker.props!.onSelect(picked); });
    // Nothing to attach to: the link is written straight away, with no extra question.
    expect(h.hook.create.mutateAsync).toHaveBeenLastCalledWith({ reference: picked });
    expect(screen.queryByLabelText('Attach to')).toBeNull();
    unmount();
    h.hook.create.mutateAsync.mockClear();
    renderIt([erpTarget]);
    await act(async () => { await h.picker.props!.onSelect(picked); });
    expect(h.hook.create.mutateAsync).not.toHaveBeenCalled();
    const select = screen.getByLabelText('Attach to') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getByRole('option', { name: 'This purchase' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Supplier invoice ACC-PINV-0001' })).toBeInTheDocument();
  });

  it('the answer decides the write: this purchase by default, or the chosen document', async () => {
    renderIt([erpTarget]);
    await act(async () => { await h.picker.props!.onSelect(picked); });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(h.hook.create.mutateAsync).toHaveBeenLastCalledWith({ reference: picked }));
    await act(async () => { await h.picker.props!.onSelect(picked); });
    fireEvent.change(screen.getByLabelText('Attach to'), { target: { value: 'erp_document:d1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(h.hook.create.mutateAsync).toHaveBeenLastCalledWith({ reference: picked, target: { recordKind: 'erp_document', recordId: 'd1' } }));
  });

  it('a refused link keeps the question open and says so', async () => {
    h.hook.create.mutateAsync.mockRejectedValueOnce(new Error('nope'));
    renderIt([erpTarget]);
    await act(async () => { await h.picker.props!.onSelect(picked); });
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The reference was not changed');
    expect(screen.getByLabelText('Attach to')).toBeInTheDocument();
  });

  it('with several groups the purchase own links get the same kind of heading', () => {
    h.rows = [
      msRow({ id: 'a', ms_item_name: 'Plain.pdf', ms_item_kind: 'file', ms_item_id: 'i-a' }),
      msRow({ id: 'x', ms_item_name: 'Bill.pdf', ms_item_kind: 'file', ms_item_id: 'i-x', record_kind: 'erp_document', record_id: 'd1' }),
    ];
    renderIt([erpTarget]);
    expect(screen.getByRole('group', { name: 'This purchase' })).toHaveTextContent('Plain.pdf');
    expect(screen.getByRole('group', { name: 'Supplier invoice ACC-PINV-0001' })).toHaveTextContent('Bill.pdf');
  });

  it('shows no link action (so no Attach to question) without link permission', () => {
    h.perms.create = false;
    renderIt([erpTarget]);
    expect(screen.queryByRole('button', { name: 'Link from Microsoft 365' })).toBeNull();
    expect(screen.queryByLabelText('Attach to')).toBeNull();
  });
});
