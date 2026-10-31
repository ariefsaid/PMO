/** People, operator, usage, saved views, org features/settings, credits and domain-ownership repository implementations (the admin/settings group). */
import { listProjectManagers, listOrgProfiles } from '@/src/lib/db/profiles';
import { listSpendApprovers, addSpendApprover, removeSpendApprover } from '@/src/lib/db/spendApprovers';
import { listUsers, updateUserRole, assignUserManager, inviteUser, setUserStatus } from '@/src/lib/db/adminUsers';
import { isOperator } from '@/src/lib/db/operators';
import {
  getOrgUsageSummary,
  getOperatorUsageSummary,
  listOperatorOrgs,
  getOrgAgentRunStats,
  getOperatorAgentRunStats,
} from '@/src/lib/db/usage';
import {
  listUserViews,
  getUserView,
  createUserView,
  updateUserView,
  archiveUserView,
  deleteUserView,
} from '@/src/lib/db/userViews';
import { listOwnOrgFeatures, toggleOrgFeature, getOrgCreditBalance, grantOrgCredits } from '@/src/lib/db/orgFeatures';
import {
  getOrgTaxDefault,
  setOrgTaxDefault,
  getOrgProjectNumberPattern,
  getOrgProjectNumberTimezone,
  setOrgProjectNumberPattern,
  getOrgWithholdingAccount,
  getOrgDownPaymentItem,
  getOrgProcurementGates,
  setOrgProcurementGates,
  setOrgDownPaymentItem,
  setOrgWithholdingAccount,
  getOrgVendorTaxAccounts,
  setOrgVendorTaxAccounts,
  getOrgProjectClassificationOptions,
  setOrgProjectClassificationOptions,
} from '@/src/lib/db/orgs';
import { listOwnExternalDomainOwnership } from '@/src/lib/db/externalDomainOwnership';
import { wrap } from './repositoryErrors';
import type { CreditsRepository, ExternalDomainOwnershipRepository, OperatorRepository, OrgFeatureRepository, OrgSettingsRepository, ProfileRepository, UsageRepository, UserViewRepository } from './contracts/admin';

export const profileRepository: ProfileRepository = {
  listProjectManagers: () => wrap(() => listProjectManagers()),
  listOrgProfiles: () => wrap(() => listOrgProfiles()),
  listUsers: () => wrap(() => listUsers()),
  updateUserRole: (id, role) => wrap(() => updateUserRole(id, role)),
  assignUserManager: (id, managerId) => wrap(() => assignUserManager(id, managerId)),
  inviteUser: (input) => wrap(() => inviteUser(input)),
  setUserStatus: (input) => wrap(() => setUserStatus(input)),
};

export const operatorRepository: OperatorRepository = {
  isOperator: () => wrap(() => isOperator()),
};

export const usageRepository: UsageRepository = {
  getOrgUsageSummary: () => wrap(() => getOrgUsageSummary()),
  getOperatorUsageSummary: (orgId) => wrap(() => getOperatorUsageSummary(orgId)),
  listOperatorOrgs: () => wrap(() => listOperatorOrgs()),
  getOrgAgentRunStats: () => wrap(() => getOrgAgentRunStats()),
  getOperatorAgentRunStats: (orgId) => wrap(() => getOperatorAgentRunStats(orgId)),
};

export const userViewRepository: UserViewRepository = {
  list: () => wrap(() => listUserViews()),
  get: (id) => wrap(() => getUserView(id)),
  create: (input) => wrap(() => createUserView(input)),
  update: (id, input) => wrap(() => updateUserView(id, input)),
  archive: (id) => wrap(() => archiveUserView(id)),
  delete: (id) => wrap(() => deleteUserView(id)),
};

export const orgFeatureRepository: OrgFeatureRepository = {
  listOwn: () => wrap(() => listOwnOrgFeatures()),
  toggle: (args) => wrap(() => toggleOrgFeature(args)),
};

/**
 * Org accounting settings (`OD-TAX-1`, 0207). The read is every member's — a form cannot
 * pre-select what it cannot read; the write is Admin-only at the RLS layer, mirrored by
 * `can('manage', 'orgAccounting')` on the affordance.
 */
export const orgSettingsRepository: OrgSettingsRepository = {
  getWithholdingAccount: () => wrap(() => getOrgWithholdingAccount()),
  setWithholdingAccount: (account) => wrap(() => setOrgWithholdingAccount(account)),
  getVendorTaxAccounts: () => wrap(() => getOrgVendorTaxAccounts()),
  setVendorTaxAccounts: (input) => wrap(() => setOrgVendorTaxAccounts(input)),
  getDownPaymentItem: () => wrap(() => getOrgDownPaymentItem()),
  getProcurementGates: () => wrap(() => getOrgProcurementGates()),
  setProcurementGates: (patch) => wrap(() => setOrgProcurementGates(patch)),
  setDownPaymentItem: (item) => wrap(() => setOrgDownPaymentItem(item)),
  getProjectNumberPattern: () => wrap(() => getOrgProjectNumberPattern()),
  getProjectNumberTimezone: () => wrap(() => getOrgProjectNumberTimezone()),
  setProjectNumberPattern: (value) => wrap(() => setOrgProjectNumberPattern(value)),
  getProjectClassificationOptions: () => wrap(() => getOrgProjectClassificationOptions()),
  setProjectClassificationOptions: (options) => wrap(() => setOrgProjectClassificationOptions(options)),
  getTaxDefault: () => wrap(() => getOrgTaxDefault()),
  setTaxDefault: (value) => wrap(() => setOrgTaxDefault(value)),
  listSpendApprovers: () => wrap(() => listSpendApprovers()),
  addSpendApprover: (profileId, projectId) => wrap(() => addSpendApprover(profileId, projectId)),
  removeSpendApprover: (id) => wrap(() => removeSpendApprover(id)),
};

export const creditsRepository: CreditsRepository = {
  getOrgBalance: (orgId) => wrap(() => getOrgCreditBalance(orgId)),
  grant: (args) => wrap(() => grantOrgCredits(args)),
};

export const externalDomainOwnershipRepository: ExternalDomainOwnershipRepository = {
  listOwn: () => wrap(() => listOwnExternalDomainOwnership()),
};
