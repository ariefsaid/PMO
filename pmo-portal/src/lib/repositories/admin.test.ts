import { describe, vi } from 'vitest';
import * as profiles from '@/src/lib/db/profiles';
import * as spend from '@/src/lib/db/spendApprovers';
import * as users from '@/src/lib/db/adminUsers';
import * as operators from '@/src/lib/db/operators';
import * as usage from '@/src/lib/db/usage';
import * as views from '@/src/lib/db/userViews';
import * as features from '@/src/lib/db/orgFeatures';
import * as orgs from '@/src/lib/db/orgs';
import * as domains from '@/src/lib/db/externalDomainOwnership';
import {
  profileRepository, operatorRepository, usageRepository, userViewRepository, orgFeatureRepository,
  orgSettingsRepository, creditsRepository, externalDomainOwnershipRepository,
} from './admin';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/profiles');
vi.mock('@/src/lib/db/spendApprovers');
vi.mock('@/src/lib/db/adminUsers');
vi.mock('@/src/lib/db/operators');
vi.mock('@/src/lib/db/usage');
vi.mock('@/src/lib/db/userViews');
vi.mock('@/src/lib/db/orgFeatures');
vi.mock('@/src/lib/db/orgs');
vi.mock('@/src/lib/db/externalDomainOwnership');

describe('profileRepository', () => {
  // listUsers & co live in adminUsers; the profile reads in profiles
  itDelegates(profileRepository as never, { ...profiles, ...users }, [
    ['listProjectManagers', 'listProjectManagers', []],
    ['listOrgProfiles', 'listOrgProfiles', []],
    ['listUsers', 'listUsers', []],
    ['updateUserRole', 'updateUserRole', ['u1', 'Finance']],
    ['assignUserManager', 'assignUserManager', ['u1', 'u2']],
    ['inviteUser', 'inviteUser', [{ email: 'a@b.co' }]],
    ['setUserStatus', 'setUserStatus', [{ userId: 'u1', status: 'inactive' }]],
  ]);
});

describe('operatorRepository', () => {
  itDelegates(operatorRepository as never, operators, [['isOperator', 'isOperator', []]]);
});

describe('usageRepository', () => {
  itDelegates(usageRepository as never, usage, [
    ['getOrgUsageSummary', 'getOrgUsageSummary', []],
    ['getOperatorUsageSummary', 'getOperatorUsageSummary', ['o1']],
    ['listOperatorOrgs', 'listOperatorOrgs', []],
    ['getOrgAgentRunStats', 'getOrgAgentRunStats', []],
    ['getOperatorAgentRunStats', 'getOperatorAgentRunStats', ['o1']],
  ]);
});

describe('userViewRepository', () => {
  itDelegates(userViewRepository as never, views, [
    ['list', 'listUserViews', []],
    ['get', 'getUserView', ['v1']],
    ['create', 'createUserView', [{ name: 'Mine' }]],
    ['update', 'updateUserView', ['v1', { name: 'New' }]],
    ['archive', 'archiveUserView', ['v1']],
    ['delete', 'deleteUserView', ['v1']],
  ]);
});

describe('orgFeatureRepository and credits', () => {
  itDelegates(orgFeatureRepository as never, features, [
    ['listOwn', 'listOwnOrgFeatures', []],
    ['toggle', 'toggleOrgFeature', [{ feature: 'agent', enabled: true }]],
  ]);
  itDelegates(creditsRepository as never, features, [
    ['getOrgBalance', 'getOrgCreditBalance', ['o1']],
    ['grant', 'grantOrgCredits', [{ orgId: 'o1', amount: 5 }]],
  ]);
});

describe('orgSettingsRepository', () => {
  itDelegates(orgSettingsRepository as never, { ...orgs, ...spend }, [
    ['getWithholdingAccount', 'getOrgWithholdingAccount', []],
    ['setWithholdingAccount', 'setOrgWithholdingAccount', ['2100 - WHT']],
    ['getVendorTaxAccounts', 'getOrgVendorTaxAccounts', []],
    ['setVendorTaxAccounts', 'setOrgVendorTaxAccounts', [{ ppn: 'A' }]],
    ['getDownPaymentItem', 'getOrgDownPaymentItem', []],
    ['getProcurementGates', 'getOrgProcurementGates', []],
    ['setProcurementGates', 'setOrgProcurementGates', [{ requirePo: true }]],
    ['setDownPaymentItem', 'setOrgDownPaymentItem', ['DP']],
    ['getProjectNumberPattern', 'getOrgProjectNumberPattern', []],
    ['getProjectNumberTimezone', 'getOrgProjectNumberTimezone', []],
    ['setProjectNumberPattern', 'setOrgProjectNumberPattern', ['PRJ-{YY}-{NNNN}']],
    ['getProjectClassificationOptions', 'getOrgProjectClassificationOptions', []],
    ['setProjectClassificationOptions', 'setOrgProjectClassificationOptions', [['A', 'B']]],
    ['getTaxDefault', 'getOrgTaxDefault', []],
    ['setTaxDefault', 'setOrgTaxDefault', [{ rate: 11 }]],
    ['listSpendApprovers', 'listSpendApprovers', []],
    ['addSpendApprover', 'addSpendApprover', ['pr1', 'p1']],
    ['removeSpendApprover', 'removeSpendApprover', ['sa1']],
  ]);
});

describe('externalDomainOwnershipRepository', () => {
  itDelegates(externalDomainOwnershipRepository as never, domains, [
    ['listOwn', 'listOwnExternalDomainOwnership', []],
  ]);
});
