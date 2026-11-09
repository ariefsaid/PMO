/**
 * Time-and-materials repository contract (#1514 T7, ADR-0017).
 *
 * One-to-one with the DAL: every rule (who may set a rate, who may prepare, who confirms) lives in the 0515-0518
 * security-definer RPCs, so the seam adds no gate of its own and a future backend must preserve that split — folding
 * `prepare` into a client write, or pricing a preview line here, would move a money rule into the browser.
 */
import type * as dal from '@/src/lib/db/timeAndMaterials';

export interface TimeAndMaterialsRepository {
  listRateLines: typeof dal.listRateLines;
  listRateAssignees: typeof dal.listRateAssignees;
  saveContractRateLine: typeof dal.saveContractRateLine;
  endContractRateLine: typeof dal.endContractRateLine;
  setContractRateAssignee: typeof dal.setContractRateAssignee;
  endContractRateAssignee: typeof dal.endContractRateAssignee;
  assembleTmClaim: typeof dal.assembleTmClaim;
  deselectTmSource: typeof dal.deselectTmSource;
  prepareTmSignoff: typeof dal.prepareTmSignoff;
  withdrawTmSignoff: typeof dal.withdrawTmSignoff;
  confirmTmSignoff: typeof dal.confirmTmSignoff;
  /** #1817: no-ERP orgs only; the ERP path stays `raiseInvoice`. */
  invoiceNativeTmClaim: typeof dal.invoiceTmClaimNative;
  listTmClaims: typeof dal.listTmClaims;
  previewTmClaim: typeof dal.previewTmClaim;
  listTmClaimSources: typeof dal.listTmClaimSources;
}
