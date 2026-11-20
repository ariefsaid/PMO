/**
 * #1599 ECX-5: fiscalYearOutbox.ts
 * Outbox command and single-POST guarantee for fiscal year setup.
 */
import type { Adapter, AdapterCommand, CommandResult } from '../contract.ts';
import { dispatchMoneyWrite, type DispatchMoneyOutboxDeps } from '../dispatch.ts';
import { AppError } from '../../appError.ts';
import { createDoc, ErpError, type ErpClientDeps } from '../erpnext/client.ts';
import { erpReason } from '../erpnext/erpReason.ts';
import { readYearsIntersecting } from '../erpnext/fiscalYear.ts';
import { coversCompany } from '../fiscalYearEnsure.ts';
import { createDbMoneyOutboxDeps } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

export interface FiscalYearIntent {
  id: string;
  org_id: string;
  binding_id: string;
  company: string;
  site_url: string;
  activated_at: string;
  target_start: string;
  target_end: string;
  year_name: string;
  current_year?: string;
  checked_on?: string;
  post_started_at?: string | null;
  post_outbox_id?: string | null;
  post_generation?: number | null;
}

export interface FiscalYearOutboxDeps {
  serviceClient: {
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
    from(table: string): unknown;
  };
  erpClient: ErpClientDeps;
  money?: DispatchMoneyOutboxDeps;
}

export const FISCAL_YEAR_DOMAIN = 'fiscal_year_setup';
export const fiscalYearKeyOf = (intentId: string) => `setup:fiscal-year:${intentId}`;

async function probeMatchingYear(
  erpClient: ErpClientDeps,
  company: string,
  start: string,
  end: string,
): Promise<string | null> {
  try {
    const years = await readYearsIntersecting(erpClient, start, end);
    const matches = years.filter(
      y => !y.disabled && coversCompany(y, company) && y.start === start && y.end === end,
    );
    if (matches.length === 1) {
      return matches[0]!.name;
    }
    if (matches.length > 1) {
      throw new AppError('ambiguous fiscal year match in ERP', 'command-held');
    }
    return null;
  } catch (err) {
    if (err instanceof AppError) throw err;
    return null;
  }
}

export function fiscalYearOutboxAdapter(
  deps: FiscalYearOutboxDeps,
  intent: FiscalYearIntent,
): Pick<Adapter, 'tier' | 'capabilityMap' | 'commit'> {
  return {
    tier: 'erpnext',
    capabilityMap: new Set([FISCAL_YEAR_DOMAIN]),
    async commit(command: AdapterCommand): Promise<CommandResult> {
      const claim = command.outboxCommit;
      if (!claim) {
        throw new AppError('missing outbox claim fence for fiscal year setup', 'command-held');
      }

      // Step 1: Fenced reservation in DB before ANY network POST
      const { data: reserved, error: reserveErr } = await deps.serviceClient.rpc('begin_fiscal_year_post', {
        p_org_id: intent.org_id,
        p_intent_id: intent.id,
        p_outbox_id: claim.id,
        p_generation: claim.generation,
      });

      if (reserveErr || !reserved) {
        throw new AppError('fiscal year intent reservation refused or already attempted', 'command-held');
      }

      // Step 2: Deadline check
      if (command.commitDeadlineAtMs && Date.now() > command.commitDeadlineAtMs) {
        throw new AppError('claim deadline expired before post', 'command-held');
      }

      // Step 3: Issue single POST
      let postError: unknown = null;
      try {
        await createDoc(deps.erpClient, 'Fiscal Year', {
          year: intent.year_name,
          year_start_date: intent.target_start,
          year_end_date: intent.target_end,
          disabled: 0,
          companies: [{ company: intent.company }],
        });
      } catch (err) {
        postError = err;
        // Post failed or timed out. Fall through to read-back discovery to see if it landed.
      }

      // Step 4: Confirm via readback
      let adoptedYear: string | null = null;
      try {
        adoptedYear = await probeMatchingYear(
          deps.erpClient,
          intent.company,
          intent.target_start,
          intent.target_end,
        );
      } catch {
        // probe failed
      }

      if (!adoptedYear) {
        if (postError instanceof ErpError) {
          if (postError.status === 403) {
            const statusPayload = {
              state: 'needs-operator',
              checked_on: intent.checked_on ?? new Date().toISOString().slice(0, 10),
              company: intent.company,
              reason: 'missing-role',
            };
            await deps.serviceClient.rpc('record_fiscal_year_observation', {
              p_org_id: intent.org_id,
              p_binding_id: intent.binding_id,
              p_company: intent.company,
              p_site_url: intent.site_url,
              p_activated_at: intent.activated_at,
              p_checked_at: new Date().toISOString(),
              p_status: statusPayload,
            });
            return {
              externalRecordId: '',
              canonical: {
                id: intent.id,
                status: statusPayload,
              },
            };
          }
          if (postError.code !== 'external-unreachable') {
            const rawMessage = erpReason(postError) ?? postError.message;
            const message = rawMessage.replace(/<[^>]*>/g, '');
            const statusPayload = {
              state: 'refused',
              checked_on: intent.checked_on ?? new Date().toISOString().slice(0, 10),
              company: intent.company,
              message,
            };
            await deps.serviceClient.rpc('record_fiscal_year_observation', {
              p_org_id: intent.org_id,
              p_binding_id: intent.binding_id,
              p_company: intent.company,
              p_site_url: intent.site_url,
              p_activated_at: intent.activated_at,
              p_checked_at: new Date().toISOString(),
              p_status: statusPayload,
            });
            return {
              externalRecordId: '',
              canonical: {
                id: intent.id,
                status: statusPayload,
              },
            };
          }
        }
        const isTransport =
          postError instanceof TypeError ||
          (postError instanceof ErpError && postError.code === 'external-unreachable') ||
          String((postError as Error)?.message ?? '').includes('network down');
        const prefix = isTransport ? 'external-unreachable: ' : '';
        throw new AppError(`${prefix}fiscal year post unconfirmed in ERP`, 'command-held');
      }

      const statusPayload = {
        state: 'ready',
        checked_on: intent.checked_on ?? new Date().toISOString().slice(0, 10),
        company: intent.company,
        current: intent.current_year ?? '',
        next: adoptedYear,
      };

      return {
        externalRecordId: adoptedYear,
        canonical: {
          id: intent.id,
          year_name: adoptedYear,
          status: statusPayload,
          outboxId: claim.id,
          generation: claim.generation,
        },
      };
    },
  };
}

