import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, ListState, StatusPill, useToast, type StatusVariant } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatDateOnly, formatNumberExact } from '@/src/lib/format';
import {
  usePoDraftLines, usePoPosition, useSubcontractAcceptances, useSubcontractCapExceptions, useSubcontractMutations,
} from '@/src/hooks/useSubcontract';
import { useUsers } from '@/src/hooks/useUsers';
import { useDocuments } from '@/src/hooks/useDocuments';
import type { SubcontractAcceptanceWithLines, SubcontractCapExceptionRow, SubcontractPoPositionRow } from '@/src/lib/db/subcontracts';
import SubcontractAcceptanceModal from './SubcontractAcceptanceModal';
import { SubcontractLinesEditor, SubcontractAttributeModal } from './SubcontractLinesEditor';
import PoVariationModal from './PoVariationModal';
import { PoVariationsList } from './PoVariationsList';

/**
 * A subcontract purchase's BoQ lines against the work verified and billed (#1513 S7.2): PO qty, verified,
 * billed, payable and verified-not-on-PO per line, the acceptances that produced them, and the bills the cap
 * could not attribute. Figures come straight from the server position; a failed read shows the error and NO
 * figures, and a `null` billed/payable (a role that may not read invoices) is a dash, never 0.
 */
export interface SubcontractLinesSectionProps {
  poId: string;
  procurementId: string;
  projectId: string;
  currency: string;
  currentUserId?: string;
  projectManagerId?: string | null;
}

const DAY_MS = 86_400_000;
const ACCEPTANCE_VARIANT: Record<string, StatusVariant> = { Draft: 'draft', Confirmed: 'won', Withdrawn: 'superseded' };

const value = (qty: number, rate: number) => Math.round(qty * rate * 100) / 100;

