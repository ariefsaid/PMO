import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ConfirmDialog, ListState, TextArea, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import {
  useReopenableApprovedTimesheets,
  useTimesheetMutations,
} from '@/src/hooks/useTimesheetApproval';
import { REOPENABLE_WINDOW_DAYS } from '@/src/lib/db/timesheetTransition';
import { weekLabel } from '../timesheets/TimesheetBulkApprove';

/**
 * Slice A (FR-TSC-060, AC-TSC-R3, FENCE 5) — the Approved sheets an approver may re-open for
 * correction.
 *
 * ⚑ SURFACE HONESTY IS THE POINT, not the button. An Approved sheet may return to Draft ONLY while
 * ERP holds no document for it; the RPC is the authority and it FAILS CLOSED on any doubt. So a row
 * that cannot be re-opened must say WHY — a disabled control with no reason reads as a dead button
 * (the I-13 lesson two sections up: a silent affordance is indistinguishable from a broken one).
 * Hence four distinct renderings, never a greyed-out button:
 *   • no mirror row                    → "Re-open for correction" (the action)
 *   • mirror.ts_number set             → "Already pushed to ERP: correction path coming" (Slice B)
 *   • mirror.post_submit_unknown_at    → "ERP result unknown — an administrator must confirm what
 *                                        ERPNext holds" (⚑ round-8 BLOCK: NOT visible from push_state,
 *                                        which reads an ordinary `failed` once a hold is released)
 *   • push in flight                   → "Push in progress" (transient; retry later)
 * The RPC's own refusals (`reopen-erp-document-held` / `reopen-push-outcome-unknown` /
 * `reopen-push-in-flight`) are classified to the
 * same honest wording — the client's read can be stale, so the server always gets the last word.
 */
