/**
 * Odoo stock mappings resolver (AC-OSP-001, AC-OSP-006).
 *
 * Resolves the PMO items and warehouses of a stock document to verified, company-scoped Odoo records before any
 * outbox claim or ERP mutation. Read only.
 * - Links live in `external_refs`: domain `stock_items` (PMO stock item id to Odoo `product.product` id) and domain
 *   `stock_warehouses` (PMO warehouse id to the Odoo internal `stock.location` id). All of a document's links are read in
 *   one query. A missing link refuses and points the Admin to stock matching in Integration setup; nothing is created in Odoo.
 * - A record that belongs to another company, is inactive, is not storable or cannot be read refuses.
 * - The organisation and company come from the server; this resolver never takes either from a caller-supplied id.
 */
import type { OdooCall } from '../client.ts';
import { resolveExternalRefs, type ExternalRefsBatchClient } from '../../refs.ts';
import { resolveStockProject } from './project.ts';

export interface StockMappingLine {
  stockItemId: string;
}

export interface StockMappingParams {
  orgId: string;
  companyId: number;
  documentId: string;
  kind: 'transfer' | 'issue';
  lines: StockMappingLine[];
  sourceWarehouseId: string;
  destinationWarehouseId?: string;
  operationTypeId?: number;
  projectId?: string;
  analyticAccountId?: number;
}

export type StockMappingRefusalReason =
  | 'binding-unavailable'
  | 'foreign-company'
  | 'item-unmapped'
  | 'item-ambiguous'
  | 'product-unavailable'
  | 'warehouse-unmapped'
  | 'location-ambiguous'
  | 'location-unavailable'
  | 'project-unlinked'
  | 'project-ambiguous'
  | 'project-unavailable'
  | 'read-failed';

export type ResolveStockMappingsResult =
  | {
      ok: true;
      companyId: number;
      lines: Array<{ stockItemId: string; productId: number }>;
      sourceLocationId: number;
      destinationLocationId: number;
      projectId?: number;
      analyticAccountId?: number;
    }
  | {
      ok: false;
      reason: StockMappingRefusalReason;
      subjectId?: string;
      message: string;
    };

export interface CostAccountResult {
  status: 'resolved' | 'unlinked' | 'needs-attention';
  accountId?: string;
  reason?: string;
}

export interface StockMappingDeps {
  call: OdooCall;
  client: ExternalRefsBatchClient;
  resolveCostAccount?: (projectId: string) => Promise<CostAccountResult>;
}

interface LocationRow {
  id: number;
  complete_name?: unknown;
  usage?: unknown;
  company_id?: unknown;
  active?: unknown;
}

interface ProductRow {
  id: number;
  name?: unknown;
  default_code?: unknown;
  is_storable?: unknown;
  company_id?: unknown;
  active?: unknown;
}

function extractCompanyId(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0];
  return null;
}

/**
 * Resolves PMO stock document mappings into Odoo master IDs and validates company, status, and usage.
 */
