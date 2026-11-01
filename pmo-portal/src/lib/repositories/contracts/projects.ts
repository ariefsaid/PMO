/** Project/opportunity repository contract (ADR-0017). */
import type {
  ProjectRow,
  ProjectWithRefs,
  CreateProjectInput,
  ProjectHeaderInput,
  SetProjectContractValueInput,
  ProjectVatEditability,
} from '@/src/lib/db/projects';
import type { OpportunityRow } from '@/src/lib/db/opportunity';
import type { TransitionProjectOpts, ProjectStatus, PipelineStageConfig } from '@/src/lib/db/projectTransitions';

export interface ProjectRepository {
  list(
    params?: { status?: ProjectRow['status']; statuses?: ProjectRow['status'][]; pmId?: string },
  ): Promise<ProjectWithRefs[]>;
  listByClient(clientId: string): Promise<ProjectWithRefs[]>;
  getWithRefs(id: string): Promise<ProjectWithRefs | null>;
  listPipelineStageConfig(): Promise<PipelineStageConfig[]>;
  listIdentity(): Promise<Array<Pick<ProjectRow, 'id' | 'name'>>>;
  get(id: string): Promise<OpportunityRow | null>;
  /** The readable subset of `ids` in batched reads; ids the caller cannot read are absent. */
  getMany(ids: readonly string[]): Promise<OpportunityRow[]>;
  transition(id: string, to: ProjectStatus, opts?: TransitionProjectOpts): Promise<void>;
  winEligibility(id: string): Promise<string | null>;
  /** Create a new opportunity (Leads / Internal Project only; org_id stamped by RLS). */
  create(input: CreateProjectInput): Promise<ProjectRow>;
  /** Update the project's header fields (name/code/client/end customer/PM/dates). */
  updateHeader(id: string, input: ProjectHeaderInput): Promise<void>;
  /** Soft-archive a project (stamps archived_at). */
  archive(id: string): Promise<void>;
  /** Hard-delete a project (Admin-only in the FE gate); rejects 23503 if referenced. */
  delete(id: string): Promise<void>;
  /**
   * Set contract_value through the SoD-scoped RPC (ADR-0019); rejects 42501 on SoD denial.
   *
   * #513: ONE object param, and `taxTreatment`/`taxAmount` are REQUIRED members of
   * `SetProjectContractValueInput` — mirroring 0197's P0001 gate, so a caller that omits either
   * fails to compile rather than failing at the RPC. Positional was no longer expressible:
   * TypeScript forbids a required parameter after an optional one.
   */
  setContractValue(input: SetProjectContractValueInput): Promise<void>;
  /** Read advisory server-side VAT editability for this project. */
  getVatEditability(id: string): Promise<ProjectVatEditability>;
  /** Reserve one editable PMO project-number proposal for the selected client. */
  proposeNumber(clientId: string): Promise<string>;
}
