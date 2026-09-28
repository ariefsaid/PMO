import { describe, expect, it } from 'vitest';
import {
  canCaptureFromList,
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
  type ListReturnNavigation,
} from './listReturnContext';

describe('validated list return context', () => {
  it('FR-LRC-003: accepts the owning list route and preserves its query, offset, and history key', () => {
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

  it('AC-LRC-010: reads return context only from the record\'s owning list, never a Sales source for a project', () => {
    const sales = createListReturnContext('sales', '/sales?scope=Open&status=Leads&view=table')!;
    const state = { [LIST_RETURN_CONTEXT_KEY]: sales };
    // The project's BackBar/breadcrumb owner is Projects: a Sales source is not its owning list.
    expect(readListReturnContext(state, 'projects')).toBeUndefined();
    expect(listReturnPath(state, 'projects')).toBe('/projects');
    expect(listReturnNavigation(state, 'projects').path).toBe('/projects');
    expect(readListReturnContext(state, 'contacts')).toBeUndefined();
    expect(
      readListReturnContext(
        { [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('contacts', '/contacts') },
        'projects',
      ),
    ).toBeUndefined();
  });

  it('FR-LRC-006: the project\'s Sales Pipeline link reads the captured Sales URL through the sales owner', () => {
    const sales = createListReturnContext(
      'sales',
      '/sales?scope=Needs+attention&status=Leads&q=harbor&view=table',
      300,
      'entry_5',
    )!;
    const nav = listReturnNavigation({ [LIST_RETURN_CONTEXT_KEY]: sales, focusId: 'p1' }, 'sales');
    expect(nav.path).toBe('/sales?scope=Needs+attention&status=Leads&q=harbor&view=table');
    expect(nav.state).toEqual({
      focusId: 'p1',
      [LIST_SCROLL_RESTORE_STATE_KEY]: {
        list: 'sales',
        path: '/sales?scope=Needs+attention&status=Leads&q=harbor&view=table',
        scrollTop: 300,
      },
    });
    // Without Sales context (a direct project link, or a Projects source) the link stays bare /sales.
    expect(listReturnNavigation(undefined, 'sales').path).toBe('/sales');
    const projects = createListReturnContext('projects', '/projects?filter=Ongoing')!;
    expect(listReturnNavigation({ [LIST_RETURN_CONTEXT_KEY]: projects }, 'sales').path).toBe(
      '/sales',
    );
  });

  it('FR-LRC-003: only the capture check lets a Sales list open a Projects record', () => {
    expect(canCaptureFromList('sales', 'projects')).toBe(true);
    expect(canCaptureFromList('projects', 'projects')).toBe(true);
    expect(canCaptureFromList('contacts', 'projects')).toBe(false);
    expect(canCaptureFromList('sales', 'contacts')).toBe(false);
    expect(canCaptureFromList('projects', 'sales')).toBe(false);
  });

  it('AC-LRC-010: exposes the canonical index path for every list', () => {
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
    expect(safeLocalPath('/companies/./record')).toBe('/companies/record');
    expect(safeLocalPath('/companies?type=Client&q=Caf%C3%A9')).toBe(
      '/companies?type=Client&q=Caf%C3%A9',
    );
  });

  it.each([
    '/.//outside.example',
    '/..//outside.example',
    '/a/..//outside.example',
    '/.///outside.example',
    '/companies/..//outside.example/companies',
  ])('AC-LRC-010: safeLocalPath rejects a path whose dot segments normalise to a leading //: %s', (path) => {
    expect(safeLocalPath(path)).toBeUndefined();
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

  it('FR-LRC-005: explicit return descriptor keeps path and one-shot restore, never pmoListReturn', () => {
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

  it('AC-LRC-010: drops invalid position metadata while keeping a valid list destination', () => {
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

  it('FR-LRC-003: preserves other router state when attaching a validated return context', () => {
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

  it('FR-LRC-005: builds an explicit one-time scroll restore state that strips both seam keys', () => {
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

  it('AC-LRC-010: maps only canonical record paths to an owning list', () => {
    expect(listReturnOwnerForPathname('/projects/project-1')).toBe('projects');
    expect(listReturnOwnerForPathname('/projects/project-1/budget')).toBe('projects');
    expect(listReturnOwnerForPathname('/procurement/request-1/approvals')).toBe('procurement');
    expect(listReturnOwnerForPathname('/companies/company-1')).toBe('companies');
    expect(listReturnOwnerForPathname('/companies-archive/company-1')).toBeUndefined();
    expect(listReturnOwnerForPathname('/projects')).toBeUndefined();
  });

  it('AC-LRC-010: distinguishes canonical record targets from nested detail routes', () => {
    expect(isCanonicalRecordPath('/projects/project-1', 'projects')).toBe(true);
    expect(isCanonicalRecordPath('/projects/project-1/budget', 'projects')).toBe(false);
    expect(isCanonicalRecordPath('/procurement/request-1', 'procurement')).toBe(true);
    expect(isCanonicalRecordPath('/procurement/request-1/approvals', 'procurement')).toBe(false);
    expect(isCanonicalRecordPath('/companies/company-1', 'contacts')).toBe(false);
    expect(isCanonicalRecordPath('/sales/project-1', 'projects')).toBe(false);
  });

  it('AC-LRC-010: uses only a validated same-owner descriptor for a record breadcrumb', () => {
    const projectContext = {
      [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('projects', '/projects?filter=Ongoing'),
    };
    const salesContext = {
      [LIST_RETURN_CONTEXT_KEY]: createListReturnContext('sales', '/sales?scope=Lost'),
    };

    expect(contextualListReturnNavigation('/projects/project-1', projectContext)?.path).toBe(
      '/projects?filter=Ongoing',
    );
    // Sales context on a project never redirects its structural crumb: Projects stays Projects.
    const fromSales = contextualListReturnNavigation('/projects/project-1', salesContext);
    expect(fromSales?.path).toBe('/projects');
    expect(fromSales?.state[LIST_RETURN_CONTEXT_KEY]).toBeUndefined();
    expect(fromSales?.state[LIST_SCROLL_RESTORE_STATE_KEY]).toBeUndefined();
    // A recognized record without a usable context still resolves to its owning index.
    expect(contextualListReturnNavigation('/contacts/contact-1', projectContext)?.path).toBe(
      '/contacts',
    );
    expect(contextualListReturnNavigation('/projects/project-1', undefined)?.path).toBe('/projects');
    // A pathname that is not a record detail (an index) is not a contextual-return concern.
    expect(contextualListReturnNavigation('/projects', projectContext)).toBeUndefined();
  });

  it('AC-LRC-010: only the resolvers mint a ListReturnNavigation; a hand-built descriptor does not type-check', () => {
    // @ts-expect-error a literal {path,state} is not a validated return descriptor.
    const forged: ListReturnNavigation = { path: '//outside.example', state: {} };
    const minted: ListReturnNavigation = listReturnNavigation(undefined, 'companies');
    const contextual: ListReturnNavigation | undefined = contextualListReturnNavigation(
      '/companies/company-1',
      undefined,
    );
    expect(forged.path).toBe('//outside.example');
    expect(minted).toEqual({ path: '/companies', state: {} });
    expect(contextual).toEqual({ path: '/companies', state: {} });
  });

  it('AC-LRC-010: falls back on the owner index when the history state itself is not a record', () => {
    for (const state of [null, false, 3, 'path', ['unexpected']]) {
      expect(listReturnPath(state, 'meetings')).toBe('/meetings');
    }
  });
});