export async function resolveStockMappings(
  params: StockMappingParams,
  deps: StockMappingDeps,
): Promise<ResolveStockMappingsResult> {
  const { orgId, companyId, documentId, kind, lines, sourceWarehouseId } = params;

  // 1. Guard core identifiers
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return {
      ok: false,
      reason: 'binding-unavailable',
      message: `Invalid company ID: ${companyId}.`,
    };
  }

  if (typeof orgId !== 'string' || orgId.trim() === '') {
    return {
      ok: false,
      reason: 'binding-unavailable',
      message: 'Missing organization ID.',
    };
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      ok: false,
      reason: 'read-failed',
      subjectId: documentId,
      message: `Document ${documentId} has no lines.`,
    };
  }

  if (typeof sourceWarehouseId !== 'string' || sourceWarehouseId.trim() === '') {
    return {
      ok: false,
      reason: 'warehouse-unmapped',
      message: 'Missing source warehouse ID.',
    };
  }

  // 3. Document kind prerequisites
  if (kind === 'transfer') {
    if (!params.destinationWarehouseId || params.destinationWarehouseId.trim() === '') {
      return {
        ok: false,
        reason: 'warehouse-unmapped',
        message: 'Transfer requires a destination warehouse.',
      };
    }
  } else if (kind === 'issue') {
    if (!params.projectId || params.projectId.trim() === '') {
      return {
        ok: false,
        reason: 'project-unlinked',
        message: 'Issue requires a PMO project.',
      };
    }
  }

  // 4. Every link of the document, in one read
  const destinationWarehouseId = kind === 'transfer' ? params.destinationWarehouseId! : undefined;
  let links: Map<string, string>;
  try {
    links = await resolveExternalRefs(
      deps.client,
      orgId,
      ['stock_warehouses', 'stock_items'],
      [...new Set([sourceWarehouseId, ...(destinationWarehouseId ? [destinationWarehouseId] : []), ...lines.map((l) => l.stockItemId)])],
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'read-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  // 5. Source warehouse -> Odoo stock.location
  const sourceLocRef = links.get(`stock_warehouses:${sourceWarehouseId}`);
  if (!sourceLocRef) {
    return {
      ok: false,
      reason: 'warehouse-unmapped',
      subjectId: sourceWarehouseId,
      message: `Warehouse ${sourceWarehouseId} is unmapped in Integration setup. Match warehouse in Integration setup.`,
    };
  }

  const sourceLocationId = Number(sourceLocRef);
  if (!Number.isInteger(sourceLocationId) || sourceLocationId <= 0) {
    return {
      ok: false,
      reason: 'location-unavailable',
      subjectId: sourceWarehouseId,
      message: `Mapped location ID "${sourceLocRef}" for warehouse ${sourceWarehouseId} is invalid.`,
    };
  }

  // 6. Destination location: the destination warehouse's location for a transfer, the operation type's for an issue
  let destinationLocationId: number;
  let opTypeDesc = '';

  if (kind === 'transfer') {
    const destWhId = destinationWarehouseId!;
    const destLocRef = links.get(`stock_warehouses:${destWhId}`);
    if (!destLocRef) {
      return {
        ok: false,
        reason: 'warehouse-unmapped',
        subjectId: destWhId,
        message: `Destination warehouse ${destWhId} is unmapped in Integration setup. Match warehouse in Integration setup.`,
      };
    }

    destinationLocationId = Number(destLocRef);
    if (!Number.isInteger(destinationLocationId) || destinationLocationId <= 0) {
      return {
        ok: false,
        reason: 'location-unavailable',
        subjectId: destWhId,
        message: `Mapped location ID "${destLocRef}" for destination warehouse ${destWhId} is invalid.`,
      };
    }
  } else {
    const opTypeId = params.operationTypeId;
    if (!opTypeId || !Number.isInteger(opTypeId) || opTypeId <= 0) {
      return {
        ok: false,
        reason: 'location-unavailable',
        message: 'Operation type ID is required to resolve destination location for issue. Configure a valid stock operation type in Integration setup.',
      };
    }

    interface PickingTypeRow {
      id: number;
      name?: unknown;
      company_id?: unknown;
      default_location_dest_id?: unknown;
    }

    let opTypes: PickingTypeRow[];
    try {
      opTypes = await deps.call<PickingTypeRow[]>('stock.picking.type', 'search_read', {
        domain: [['id', '=', opTypeId]],
        fields: ['id', 'name', 'company_id', 'default_location_dest_id'],
        limit: 1,
      });
    } catch (err) {
      return {
        ok: false,
        reason: 'read-failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (!Array.isArray(opTypes) || opTypes.length === 0) {
      return {
        ok: false,
        reason: 'location-unavailable',
        message: `Stock operation type with ID ${opTypeId} was not found in Odoo. Configure a valid operation type in Integration setup.`,
      };
    }

    const opType = opTypes[0];
    const typeName = typeof opType.name === 'string' ? `"${opType.name}" ` : '';
    opTypeDesc = `${typeName}(ID ${opTypeId})`;

    if (!opType.default_location_dest_id) {
      return {
        ok: false,
        reason: 'location-unavailable',
        message: `Stock operation type ${opTypeDesc} has no default destination location configured in Odoo. Configure default destination location on operation type ${opTypeId} in Odoo.`,
      };
    }

    const rawDestLocId = Array.isArray(opType.default_location_dest_id)
      ? opType.default_location_dest_id[0]
      : opType.default_location_dest_id;
    const derivedId = Number(rawDestLocId);
    if (!Number.isInteger(derivedId) || derivedId <= 0) {
      return {
        ok: false,
        reason: 'location-unavailable',
        message: `Configured destination location ID for operation type ${opTypeDesc} is invalid. Configure a valid destination location on operation type ${opTypeId} in Odoo.`,
      };
    }

    destinationLocationId = derivedId;
  }

  // 7. Items -> Odoo products
  const resolvedLines: Array<{ stockItemId: string; productId: number }> = [];

  for (const line of lines) {
    const itemRef = links.get(`stock_items:${line.stockItemId}`);
    if (!itemRef) {
      return {
        ok: false,
        reason: 'item-unmapped',
        subjectId: line.stockItemId,
        message: `Stock item ${line.stockItemId} is unmapped in Integration setup. Match stock item in Integration setup.`,
      };
    }

    const prodId = Number(itemRef);
    if (!Number.isInteger(prodId) || prodId <= 0) {
      return {
        ok: false,
        reason: 'product-unavailable',
        subjectId: line.stockItemId,
        message: `Mapped product ID "${itemRef}" for stock item ${line.stockItemId} is invalid.`,
      };
    }

    resolvedLines.push({ stockItemId: line.stockItemId, productId: prodId });
  }

  // 8. Live Odoo read for location validity
  const locationIds = Array.from(new Set([sourceLocationId, destinationLocationId]));
  let locRows: LocationRow[];
  try {
    locRows = await deps.call<LocationRow[]>('stock.location', 'search_read', {
      domain: [['id', 'in', locationIds]],
      fields: ['id', 'complete_name', 'usage', 'company_id', 'active'],
      context: { active_test: false },
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'read-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const locMap = new Map((locRows ?? []).map((l) => [l.id, l]));

  // Validate source location
  const sourceLoc = locMap.get(sourceLocationId);
  if (!sourceLoc) {
    return {
      ok: false,
      reason: 'location-unavailable',
      subjectId: sourceWarehouseId,
      message: `Location ${sourceLocationId} not found in Odoo.`,
    };
  }

  if (sourceLoc.active === false) {
    return {
      ok: false,
      reason: 'location-unavailable',
      subjectId: sourceWarehouseId,
      message: `Location ${sourceLocationId} is inactive or archived in Odoo.`,
    };
  }

  const sourceCompanyId = extractCompanyId(sourceLoc.company_id);
  if (sourceCompanyId !== companyId) {
    return {
      ok: false,
      reason: 'foreign-company',
      subjectId: sourceWarehouseId,
      message: `Location ${sourceLocationId} belongs to company ${sourceCompanyId ?? 'none'}, expected company ${companyId}.`,
    };
  }

  if (sourceLoc.usage !== 'internal') {
    return {
      ok: false,
      reason: 'location-unavailable',
      subjectId: sourceWarehouseId,
      message: `Location ${sourceLocationId} has usage '${sourceLoc.usage}', expected 'internal'.`,
    };
  }

  // Validate destination location
  const destLoc = locMap.get(destinationLocationId);
  if (!destLoc) {
    if (kind === 'issue') {
      const fixTarget = `operation type ${opTypeDesc}`;
      return {
        ok: false,
        reason: 'location-unavailable',
        message: `Destination location ${destinationLocationId} for ${fixTarget} was not found in Odoo. Configure a valid destination location on operation type in Odoo.`,
      };
    }
    return {
      ok: false,
      reason: 'location-unavailable',
      subjectId: params.destinationWarehouseId,
      message: `Destination location ${destinationLocationId} not found in Odoo.`,
    };
  }

  if (destLoc.active === false) {
    if (kind === 'issue') {
      const fixTarget = `operation type ${opTypeDesc}`;
      return {
        ok: false,
        reason: 'location-unavailable',
        message: `Destination location ${destinationLocationId} for ${fixTarget} is inactive or archived in Odoo. Configure an active destination location on operation type in Odoo.`,
      };
    }
    return {
      ok: false,
      reason: 'location-unavailable',
      subjectId: params.destinationWarehouseId,
      message: `Destination location ${destinationLocationId} is inactive or archived in Odoo.`,
    };
  }

  const destCompanyId = extractCompanyId(destLoc.company_id);
  if (kind === 'issue') {
    if (destCompanyId !== null && destCompanyId !== companyId) {
      const fixTarget = `operation type ${opTypeDesc}`;
      return {
        ok: false,
        reason: 'location-unavailable',
        message: `Destination location ${destinationLocationId} for ${fixTarget} belongs to company ${destCompanyId}, expected company ${companyId} or shared (no company). Configure an allowed destination location on operation type in Odoo.`,
      };
    }

    if (destLoc.usage !== 'customer') {
      const fixTarget = `operation type ${opTypeDesc}`;
      return {
        ok: false,
        reason: 'location-unavailable',
        message: `Destination location ${destinationLocationId} for ${fixTarget} has usage '${destLoc.usage}', expected 'customer'. Configure a customer destination location on operation type in Odoo.`,
      };
    }
  } else {
    if (destCompanyId !== companyId) {
      return {
        ok: false,
        reason: 'foreign-company',
        subjectId: params.destinationWarehouseId,
        message: `Destination location ${destinationLocationId} belongs to company ${destCompanyId ?? 'none'}, expected company ${companyId}.`,
      };
    }

    if (destLoc.usage !== 'internal') {
      return {
        ok: false,
        reason: 'location-unavailable',
        subjectId: params.destinationWarehouseId,
        message: `Destination location ${destinationLocationId} has usage '${destLoc.usage}', expected 'internal'.`,
      };
    }
  }

  // 9. Live Odoo read for product validity
  const uniqueProductIds = Array.from(new Set(resolvedLines.map((l) => l.productId)));
  let prodRows: ProductRow[];
  try {
    prodRows = await deps.call<ProductRow[]>('product.product', 'search_read', {
      domain: [['id', 'in', uniqueProductIds]],
      fields: ['id', 'name', 'default_code', 'is_storable', 'company_id', 'active'],
      context: { active_test: false },
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'read-failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const prodMap = new Map((prodRows ?? []).map((p) => [p.id, p]));

  for (const line of resolvedLines) {
    const prod = prodMap.get(line.productId);
    if (!prod) {
      return {
        ok: false,
        reason: 'product-unavailable',
        subjectId: line.stockItemId,
        message: `Product ${line.productId} not found in Odoo for stock item ${line.stockItemId}.`,
      };
    }

    if (prod.active === false) {
      return {
        ok: false,
        reason: 'product-unavailable',
        subjectId: line.stockItemId,
        message: `Product ${line.productId} is inactive or archived in Odoo for stock item ${line.stockItemId}.`,
      };
    }

    if (prod.is_storable !== true) {
      return {
        ok: false,
        reason: 'product-unavailable',
        subjectId: line.stockItemId,
        message: `Product ${line.productId} is not storable in Odoo for stock item ${line.stockItemId}.`,
      };
    }

    const prodCompanyId = extractCompanyId(prod.company_id);
    if (prodCompanyId !== companyId) {
      return {
        ok: false,
        reason: 'foreign-company',
        subjectId: line.stockItemId,
        message: `Product ${line.productId} belongs to company ${prodCompanyId ?? 'none'}, expected company ${companyId}.`,
      };
    }
  }

  // 10. For issues: resolve project
  let resolvedProjectId: number | undefined;
  let resolvedAnalyticAccountId: number | undefined;

  if (kind === 'issue') {
    const pmoProjectId = params.projectId!;

    if (params.analyticAccountId && Number.isInteger(params.analyticAccountId) && params.analyticAccountId > 0) {
      resolvedAnalyticAccountId = params.analyticAccountId;
    } else if (deps.resolveCostAccount) {
      let costRes: CostAccountResult;
      try {
        costRes = await deps.resolveCostAccount(pmoProjectId);
      } catch (err) {
        return {
          ok: false,
          reason: 'read-failed',
          subjectId: pmoProjectId,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      if (costRes.status === 'unlinked') {
        return {
          ok: false,
          reason: 'project-unlinked',
          subjectId: pmoProjectId,
          message: `PMO project ${pmoProjectId} has no bound Odoo analytic account.`,
        };
      }

      if (costRes.status === 'needs-attention') {
        return {
          ok: false,
          reason: 'project-unavailable',
          subjectId: pmoProjectId,
          message: `Bound analytic account for project ${pmoProjectId} is unavailable: ${costRes.reason ?? 'needs-attention'}.`,
        };
      }

      const aaId = Number(costRes.accountId);
      if (!Number.isInteger(aaId) || aaId <= 0) {
        return {
          ok: false,
          reason: 'project-unavailable',
          subjectId: pmoProjectId,
          message: `Bound analytic account ID "${costRes.accountId}" for project ${pmoProjectId} is invalid.`,
        };
      }
      resolvedAnalyticAccountId = aaId;
    } else {
      return {
        ok: false,
        reason: 'project-unlinked',
        subjectId: pmoProjectId,
        message: `Cannot resolve project ${pmoProjectId} without analytic account or cost account resolver.`,
      };
    }

    const projRes = await resolveStockProject(deps.call, companyId, resolvedAnalyticAccountId);
    if (!projRes.ok) {
      return {
        ok: false,
        reason: projRes.reason,
        subjectId: pmoProjectId,
        message: projRes.message,
      };
    }

    resolvedProjectId = projRes.projectId;
  }

  // 11. Bundle of section E
  return {
    ok: true,
    companyId,
    lines: resolvedLines,
    sourceLocationId,
    destinationLocationId,
    ...(kind === 'issue'
      ? {
          projectId: resolvedProjectId,
          analyticAccountId: resolvedAnalyticAccountId,
            }
      : {}),
  };
}
