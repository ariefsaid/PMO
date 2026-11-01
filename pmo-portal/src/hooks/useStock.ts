import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { StockItemInput, StockUnitInput, StockWarehouseInput } from '@/src/lib/db/stockMaster';
import type { StockDocumentFilters, StockDocumentInput } from '@/src/lib/db/stockDocuments';
import type { StockLedgerFilters } from '@/src/lib/db/stockReports';
import type { MaterialAllowanceInput } from '@/src/lib/db/stockAllowances';

/** Stock master data reads (#1512 S1). Every key carries the org id so the cache is tenant-scoped. */
export function useStockUnits(includeArchived = false) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-units', orgId, includeArchived], queryFn: () => repositories.stock.master.listUnits(includeArchived), enabled: Boolean(orgId) });
}
export function useStockItems(includeArchived = false) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-items', orgId, includeArchived], queryFn: () => repositories.stock.master.listItems(includeArchived), enabled: Boolean(orgId) });
}
export function useStockWarehouses(includeArchived = false) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-warehouses', orgId, includeArchived], queryFn: () => repositories.stock.master.listWarehouses(includeArchived), enabled: Boolean(orgId) });
}
export function useStockKeepers() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-keepers', orgId], queryFn: () => repositories.stock.master.listKeepers(), enabled: Boolean(orgId) });
}

type MasterTable = 'stock_units' | 'stock_items' | 'stock_warehouses';
const KEY: Record<MasterTable, string> = { stock_units: 'stock-units', stock_items: 'stock-items', stock_warehouses: 'stock-warehouses' };

/** Master-data writes; each invalidates its own list (a unit change also moves the item list, which shows the unit). */
export function useStockMasterMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const m = repositories.stock.master;
  const refresh = (...keys: string[]) => () => { for (const k of keys) void qc.invalidateQueries({ queryKey: [k, orgId] }); };
  return {
    createUnit: useMutation({ mutationFn: (i: StockUnitInput) => m.createUnit(i), onSuccess: refresh('stock-units') }),
    updateUnit: useMutation({ mutationFn: (a: { id: string; input: StockUnitInput }) => m.updateUnit(a.id, a.input), onSuccess: refresh('stock-units', 'stock-items') }),
    createItem: useMutation({ mutationFn: (i: StockItemInput) => m.createItem(i), onSuccess: refresh('stock-items') }),
    updateItem: useMutation({ mutationFn: (a: { id: string; input: StockItemInput }) => m.updateItem(a.id, a.input), onSuccess: refresh('stock-items') }),
    createWarehouse: useMutation({ mutationFn: (i: StockWarehouseInput) => m.createWarehouse(i), onSuccess: refresh('stock-warehouses') }),
    updateWarehouse: useMutation({ mutationFn: (a: { id: string; input: StockWarehouseInput }) => m.updateWarehouse(a.id, a.input), onSuccess: refresh('stock-warehouses') }),
    archive: useMutation({
      mutationFn: (a: { table: MasterTable; id: string; archived: boolean }) => m.archive(a.table, a.id, a.archived),
      onSuccess: (_d, a) => refresh(KEY[a.table], ...(a.table === 'stock_units' ? ['stock-items'] : []))(),
    }),
    setKeeper: useMutation({ mutationFn: (a: { warehouseId: string; userId: string; assigned: boolean }) => m.setKeeper(a), onSuccess: refresh('stock-keepers') }),
  };
}

/** Active org members a warehouse keeper can be picked from (RLS scopes the org). */
export function useStockKeeperCandidates() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['stock-keeper-candidates', orgId],
    queryFn: async () => (await repositories.profile.listOrgProfiles()).filter((p) => p.status === 'active'),
    enabled: Boolean(orgId),
  });
}

const DOC_PAGE = 50;

