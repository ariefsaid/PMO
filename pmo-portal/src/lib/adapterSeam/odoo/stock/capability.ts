/**
 * Odoo stock posting capability preflight (AC-OSP-001, FR-OSP-001, Task 4 of #1508).
 *
 * Verifies that connected Odoo stock operations have the required modules installed
 * (`stock`, `stock_account`, `project_stock_account`) and that the designated operation
 * type (`stock.picking.type`) exists, belongs to the configured company, and has the
 * `analytic_costs` flag enabled for native project costing.
 *
 * Reads only: makes zero write calls. Never caches a success.
 */
import type { OdooCall } from '../client.ts';

export const REQUIRED_STOCK_MODULES = ['stock', 'stock_account', 'project_stock_account'] as const;

export type StockCapabilityRefusalReason =
  | 'missing-module-stock'
  | 'missing-module-stock_account'
  | 'missing-module-project_stock_account'
  | 'operation-type-not-found'
  | 'operation-type-wrong-company'
  | 'analytic-costs-disabled'
  | 'read-failed';

export type StockCapabilityResult =
  | { ok: true }
  | { ok: false; reason: StockCapabilityRefusalReason; message: string };

interface ModuleRow {
  name?: unknown;
  state?: unknown;
}

interface PickingTypeRow {
  id?: unknown;
  name?: unknown;
  code?: unknown;
  company_id?: unknown;
  analytic_costs?: unknown;
}

function extractCompanyId(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (Array.isArray(value) && typeof value[0] === 'number') return value[0];
  return null;
}

/**
 * Preflight capability check for Odoo stock posting.
 *
 * Evaluates whether Odoo is ready to perform connected inventory operations and native
 * project-costed stock movements. Refuses with actionable administrative guidance if any
 * required module is absent, the operation type is missing, misconfigured, scoped to another
 * company, or lacks the analytic_costs flag.
 */
export async function checkStockCapability(
  call: OdooCall,
  companyId: number,
  operationTypeId: number,
): Promise<StockCapabilityResult> {
  try {
    const modules = await call<ModuleRow[]>('ir.module.module', 'search_read', {
      domain: [['name', 'in', REQUIRED_STOCK_MODULES]],
      fields: ['name', 'state'],
    });

    const installed = new Set(
      (Array.isArray(modules) ? modules : [])
        .filter((m) => typeof m.name === 'string' && m.state === 'installed')
        .map((m) => m.name as string),
    );

    if (!installed.has('stock')) {
      return {
        ok: false,
        reason: 'missing-module-stock',
        message: 'Install the Odoo "stock" (Inventory) app to enable connected stock.',
      };
    }
    if (!installed.has('stock_account')) {
      return {
        ok: false,
        reason: 'missing-module-stock_account',
        message: 'Install the Odoo "stock_account" module to enable inventory valuation.',
      };
    }
    if (!installed.has('project_stock_account')) {
      return {
        ok: false,
        reason: 'missing-module-project_stock_account',
        message: 'Install the Odoo "project_stock_account" module to enable native project costing on stock movements.',
      };
    }

    const pickingTypes = await call<PickingTypeRow[]>('stock.picking.type', 'search_read', {
      domain: [['id', '=', operationTypeId]],
      fields: ['id', 'name', 'code', 'company_id', 'analytic_costs'],
      limit: 1,
    });

    if (!Array.isArray(pickingTypes) || pickingTypes.length === 0) {
      return {
        ok: false,
        reason: 'operation-type-not-found',
        message: `Stock operation type with ID ${operationTypeId} was not found in Odoo. Configure a valid operation type.`,
      };
    }

    const opType = pickingTypes[0];
    const opCompanyId = extractCompanyId(opType.company_id);
    if (opCompanyId !== companyId) {
      const typeName = typeof opType.name === 'string' ? `"${opType.name}" ` : '';
      return {
        ok: false,
        reason: 'operation-type-wrong-company',
        message: `Stock operation type ${typeName}(ID ${operationTypeId}) belongs to company ${opCompanyId ?? 'none'}, not configured company ${companyId}. Select an operation type for the configured company in Odoo.`,
      };
    }

    if (opType.analytic_costs !== true) {
      const typeName = typeof opType.name === 'string' ? `"${opType.name}" ` : '';
      return {
        ok: false,
        reason: 'analytic-costs-disabled',
        message: `Switch on project costs (analytic_costs) for operation type ${typeName}(ID ${operationTypeId}) in Odoo.`,
      };
    }

    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: 'read-failed',
      message: `Failed to read stock capability from Odoo: ${detail}. Check connection and permissions.`,
    };
  }
}