export function ReopenableApprovedSection({ hasPending }: { hasPending: boolean }) {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useReopenableApprovedTimesheets();
  const { reopenApproved, attestNoErpDocument } = useTimesheetMutations();
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  // ⚑ SHOULD-FIX 1 (Luna FU-1a round-12) — the attestation is the ONLY route out of an ERP unknown.
  // Admin-only on the REAL role (`can()` is UX; the RPC re-asserts org + Admin + active membership).
  // Reason-required (the RPC demands it), so the confirm is a dialog, not a one-click write.
  const canAttest = may('manage', 'pushHold');
  const [attestFor, setAttestFor] = useState<{ id: string; owner: string } | null>(null);
  const [attestReason, setAttestReason] = useState('');

  const closeAttest = () => {
    setAttestFor(null);
    setAttestReason('');
  };

  const submitAttest = () => {
    if (!attestFor || attestReason.trim() === '') return;
    const target = attestFor;
    attestNoErpDocument.mutate(
      { id: target.id, reason: attestReason.trim() },
      {
        onSuccess: () => {
          closeAttest();
          toast(
            t('approvals.reopen.attestSuccess', 'Confirmed: the week is clear to re-open'),
            `${target.owner}: ${t('approvals.reopen.attestSuccessDetail', 'ERPNext holds no document')}`,
            'success',
          );
        },
        // I-13: a silent affordance reads as broken, so BOTH outcomes speak. The server's fail-closed
        // refusals (42501 not-authorized, P0001 nothing-to-attest) are surfaced in the user's terms.
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          toast(t('approvals.reopen.attestFailure', 'Could not confirm the ERP result'), msg, 'warning');
        },
      },
    );
  };

  if (isPending) return <ListState variant="loading" rows={2} />;
  if (isError) return (
    <ListState
      variant="error"
      title={t('approvals.queue.loadError', "Couldn't load {{queue}}", { queue: t('approvals.reopen.heading', 'Approved history and corrections').toLowerCase() })}
      sub={t('approvals.queue.loadErrorSub', 'Try again to refresh this queue.')}
      onRetry={() => { void refetch(); }}
    />
  );
  if (!data || data.length === 0) return null;

  return (
    <section
      className="mb-4"
      aria-label={t(
        'approvals.reopen.sectionLabel',
        'Approved timesheets from the last {{days}} days that can be re-opened for correction',
        { days: String(REOPENABLE_WINDOW_DAYS) },
      )}
    >
      <details open={!hasPending} className="rounded-lg border border-border/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('approvals.reopen.heading', 'Approved history and corrections')} <span className="tabular text-muted-foreground">{data.length}</span> <span className="text-control font-normal text-muted-foreground">({t('approvals.reopen.window', 'last {{days}} days', { days: String(REOPENABLE_WINDOW_DAYS) })})</span>
        </summary>
        <div className="mt-2 space-y-1.5">
        {data.map((row) => {
          // The SAME two pieces of evidence the RPC's precondition weighs (migration 0151 §A): a live
          // mirror document, and a NON-TERMINAL push command. ⚑ SHOULD-FIX 4 (Luna code review): the
          // in-flight test used to read `mirror.push_state`, but the mirror row is written only AFTER
          // the ERP call settles — so a queued/committing/committed push arrived here as `mirror: null`
          // and rendered an ACTIVE button the server would refuse, while the two states it did test for
          // (`pending`/`pushing`) are written by no shipped writer at all.
          const pushed = Boolean(row.mirror?.ts_number) && !row.mirror?.erp_cancelled_at;
          // ⚑ Luna FU-1a round-8 BLOCK — the week whose ERP outcome PMO never learned. Independent of
          // push_state on purpose: once an Admin releases the hold (to restore the backstop route) this
          // row reads `failed` like any rejected push, and the server still refuses it. Classifying on
          // the witness is the only way the surface agrees with the RPC.
          // ⚑ Luna FU-1a round-10 S3 — the mirror's own `held` state is the SAME server refusal. 0157 §4
          // keeps `push_state = 'held'` as an INDEPENDENT predicate for the pre-0157 residue (a row parked
          // `held` before the witness column existed), so classifying on the witness alone rendered an
          // active button the server could only refuse.
          const hasWitness = !pushed && Boolean(row.mirror?.post_submit_unknown_at);
          const outcomeUnknown = hasWitness || (!pushed && row.mirror?.push_state === 'held');
          const inFlight = !pushed && !outcomeUnknown && row.pushCommandState !== null;
          // The attestation clears a WITNESS (0157 §5). A pre-0157-residue `held` mirror carries none,
          // so the RPC would refuse it — offer the affordance ONLY where it can succeed (a real
          // witness). Those residue rows keep the note; their route out is documented separately.
          const offerAttest = canAttest && hasWitness;
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown')}
                </div>
                <div className="mt-0.5 text-control text-muted-foreground">
                  {weekLabel(row.week_start_date, t)}
                </div>
              </div>
              {pushed ? (
                <span className="text-control text-muted-foreground">
                  {t('approvals.reopen.alreadyPushed', 'Already pushed to ERP: correction path coming')}
                </span>
              ) : outcomeUnknown ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-control text-muted-foreground">
                    {t(
                      'approvals.reopen.outcomeUnknown',
                      'ERP result unknown: an administrator must confirm what ERPNext holds',
                    )}
                  </span>
                  {offerAttest && (
                    <button
                      type="button"
                      className="h-8 rounded-md border border-border px-3 text-control font-medium hover:bg-accent"
                      onClick={() => {
                        setAttestReason('');
                        setAttestFor({
                          id: row.id,
                          owner: row.owner?.full_name ?? t('approvals.unknownOwner', 'Unknown'),
                        });
                      }}
                    >
                      {t('approvals.reopen.confirmErpButton', 'Confirm what ERPNext holds')}
                    </button>
                  )}
                </div>
              ) : inFlight ? (
                <span className="text-control text-muted-foreground">
                  {t('approvals.reopen.pushInProgress', 'Push in progress')}
                </span>
              ) : (
                <button
                  type="button"
                  className="h-8 rounded-md border border-border px-3 text-control font-medium hover:bg-accent disabled:opacity-50"
                  disabled={reopeningId === row.id && reopenApproved.isPending}
                  onClick={() => {
                    setReopeningId(row.id);
                    reopenApproved.mutate(
                      { id: row.id },
                      {
                        onSuccess: () => {
                          setReopeningId(null);
                          toast(
                            t(
                              'approvals.reopen.success',
                              'Re-opened: the week is back in Draft for editing.',
                            ),
                            'success',
                          );
                        },
                        onError: (err: unknown) => {
                          setReopeningId(null);
                          const msg = err instanceof Error ? err.message : String(err);
                          // The server's fail-closed refusals, said in the user's terms. Anything
                          // else is surfaced verbatim rather than flattened to "something went wrong".
                          if (msg.includes('reopen-erp-document-held')) {
                            toast(
                              t(
                                'approvals.reopen.errorDocumentHeld',
                                'Already in ERP: this week cannot be re-opened yet.',
                              ),
                              'error',
                            );
                          } else if (msg.includes('reopen-push-outcome-unknown')) {
                            // Migrations 0152 §B / 0157 §4: the ERP push SUCCEEDED and its read-back
                            // failed, so nobody knows whether ERPNext holds a document for this week.
                            // "Try again shortly" would be false, and so would "an administrator must
                            // release the held push" (⚑ round-8 BLOCK): a release re-queues the command
                            // and learns nothing about ERPNext, so it does NOT lift this refusal. The
                            // only true instruction is that someone must go and establish what ERP holds.
                            toast(
                              t(
                                'approvals.reopen.errorOutcomeUnknown',
                                'This week’s ERP result is unknown. An administrator must confirm what ERPNext holds before it can be re-opened.',
                              ),
                              'error',
                            );
                          } else if (msg.includes('reopen-push-in-flight')) {
                            toast(
                              t(
                                'approvals.reopen.errorPushInFlight',
                                'A push is in flight for this week. Try again shortly.',
                              ),
                              'error',
                            );
                          } else {
                            toast(`${t('approvals.reopen.errorGeneric', 'Could not re-open')}: ${msg}`, 'error');
                          }
                        },
                      },
                    );
                  }}
                >
                  {t('approvals.reopen.action', 'Re-open for correction')}
                </button>
              )}
            </div>
          );
        })}
        </div>
      </details>

      {/* ⚑ SHOULD-FIX 1 — the attestation confirm. Reason-required (the confirm is gated until the
          textarea is non-empty, matching the RPC's own P0001 refusal on an empty reason). Nothing
          writes on a single click (owner rule); the RPC is Admin-only + audited. */}
      <ConfirmDialog
        open={attestFor !== null}
        title={t('approvals.attest.title', 'Confirm what ERPNext holds')}
        description={
          <div className="space-y-3">
            <p>
              {/* #571 — ONE sentence, not five fragments: the emphasis and the person are
                  placeholders a translator moves, so a language that orders the clause
                  differently still reads as prose. */}
              <Trans
                i18nKey="approvals.attest.body"
                defaults="Certify that you have checked ERPNext and it holds <strong>no Timesheet</strong> for {{person}}’s week. This records an audited attestation and re-opens the week for correction. It does not contact ERPNext."
                values={{
                  person: attestFor
                    ? attestFor.owner
                    : t('approvals.attest.thisPerson', 'this person'),
                }}
                components={{ strong: <strong /> }}
              />
            </p>
            <TextArea
              label={t('approvals.attest.reasonLabel', 'What did you check in ERPNext?')}
              required
              value={attestReason}
              onChange={setAttestReason}
              placeholder={t(
                'approvals.attest.reasonPlaceholder',
                'e.g. Searched Timesheets for this employee and week: none exists.',
              )}
            />
          </div>
        }
        confirmLabel={t('approvals.attest.confirmLabel', 'Confirm: no ERP document')}
        cancelLabel={t('approvals.attest.cancelLabel', 'Cancel')}
        loading={attestNoErpDocument.isPending}
        confirmDisabled={attestReason.trim() === ''}
        onConfirm={submitAttest}
        onCancel={closeAttest}
      />
    </section>
  );
}