export async function ensureFiscalYearViaOutbox(
  deps: FiscalYearOutboxDeps,
  intent: FiscalYearIntent,
): Promise<CommandResult> {
  const payload = {
    company: intent.company,
    span: { start: intent.target_start, end: intent.target_end },
    year_name: intent.year_name,
  };

  const money = deps.money ?? createDbMoneyOutboxDeps({
    serviceClient: deps.serviceClient as never,
    orgId: intent.org_id,
    externalTier: 'erpnext',
    operation: 'create',
    reissueOnInconclusiveAbsence: false,
    payload,
    probeByRemarksKey: async () => {
      const matched = await probeMatchingYear(
        deps.erpClient,
        intent.company,
        intent.target_start,
        intent.target_end,
      );
      if (matched) {
        return { externalRecordId: matched, canonical: { id: intent.id, year_name: matched } };
      }
      return null;
    },
  });

  return dispatchMoneyWrite({
    adapter: fiscalYearOutboxAdapter(deps, intent),
    command: {
      domain: FISCAL_YEAR_DOMAIN,
      operation: 'create',
      record: { id: intent.id, ...payload },
      idempotencyKey: fiscalYearKeyOf(intent.id),
    },
    outboxRecordId: intent.id,
    money: {
      ...money,
      recordOutboxRef: async () => 1, // no external_refs mapping
    },
    writeReadModel: async (canonical) => {
      const c = canonical as { status?: Record<string, unknown>; outboxId?: string; generation?: number } | undefined;
      const status = c?.status;
      if (!status || status.state !== 'ready') return;

      const { data: recorded, error: recordErr } = await deps.serviceClient.rpc('record_fiscal_year_status', {
        p_org_id: intent.org_id,
        p_binding_id: intent.binding_id,
        p_company: intent.company,
        p_site_url: intent.site_url,
        p_activated_at: intent.activated_at,
        p_intent_id: intent.id,
        p_outbox_id: c.outboxId,
        p_generation: c.generation,
        p_status: status,
      });

      if (recordErr || !recorded) {
        throw new AppError('failed to record fiscal year status in binding', 'command-held');
      }
    },
    recordExternalRef: async () => {},
  });
}
