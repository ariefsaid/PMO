import { useNavigate, useLocation } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useStockWarehouses } from '@/src/hooks/useStock';
import type { BelowReorderRow } from '@/src/lib/db/stockReorder';
import { buildRestockUrl, restockQuantity } from '@/src/lib/stockRequestPurchase';

/** "Request purchase" for an item at or below its reorder level: opens the purchase form pre-filled, and Cancel there returns here. */
export function useRequestPurchase() {
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const navigate = useNavigate();
  const location = useLocation();
  const warehouses = useStockWarehouses(false);
  // Raising a request is open to every member; view-as is view-only (UX only, RLS decides).
  const canRequest = may('create', 'procurement') && realRole === effectiveRole;
  const request = (r: BelowReorderRow, unitValue?: string | null) => {
    const projectId = (warehouses.data ?? []).find((w) => w.id === r.warehouseId)?.project_id ?? null;
    navigate(buildRestockUrl({
      itemCode: r.itemCode, itemName: r.itemName, unitCode: r.unitCode,
      quantity: restockQuantity(r.reorderLevel, r.qtyOnHand, r.reorderQuantity), projectId, unitValue,
      from: location.pathname + location.search,
    }));
  };
  return { canRequest, request };
}
