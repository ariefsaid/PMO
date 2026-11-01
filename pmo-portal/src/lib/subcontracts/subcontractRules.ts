/**
 * Subcontract display and calculation rules (mirror of the SQL cap in 0472).
 *
 * Implemented in thousandths (Math.round(x * 1000)) to avoid IEEE-754 float drift,
 * matching Postgres numeric(14,3).
 */

export interface PayableInput {
  poQty: number;
  verified: number;
  billed: number;
}

export interface VerifiedNotOnPoInput {
  poQty: number;
  verified: number;
}

export interface SubcontractPositionLineInput {
  boqItemId: string;
  itemCode?: string;
  unit?: string;
  rate: number;
  poQty: number;
  verified: number;
  billed: number | null;
  payable?: number | null;
  verifiedNotOnPo?: number;
}

export interface BillPrefillLine {
  boqItemId: string;
  quantity: number;
  max: number;
  rate: number;
}

export interface CapMessageInput {
  itemCode: string;
  poQty: number;
  verified: number;
  billed: number | null;
  payable?: number | null;
}

/**
 * FR-SCA-050: payable = min(verified, PO) − billed, floored at 0.
 */
export function payableOf(line: PayableInput): number {
  const poQtyM = Math.round(line.poQty * 1000);
  const verifiedM = Math.round(line.verified * 1000);
  const billedM = Math.round(line.billed * 1000);
  const minCap = Math.min(poQtyM, verifiedM);
  const payableM = Math.max(0, minCap - billedM);
  return payableM / 1000;
}

/**
 * FR-SCA-050: verified, not on PO = max(verified − PO, 0).
 */
export function verifiedNotOnPo(line: VerifiedNotOnPoInput): number {
  const verifiedM = Math.round(line.verified * 1000);
  const poQtyM = Math.round(line.poQty * 1000);
  return Math.max(0, verifiedM - poQtyM) / 1000;
}

/**
 * FR-SCA-051: pre-fill payable quantity per line for the subcontract vendor bill capture.
 */
export function prefillBillLines(lines: readonly SubcontractPositionLineInput[]): BillPrefillLine[] {
  return lines.map((line) => {
    const payable = line.payable != null ? line.payable : payableOf({
      poQty: line.poQty,
      verified: line.verified,
      billed: line.billed ?? 0,
    });
    return {
      boqItemId: line.boqItemId,
      quantity: payable,
      max: payable,
      rate: line.rate,
    };
  });
}

/**
 * FR-SCA-051: states the cap in words at zero; returns null when payable > 0.
 */
export function capMessage(line: CapMessageInput): string | null {
  const payable = line.payable != null ? line.payable : payableOf({
    poQty: line.poQty,
    verified: line.verified,
    billed: line.billed ?? 0,
  });
  if (payable > 0) return null;
  const billed = line.billed ?? 0;
  return `${line.itemCode}: nothing payable — ${line.verified} verified, ${line.poQty} on the PO, ${billed} already billed`;
}
