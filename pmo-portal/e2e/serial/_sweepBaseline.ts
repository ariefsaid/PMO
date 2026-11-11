import { formatKeysetCursor } from '../../src/lib/adapterSeam/erpnext/keysetScan';

export interface ProcurementSweepKind {
  doctype: string;
  domain: string;
}

export interface SweepBaselineRow {
  org_id: string;
  external_tier: 'erpnext';
  domain: string;
  watermark_cursor: string;
}

export interface SweepBaselineDeps {
  orgId: string;
  company: string;
  kinds: readonly ProcurementSweepKind[];
  readLatest: (doctype: string, company: string) => Promise<{ modified: string; name: string } | null>;
  writeRows: (rows: readonly SweepBaselineRow[]) => Promise<void>;
}

export async function primeProcurementSweepBaseline(deps: SweepBaselineDeps): Promise<void> {
  const rows = await Promise.all(deps.kinds.map(async ({ doctype, domain }): Promise<SweepBaselineRow> => {
    const latest = await deps.readLatest(doctype, deps.company);
    return {
      org_id: deps.orgId,
      external_tier: 'erpnext',
      domain,
      watermark_cursor: latest ? formatKeysetCursor(latest.modified, latest.name) : '',
    };
  }));

  await deps.writeRows(rows);
}
