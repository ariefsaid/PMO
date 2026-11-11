/** project.match (v1) — moved from the ERPNext projectMap tests. */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

export function projectSuite(h: ErpHarness): void {
  describe(`project.match (${h.tier})`, () => {
    it('AC-PFIN-001/002 resolves an ERP project name used by exactly one PMO project', () => {
      expect(h.resolveProjectLink({ p1: 'ERP-A', p2: 'ERP-B', p3: 'ERP-B' }, 'ERP-A')).toEqual({ status: 'linked', pmoProjectId: 'p1' });
    });

    it('AC-PFIN-001/002 an ERP project name claimed by two PMO projects has no unique target', () => {
      expect(h.resolveProjectLink({ p1: 'ERP-A', p2: 'ERP-B', p3: 'ERP-B' }, 'ERP-B')).toEqual({ status: 'ambiguous' });
    });

    it('ignores links whose ERP name is not a non-empty string', () => {
      const links = { p4: 7, p5: '' };
      expect(h.resolveProjectLink(links, '7')).toEqual({ status: 'none' });
      expect(h.resolveProjectLink(links, '')).toEqual({ status: 'none' });
    });

    it('resolves nothing when no links are configured', () => {
      expect(h.resolveProjectLink(undefined, 'ERP-A')).toEqual({ status: 'none' });
    });

    it('matches the ERP name exactly, without trimming', () => {
      const links = { p1: ' ERP-A ' };
      expect(h.resolveProjectLink(links, ' ERP-A ')).toEqual({ status: 'linked', pmoProjectId: 'p1' });
      expect(h.resolveProjectLink(links, 'ERP-A')).toEqual({ status: 'none' });
    });
  });
}
