import { describe, expect, it } from 'vitest';
import {
  allowedForOwner,
  contextualListReturnNavigation,
  createListReturnContext,
  isCanonicalRecordPath,
  listIndexPath,
  listReturnNavigation,
  listReturnOwnerForPathname,
  listReturnPath,
  LIST_RETURN_CONTEXT_KEY,
  LIST_SCROLL_RESTORE_STATE_KEY,
  readListReturnContext,
  safeLocalPath,
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

  it('allows Sales Pipeline as a projects source always and no other cross-owner pair', () => {
    const sales = createListReturnContext('sales', '/sales?scope=Open&status=Leads&view=table')!;
    const state = { [LIST_RETURN_CONTEXT_KEY]: sales };
    expect(readListReturnContext(state, 'projects')).toEqual(sales);
    expect(readListReturnContext(state, 'sales')).toEqual(sales);
    expect(readListReturnContext(state, 'contacts')).toBeUndefined();
    expect(
      readListReturnContext(
        { [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('contacts', '/contacts') },
        'projects',
      ),
    ).toBeUndefined();
    expect(listReturnPath(state, 'projects')).toBe('/sales?scope=Open&status=Leads&view=table');
  });

  it('exposes the single eligibility rule and the canonical index path for every list', () => {
    expect(allowedForOwner('sales', 'projects')).toBe(true);
    expect(allowedForOwner('projects', 'projects')).toBe(true);
    expect(allowedForOwner('contacts', 'projects')).toBe(false);
    expect(allowedForOwner('sales', 'contacts')).toBe(false);
    expect(allowedForOwner('projects', 'sales')).toBe(false);

    expect(listIndexPath('projects')).toBe('/projects');
    expect(listIndexPath('sales')).toBe('/sales');
    expect(listIndexPath('procurement')).toBe('/procurement');
    expect(listIndexPath('companies')).toBe('/companies');
    expect(listIndexPath('contacts')).toBe('/contacts');
    expect(listIndexPath('meetings')).toBe('/meetings');
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
    '/companies/record\u0007',
  ])('AC-LRC-010: rejects a non-list or external return path: %s', (path) => {
    expect(createListReturnContext('companies', path, 10, 'entry_1')).toBeUndefined();
    expect(
      readListReturnContext(
        { [LIST_RETURN_CONTEXT_KEY]: { list: 'companies', path } },
        'companies',
      ),
    ).toBeUndefined();
  });

  it('AC-LRC-010: safeLocalPath rejects unsafe local paths and keeps a relative query path', () => {
    expect(safeLocalPath('https://outside.example/companies')).toBeUndefined();
    expect(safeLocalPath('//outside.example/companies')).toBeUndefined();
    expect(safeLocalPath('/companies#top')).toBeUndefined();
    expect(safeLocalPath('/companies#')).toBeUndefined();
    expect(safeLocalPath('/\\outside.example/companies')).toBeUndefined();
    expect(safeLocalPath('/companies/record\u0007')).toBeUndefined();
    expect(safeLocalPath('companies/record')).toBeUndefined();
    expect(safeLocalPath('/companies?type=Client&q=Caf%C3%A9')).toBe(
      '/companies?type=Client&q=Caf%C3%A9',
    );
  });

  it('AC-LRC-010: explicit return descriptor falls back to the owner index with clean state', () => {
    const nav = listReturnNavigation(
      { [LIST_RETURN_CONTEXT_KEY]: { list: 'companies', path: '/contacts' }, focusId: 'x' },
      'companies',
    );
    expect(nav.path).toBe('/companies');
    expect(nav.state).toEqual({ focusId: 'x' });
    expect(nav.state[LIST_RETURN_CONTEXT_KEY]).toBeUndefined();
    expect(nav.state[LIST_SCROLL_RESTORE_STATE_KEY]).toBeUndefined();
  });

  it('AC-LRC-005: explicit return descriptor keeps path and one-shot restore, never pmoListReturn', () => {
    const context = createListReturnContext(
      'companies',
      '/companies?type=Client',
      220,
      'entry_9',
    )!;
    const nav = listReturnNavigation(
      { [LIST_RETURN_CONTEXT_KEY]: context, modal: 'edit' },
      'companies',
    );
    expect(nav.path).toBe('/companies?type=Client');
    expect(nav.state.modal).toBe('edit');
    expect(nav.state[LIST_RETURN_CONTEXT_KEY]).toBeUndefined();
    expect(nav.state[LIST_SCROLL_RESTORE_STATE_KEY]).toEqual({
      list: 'companies',
      path: '/companies?type=Client',
      scrollTop: 220,
    });
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

  it('AC-LRC-005: builds an explicit one-time scroll restore state that strips both seam keys', () => {
    const context = createListReturnContext('projects', '/projects?filter=at-risk', 160, 'entry_2')!;
    expect(
      withListScrollRestore(
        { focusId: 'row-7', [LIST_RETURN_CONTEXT_KEY]: context },
        context,
      ),
    ).toEqual({
      focusId: 'row-7',
      [LIST_SCROLL_RESTORE_STATE_KEY]: {
        list: 'projects',
        path: '/projects?filter=at-risk',
        scrollTop: 160,
      },
    });
    const withoutPosition = createListReturnContext('projects', '/projects?filter=at-risk')!;
    expect(withListScrollRestore({ [LIST_RETURN_CONTEXT_KEY]: context }, withoutPosition)).toEqual(
      {},
    );
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

  it('uses only a validated same-owner descriptor for a record breadcrumb', () => {
    const projectContext = {
      [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('projects', '/projects?filter=Ongoing'),
    };
    const salesContext = {
      [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('sales', '/sales?scope=Lost'),
    };

    expect(contextualListReturnNavigation('/projects/project-1', projectContext)?.path).toBe(
      '/projects?filter=Ongoing',
    );
    // Sales is a valid owner for a Projects record, so the descriptor resolves to the Sales URL.
    expect(contextualListReturnNavigation('/projects/project-1', salesContext)?.path).toBe(
      '/sales?scope=Lost',
    );
    // A recognized record without a usable context still resolves to its owning index.
    expect(contextualListReturnNavigation('/contacts/contact-1', projectContext)?.path).toBe(
      '/contacts',
    );
    expect(contextualListReturnNavigation('/projects/project-1', undefined)?.path).toBe('/projects');
    // A pathname that is not a record detail (an index) is not a contextual-return concern.
    expect(contextualListReturnNavigation('/projects', projectContext)).toBeUndefined();
  });

  it('falls back on the owner index when the history state itself is not a record', () => {
    for (const state of [null, false, 3, 'path', ['unexpected']]) {
      expect(listReturnPath(state, 'meetings')).toBe('/meetings');
    }
  });
});