/** Stock reads and document writes (#1512 S3). Quantities and money are decimal strings. */
export function useStockOnHand(f: { warehouseId?: string; itemId?: string; includeZero?: boolean }, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-on-hand', orgId, f], queryFn: () => repositories.stock.reports.onHand(f), enabled: Boolean(orgId) && enabled });
}
export function useStockLedger(f: StockLedgerFilters) {
  const orgId = useAuth().currentUser?.org_id;
  return useInfiniteQuery({
    queryKey: ['stock-ledger', orgId, f],
    queryFn: ({ pageParam }) => repositories.stock.reports.ledgerPage({ ...f, beforeSeq: pageParam, limit: 100 }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBeforeSeq ?? undefined,
    enabled: Boolean(orgId),
  });
}
export function useStockDocuments(f: Omit<StockDocumentFilters, 'before' | 'limit'>) {
  const orgId = useAuth().currentUser?.org_id;
  return useInfiniteQuery({
    queryKey: ['stock-documents', orgId, f],
    queryFn: ({ pageParam }) => repositories.stock.documents.list({ ...f, limit: DOC_PAGE, before: pageParam }),
    initialPageParam: undefined as { createdAt: string; id: string } | undefined,
    getNextPageParam: (last) => (last.length < DOC_PAGE ? undefined : { createdAt: last[last.length - 1].created_at, id: last[last.length - 1].id }),
    enabled: Boolean(orgId),
  });
}
export function useStockDocumentEntries(documentId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-ledger', orgId, 'document', documentId], queryFn: () => repositories.stock.reports.ledgerAll({ documentId }), enabled: Boolean(orgId && documentId) });
}
export function useStockDocument(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-document', orgId, id], queryFn: () => repositories.stock.documents.get(id as string), enabled: Boolean(orgId && id) });
}
export function useStockDocumentCosts(id: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-document', orgId, id, 'costs'], queryFn: () => repositories.stock.documents.costs(id as string), enabled: Boolean(orgId && id) && enabled });
}
export function useIssuableWorkItems(projectId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-work-items', orgId, projectId], queryFn: () => repositories.stock.documents.issuableWorkItems(projectId as string), enabled: Boolean(orgId && projectId) });
}

export function useProjectIssueLines(projectId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-issue-lines', orgId, projectId], queryFn: () => repositories.stock.documents.issueLines(projectId as string), enabled: Boolean(orgId && projectId) });
}
/** Ongoing projects: the only ones stock can be issued to (FR-STK-020). */
export function useIssuableProjects() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-issuable-projects', orgId], queryFn: () => repositories.project.list({ status: 'Ongoing Project' }), enabled: Boolean(orgId) });
}

/** Every mutation refreshes what a posting moves: balances, the trace, the lists, and the project's consumption (S5 key). */
export function useStockDocumentMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const d = repositories.stock.documents;
  const refresh = () => {
    for (const k of ['stock-on-hand', 'stock-ledger', 'stock-documents', 'stock-document', 'stock-consumption']) void qc.invalidateQueries({ queryKey: [k, orgId] });
  };
  return {
    create: useMutation({ mutationFn: (a: { input: StockDocumentInput; post: boolean; clientRequestId: string }) => d.create(a.input, a), onSuccess: refresh }),
    saveDraft: useMutation({ mutationFn: (a: { id: string; input: StockDocumentInput }) => d.saveDraft(a.id, a.input), onSuccess: refresh }),
    post: useMutation({ mutationFn: (a: { id: string; revision?: number }) => d.post(a.id, a.revision), onSuccess: refresh, onError: refresh }),
    cancel: useMutation({ mutationFn: (id: string) => d.cancel(id), onSuccess: refresh }),
  };
}

/** Project consumption vs allowance (#1512 S5). The key carries the org; posting invalidates `['stock-consumption', orgId]`. */
export function useProjectConsumption(projectId: string | undefined, from: string, to: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['stock-consumption', orgId, projectId, from, to],
    queryFn: () => repositories.stock.consumption.report(projectId as string, from, to),
    enabled: Boolean(orgId && projectId),
  });
}
export function useAllowances(projectId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-allowances', orgId, projectId], queryFn: () => repositories.stock.allowances.list(projectId as string), enabled: Boolean(orgId && projectId) });
}
/** An allowance change moves the report's variance too, so both keys refresh. */
export function useAllowanceMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const refresh = () => { for (const k of ['stock-allowances', 'stock-consumption']) void qc.invalidateQueries({ queryKey: [k, orgId] }); };
  return {
    set: useMutation({ mutationFn: (i: MaterialAllowanceInput) => repositories.stock.allowances.set(i), onSuccess: refresh }),
    clear: useMutation({ mutationFn: (id: string) => repositories.stock.allowances.clear(id), onSuccess: refresh }),
  };
}

/** Reorder levels (#1512 S6). The suggestion changes nothing; only `setLevel` writes, then both reads refresh. */
export function useReorderSuggestion(warehouseId: string | undefined, itemId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['stock-reorder-suggestion', orgId, warehouseId, itemId],
    queryFn: () => repositories.stock.reorder.suggestion(warehouseId as string, itemId as string),
    enabled: Boolean(orgId && warehouseId && itemId),
  });
}
export function useBelowReorder(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-below-reorder', orgId], queryFn: () => repositories.stock.reorder.worklist(), enabled: enabled && Boolean(orgId) });
}
export function useSetReorderLevel() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: (a: { warehouseId: string; itemId: string; level: string | null; quantity?: string | null }) => repositories.stock.reorder.setLevel(a),
    onSuccess: () => { for (const k of ['stock-below-reorder', 'stock-reorder-suggestion']) void qc.invalidateQueries({ queryKey: [k, orgId] }); },
  });
}