export const SubcontractLinesSection: React.FC<SubcontractLinesSectionProps> = ({
  poId, procurementId, projectId, currency, currentUserId, projectManagerId = null,
}) => {
  const { t } = useTranslation('procurement');
  const may = usePermission();
  const { toast } = useToast();
  const position = usePoPosition(poId);
  const issued = (position.data ?? []).length > 0;
  const draft = usePoDraftLines(poId, !position.isPending && !position.isError && !issued);
  const acceptances = useSubcontractAcceptances(poId);
  const exceptions = useSubcontractCapExceptions(procurementId);
  const documents = useDocuments(projectId);
  const users = useUsers();
  const mutations = useSubcontractMutations(poId, procurementId);

  const [confirmIssue, setConfirmIssue] = useState(false);
  const [editing, setEditing] = useState(false);
  const [acceptance, setAcceptance] = useState<{ draft: SubcontractAcceptanceWithLines | null } | null>(null);
  const [attribute, setAttribute] = useState<SubcontractCapExceptionRow | null>(null);
  const [variation, setVariation] = useState<{ row: SubcontractPoPositionRow; origin: 'pre_work' | 'post_work' } | null>(null);

  const canEditLines = may('edit', 'subcontractLines');
  const canPrepare = may('prepare', 'subcontractAcceptance', { currentUserId, record: { project_manager_id: projectManagerId } });
  const canRequestVariation = may('request', 'poVariation', { currentUserId, record: { requested_by_id: currentUserId } });
  const soleOperator = (users.data ?? []).filter((u) => u.status === 'active').length === 1;

  const fail = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  if (position.isPending) return <Card><CardHead>{t('subcontract.lines.title', 'Subcontract BoQ lines')}</CardHead><CardPad><ListState variant="loading" shape="table" rows={3} /></CardPad></Card>;
  if (position.isError) {
    return (
      <Card>
        <CardHead>{t('subcontract.lines.title', 'Subcontract BoQ lines')}</CardHead>
        <CardPad>
          <ListState variant="error" title={t('subcontract.lines.loadError', 'Could not load the subcontract position.')}
            onRetry={() => void position.refetch()} retryLabel={t('subcontract.lines.retry', 'Retry')} />
        </CardPad>
      </Card>
    );
  }

  const rows: SubcontractPoPositionRow[] = position.data ?? [];
  const billedKnown = rows.every((r) => r.billed !== null);
  const billedTotal = rows.reduce((sum, r) => sum + value(r.billed ?? 0, r.rate), 0);
  const now = Date.now();
  const draftLines = draft.data ?? [];
  const exceptionRows = exceptions.data ?? [];
  const dash = '—';
  const num = (n: number | null) => (n === null ? dash : formatNumberExact(n));

  const reasonLabel = (reason: string) => reason === 'no_lines'
    ? t('subcontract.exceptions.reason.no_lines', 'billed without line quantities')
    : t('subcontract.exceptions.reason.other', 'could not be checked against the cap ({{reason}})', { reason });

  return (
    <Card data-testid="subcontract-lines">
      <CardHead
        actions={
          <div className="flex gap-2">
            {issued && canPrepare && (
              <Button variant="primary" size="sm" onClick={() => setAcceptance({ draft: null })}>
                {t('subcontract.acceptance.record', 'Record acceptance')}
              </Button>
            )}
            {!issued && canEditLines && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {t('subcontract.lines.setLines', 'Set BoQ lines')}
              </Button>
            )}
          </div>
        }
      >
        {t('subcontract.lines.title', 'Subcontract BoQ lines')}
      </CardHead>
      <CardPad className="flex flex-col gap-3">
        {!issued ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t('subcontract.lines.empty', 'No BoQ lines issued')}</p>
            {draftLines.length > 0 ? (
              <div data-testid="subcontract-draft-lines" className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  {t('subcontract.lines.draftCount', '{{count}} draft lines, not yet issued. Issuing freezes revision 1.', { count: draftLines.length })}
                </p>
                {canEditLines && (
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={() => setConfirmIssue(true)}>
                      {t('subcontract.lines.issue', 'Issue lines')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('subcontract.lines.emptyHint', 'Set the BoQ lines this purchase order covers, then issue them to freeze revision 1.')}
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular">
              <thead>
                <tr className="border-b border-border text-left text-sm text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('subcontract.col.line', 'Line')}</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('subcontract.col.unit', 'Unit')}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">{t('subcontract.col.rate', 'Rate')}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">{t('subcontract.col.po', 'PO qty')}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">{t('subcontract.col.verified', 'Verified')}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">{t('subcontract.col.billed', 'Billed')}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">{t('subcontract.col.payable', 'Payable')}</th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-semibold">{t('subcontract.col.notOnPo', 'Verified, not on PO')}</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">{t('subcontract.col.disputed', 'Disputed')}</th>
                  {canRequestVariation && <th scope="col" className="py-1.5 pl-3 text-right font-semibold">{t('subcontract.variations.request', 'Variation')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const days = r.verified_not_on_po > 0 && r.verified_at
                    ? Math.max(0, Math.floor((now - new Date(r.verified_at).getTime()) / DAY_MS)) : null;
                  return (
                    <tr key={r.boq_item_id} className="border-b border-border/60 last:border-0">
                      <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                        <span className="font-mono">{r.item_code}</span>
                        <span className="ml-2 text-muted-foreground">{r.description}</span>
                      </th>
                      <td className="py-1.5 pr-3">{r.unit}</td>
                      <td className="py-1.5 pr-3 text-right">{formatCurrency(r.rate, currency)}</td>
                      <td className="py-1.5 pr-3 text-right">{num(r.po_qty)}</td>
                      <td className="py-1.5 pr-3 text-right">{num(r.verified)}</td>
                      <td className="py-1.5 pr-3 text-right">{num(r.billed)}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold">{num(r.payable)}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {num(r.verified_not_on_po)}
                        {days !== null && (
                          <span className="ml-2"><StatusPill variant="warn">
                            {t('subcontract.lines.notOnPoAge', { count: days, defaultValue_one: 'verified, not on PO for {{count}} day', defaultValue_other: 'verified, not on PO for {{count}} days' })}
                          </StatusPill></span>
                        )}
                      </td>
                      <td className="py-1.5 text-right">{num(r.disputed)}</td>
                      {canRequestVariation && <td className="py-1.5 pl-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button variant="ghost" size="sm" onClick={() => setVariation({ row: r, origin: 'pre_work' })}>
                            {t('subcontract.variations.preWorkAction', 'Pre-work')}
                          </Button>
                          {r.verified_not_on_po > 0 && <Button variant="outline" size="sm" onClick={() => setVariation({ row: r, origin: 'post_work' })}>
                            {t('subcontract.variations.postWorkAction', 'Post-work')}
                          </Button>}
                        </div>
                      </td>}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="text-sm">
                  <td colSpan={canRequestVariation ? 10 : 9} className="pt-2">
                    <div className="flex flex-wrap justify-end gap-x-6 gap-y-1">
                      <span>
                        {t('subcontract.lines.billedTotal', 'Billed value')}{' '}
                        <b data-testid="subcontract-billed-total">{billedKnown ? formatCurrency(billedTotal, currency) : dash}</b>
                      </span>
                      <span>
                        {t('subcontract.lines.billLinesTotal', 'Bill lines total')}{' '}
                        <b data-testid="subcontract-bill-lines-total">{billedKnown ? formatCurrency(billedTotal, currency) : dash}</b>
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {exceptionRows.length > 0 && (
          <div data-testid="subcontract-cap-exceptions" role="status"
            className="rounded-md border border-border bg-warning/10 p-2.5 text-sm">
            <p className="font-semibold">{t('subcontract.exceptions.title', 'Bills the cap could not check')}</p>
            <ul className="mt-1 flex flex-col gap-1">
              {exceptionRows.map((e) => (
                <li key={e.invoice_id} className="flex flex-wrap items-center gap-2">
                  <span>
                    <span className="font-mono">{e.number}</span> ({formatCurrency(e.amount, currency)}): {reasonLabel(e.reason)}
                  </span>
                  {e.reason === 'no_lines' && canEditLines && (
                    <Button variant="outline" size="sm" onClick={() => setAttribute(e)}>
                      {t('subcontract.exceptions.attribute', 'Attribute lines')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {issued && (
          <div className="flex flex-col gap-1.5" data-testid="subcontract-acceptances">
            <p className="text-sm font-semibold text-muted-foreground">{t('subcontract.acceptance.title', 'Acceptances')}</p>
            {acceptances.isPending ? (
              <ListState variant="loading" rows={1} />
            ) : acceptances.isError ? (
              <ListState variant="error" title={t('subcontract.acceptance.loadError', 'Could not load the acceptances.')}
                onRetry={() => void acceptances.refetch()} retryLabel={t('subcontract.lines.retry', 'Retry')} />
            ) : (acceptances.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('subcontract.acceptance.empty', 'No acceptances recorded')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {(acceptances.data ?? []).map((a) => {
                  const isDraft = a.status === 'Draft';
                  const doc = (documents.data ?? []).find((d) => d.id === a.document_id);
                  return (
                    <li key={a.id} className="flex flex-col gap-1 rounded-md border border-border p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold tabular">{formatDateOnly(a.acceptance_date)}</span>
                        <StatusPill variant={ACCEPTANCE_VARIANT[a.status] ?? 'neutral'}>
                          {t(`subcontract.acceptance.status.${a.status}`, a.status)}
                        </StatusPill>
                        <span className="text-sm text-muted-foreground">
                          {doc ? t('subcontract.acceptance.document', 'Signed document: {{title}}', { title: doc.title })
                            : t('subcontract.acceptance.noDocument', 'No signed document linked')}
                        </span>
                        {a.status === 'Confirmed' && a.confirm_basis === 'sole_operator' && (
                          <span className="text-sm text-muted-foreground">{t('subcontract.acceptance.soleOperator', 'Confirmed by the only active member')}</span>
                        )}
                      </div>
                      {isDraft && (
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => setAcceptance({ draft: a })}>
                            {t('subcontract.acceptance.review', 'Review draft')}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        {issued && <PoVariationsList poId={poId} projectId={projectId} currency={currency} />}
      </CardPad>

      <ConfirmDialog
        open={confirmIssue}
        title={t('subcontract.lines.issueTitle', 'Issue BoQ lines?')}
        description={t('subcontract.lines.issueBody', 'Issuing freezes revision 1 of this purchase order. Later changes go through a variation.')}
        confirmLabel={t('subcontract.lines.issueConfirm', 'Issue')}
        loading={mutations.issuePoLines.isPending}
        onCancel={() => setConfirmIssue(false)}
        onConfirm={() => void mutations.issuePoLines.mutateAsync().then(
          () => { setConfirmIssue(false); toast(t('subcontract.lines.issued', 'BoQ lines issued'), undefined, 'success'); },
          (err: unknown) => { setConfirmIssue(false); fail(err); },
        )}
      />
      {editing && (
        <SubcontractLinesEditor projectId={projectId} initial={draftLines} currency={currency}
          onClose={() => setEditing(false)}
          onSave={(lines) => mutations.setPoLines.mutateAsync(lines)} />
      )}
      {acceptance && (
        <SubcontractAcceptanceModal
          rows={rows}
          acceptances={acceptances.data ?? []}
          documents={documents.data ?? []}
          draft={acceptance.draft}
          today={new Date().toISOString().slice(0, 10)}
          onClose={() => setAcceptance(null)}
          preparedByMe={Boolean(currentUserId) && acceptance.draft?.prepared_by === currentUserId}
          canConfirm={may('confirm', 'subcontractAcceptance')}
          soleOperator={soleOperator}
          onSave={async (input) => { await mutations.prepareAcceptance.mutateAsync(input); toast(t('subcontract.acceptance.prepared', 'Acceptance saved as a draft'), undefined, 'success'); }}
          onConfirm={async (id) => { await mutations.confirmAcceptance.mutateAsync(id); toast(t('subcontract.acceptance.confirmed', 'Acceptance confirmed'), undefined, 'success'); }}
          onWithdraw={async (id) => { await mutations.withdrawAcceptance.mutateAsync(id); toast(t('subcontract.acceptance.withdrawn', 'Acceptance withdrawn'), undefined, 'success'); }}
          onError={fail}
        />
      )}
      {variation && (
        <PoVariationModal
          row={variation.row}
          origin={variation.origin}
          currency={currency}
          onClose={() => setVariation(null)}
          onSave={(input) => mutations.requestVariation.mutateAsync(input)}
          onError={fail}
        />
      )}
      {attribute && (
        <SubcontractAttributeModal rows={rows} invoice={attribute} currency={currency}
          onClose={() => setAttribute(null)}
          onSave={(lines) => mutations.attributeBillLines.mutateAsync({ invoiceId: attribute.invoice_id, lines })} />
      )}
    </Card>
  );
};
