import { describe, expect, it } from 'vitest';
import {
  contextualListReturnPath,
  createListReturnContext,
  isCanonicalRecordPath,
  listReturnOwnerForPathname,
  listReturnPath,
  LIST_RETURN_CONTEXT_KEY,
  LIST_SCROLL_RESTORE_STATE_KEY,
  readListReturnContext,
  withListReturnContext,
  withListScrollRestore,
} from './listReturnContext';

describe('validated list return context', () => {
  it('accepts the owning list route and preserves its query, offset, and history key', () => {
    const context = createListReturnContext(
      'companies',
      '/companies?type=Client&q=Caf%C3%A9&campaign=ref',
      840,
      'entry_3',
    );
    expect(context).toEqual({
      list: 'companies',
      path: '/companies?type=Client&q=Caf%C3%A9&campaign=ref',
      scrollTop: 840,
      sourceLocationKey: 'entry_3',
    });
    expect(readListReturnContext({ [LIST_RETURN_CONTEXT_KEY]: context }, 'companies')?.path).toBe(
      '/companies?type=Client&q=Caf%C3%A9&campaign=ref',
    );
  });

  it('allows Sales Pipeline as a project source only when the caller opts in', () => {
    const sales = createListReturnContext(
      'sales',
      '/sales?scope=Open&status=Leads&view=table',
      420,
      'entry_4',
    );
    const state = { [LIST_RETURN_CONTEXT_KEY]: sales };
    expect(readListReturnContext(state, 'projects')).toBeUndefined();
    expect(readListReturnContext(state, 'projects', { allowSalesForProject: true })).toEqual(sales);
    expect(
      readListReturnContext(state, 'contacts', { allowSalesForProject: true }),
    ).toBeUndefined();
    expect(listReturnPath(state, 'projects', { allowSalesForProject: true })).toBe(
      '/sales?scope=Open&status=Leads&view=table',
    );
  });

  it('AC-LRC-010: absent, tampered, or external state falls back to the owning index', () => {
    expect(listReturnPath(undefined, 'companies')).toBe('/companies');
    expect(
      listReturnPath(
        { [LIST_RETURN_CONTEXT_KEY]: { list: 'companies', path: '/contacts' } },
        'companies',
      ),
    ).toBe('/companies');
    expect(
      listReturnPath(
        { [LIST_RETURN_CONTEXT_KEY]: { list: 'companies', path: 'https://outside.example/path' } },
        'companies',
      ),
    ).toBe('/companies');
  });

  it.each([
    'https://outside.example/companies?type=Client',
    '//outside.example/companies',
    '/contacts?company=c1',
    '/companies/record-1',
    '/companies#top',
    '/companies#',
    '/\\outside.example/companies',
  ])('rejects a non-list or external return path: %s', (path) => {
    expect(createListReturnContext('companies', path, 10, 'entry_1')).toBeUndefined();
    expect(
      readListReturnContext(
        { [LIST_RETURN_CONTEXT_KEY]: { list: 'companies', path } },
        'companies',
      ),
    ).toBeUndefined();
  });

  it('drops invalid position metadata while keeping a valid list destination', () => {
    const state = {
      [LIST_RETURN_CONTEXT_KEY]: {
        list: 'meetings',
        path: '/meetings?project=project-1&q=review',
        scrollTop: Number.POSITIVE_INFINITY,
        sourceLocationKey: '../unsafe',
      },
    };
    expect(readListReturnContext(state, 'meetings')).toEqual({
      list: 'meetings',
      path: '/meetings?project=project-1&q=review',
    });
  });

  it('preserves other router state when attaching a validated return context', () => {
    const context = createListReturnContext(
      'projects',
      '/projects?filter=at-risk',
      160,
      'entry_2',
    )!;
    expect(withListReturnContext({ modal: 'edit', focusId: 'row-7' }, context)).toEqual({
      modal: 'edit',
      focusId: 'row-7',
      [LIST_RETURN_CONTEXT_KEY]: context,
    });
  });

  it('builds an explicit one-time scroll restore state only for the validated list context', () => {
    const context = createListReturnContext(
      'projects',
      '/projects?filter=at-risk',
      160,
      'entry_2',
    )!;
    expect(withListScrollRestore({ focusId: 'row-7' }, context)).toEqual({
      focusId: 'row-7',
      [LIST_SCROLL_RESTORE_STATE_KEY]: {
        list: 'projects',
        path: '/projects?filter=at-risk',
        scrollTop: 160,
      },
    });
    const withoutPosition = createListReturnContext('projects', '/projects?filter=at-risk')!;
    expect(withListScrollRestore({ focusId: 'row-7' }, withoutPosition)).toEqual({
      focusId: 'row-7',
    });
  });

  it('maps only canonical record paths to an owning list', () => {
    expect(listReturnOwnerForPathname('/projects/project-1')).toBe('projects');
    expect(listReturnOwnerForPathname('/projects/project-1/budget')).toBe('projects');
    expect(listReturnOwnerForPathname('/procurement/request-1/approvals')).toBe('procurement');
    expect(listReturnOwnerForPathname('/companies/company-1')).toBe('companies');
    expect(listReturnOwnerForPathname('/companies-archive/company-1')).toBeUndefined();
    expect(listReturnOwnerForPathname('/projects')).toBeUndefined();
  });

  it('distinguishes canonical record targets from nested detail routes', () => {
    expect(isCanonicalRecordPath('/projects/project-1', 'projects')).toBe(true);
    expect(isCanonicalRecordPath('/projects/project-1/budget', 'projects')).toBe(false);
    expect(isCanonicalRecordPath('/procurement/request-1', 'procurement')).toBe(true);
    expect(isCanonicalRecordPath('/procurement/request-1/approvals', 'procurement')).toBe(false);
    expect(isCanonicalRecordPath('/companies/company-1', 'contacts')).toBe(false);
    expect(isCanonicalRecordPath('/sales/project-1', 'projects')).toBe(false);
  });

  it('uses only a validated same-owner return path for a record breadcrumb', () => {
    const projectContext = {
      [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('projects', '/projects?filter=Ongoing'),
    };
    const salesContext = {
      [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('sales', '/sales?scope=Lost'),
    };

    expect(contextualListReturnPath('/projects/project-1', projectContext)).toBe(
      '/projects?filter=Ongoing',
    );
    expect(contextualListReturnPath('/projects/project-1', salesContext)).toBeUndefined();
    expect(contextualListReturnPath('/contacts/contact-1', projectContext)).toBeUndefined();
    expect(contextualListReturnPath('/projects/project-1', undefined)).toBeUndefined();
  });

  it('falls back on the owner index when the history state itself is not a record', () => {
    for (const state of [null, false, 3, 'path', ['unexpected']]) {
      expect(listReturnPath(state, 'meetings')).toBe('/meetings');
    }
  });
});
