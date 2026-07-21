import { describe, it, expect } from 'vitest';
import { buildTaskRenderOrder, depthByTask, collectDescendants } from './taskTree';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

/**
 * OD-INT-9 subtask model — pure tree helpers for the Tasks list view + the parent-picker's
 * cycle guard. These tests pin the render-order + depth + descendant-collection behaviour
 * at the lowest sufficient layer (pure functions, no React).
 *
 * AC-SUB-TREE-001  flat list (no parents) keeps input order, all depth 0.
 * AC-SUB-TREE-002  parent + 2 subtasks → parent, then children at depth 1 (input order).
 * AC-SUB-TREE-003  deep 3-level chain → grandparent(0) → parent(1) → child(2).
 * AC-SUB-TREE-004  a subtask whose parent is NOT in the slice (filtered out / other group)
 *                  is an ORPHAN → renders at depth 0 so the user never loses it.
 * AC-SUB-TREE-005  a parent with no subtasks renders alone at depth 0.
 * AC-SUB-TREE-006  depthByTask agrees with buildTaskRenderOrder's depths.
 * AC-SUB-TREE-007  collectDescendants returns ALL descendants (not self), deep chain included.
 * AC-SUB-TREE-008  collectDescendants is cycle-safe (no infinite loop on malformed data).
 * AC-SUB-TREE-009  collectDescendants on an unknown id / leaf returns the empty set.
 */
describe('OD-INT-9 subtask tree helpers', () => {
  /** Minimal TaskWithRefs factory — only id/name/parent_task_id matter to the tree. */
  const t = (
    id: string,
    parent_task_id: string | null = null,
    over: Partial<TaskWithRefs> = {},
  ): TaskWithRefs =>
    ({
      id,
      name: id,
      parent_task_id,
      org_id: 'org-1',
      project_id: 'p1',
      name_alt: undefined,
      status: 'To Do',
      assignee_id: null,
      assignee: null,
      dependencies: [],
      ...over,
    }) as unknown as TaskWithRefs;

  const ids = (nodes: { task: TaskWithRefs }[]) => nodes.map((n) => n.task.id);
  const depths = (nodes: { depth: number }[]) => nodes.map((n) => n.depth);

  it('AC-SUB-TREE-001: flat list (no parents) keeps input order, all depth 0', () => {
    const tasks = [t('a'), t('b'), t('c')];
    const order = buildTaskRenderOrder(tasks);
    expect(ids(order)).toEqual(['a', 'b', 'c']);
    expect(depths(order)).toEqual([0, 0, 0]);
  });

  it('AC-SUB-TREE-002: parent + 2 subtasks → parent first, children at depth 1 (input order)', () => {
    const tasks = [t('parent'), t('sub1', 'parent'), t('sub2', 'parent')];
    const order = buildTaskRenderOrder(tasks);
    expect(ids(order)).toEqual(['parent', 'sub1', 'sub2']);
    expect(depths(order)).toEqual([0, 1, 1]);
  });

  it('AC-SUB-TREE-003: deep 3-level chain → grandparent(0) → parent(1) → child(2)', () => {
    const tasks = [t('gp'), t('p', 'gp'), t('c', 'p')];
    const order = buildTaskRenderOrder(tasks);
    expect(ids(order)).toEqual(['gp', 'p', 'c']);
    expect(depths(order)).toEqual([0, 1, 2]);
  });

  it('AC-SUB-TREE-004: an orphan subtask (parent not in slice) renders at depth 0', () => {
    // 'orphan' points at a parent that is NOT in this slice (e.g. filtered out / other group).
    const tasks = [t('top'), t('orphan', 'missing-parent')];
    const order = buildTaskRenderOrder(tasks);
    // Order is stable (top-level input order); orphan is treated as a root at depth 0.
    expect(ids(order)).toEqual(['top', 'orphan']);
    expect(depths(order)).toEqual([0, 0]);
  });

  it('AC-SUB-TREE-005: a parent with no subtasks renders alone at depth 0', () => {
    const tasks = [t('lonely')];
    const order = buildTaskRenderOrder(tasks);
    expect(ids(order)).toEqual(['lonely']);
    expect(depths(order)).toEqual([0]);
  });

  it('AC-SUB-TREE-006: depthByTask agrees with buildTaskRenderOrder', () => {
    const tasks = [t('gp'), t('p', 'gp'), t('c', 'p'), t('sib')];
    const depth = depthByTask(tasks);
    expect(depth.get('gp')).toBe(0);
    expect(depth.get('p')).toBe(1);
    expect(depth.get('c')).toBe(2);
    expect(depth.get('sib')).toBe(0);
    // unknown id → undefined (callers coerce to 0)
    expect(depth.get('nope')).toBeUndefined();
  });

  it('AC-SUB-TREE-007: collectDescendants returns ALL descendants (not self), deep chain included', () => {
    const tasks = [t('gp'), t('p', 'gp'), t('c', 'p'), t('c2', 'p'), t('sib')];
    const desc = collectDescendants('gp', tasks);
    expect(desc.has('gp')).toBe(false);
    expect(desc.has('p')).toBe(true);
    expect(desc.has('c')).toBe(true);
    expect(desc.has('c2')).toBe(true);
    expect(desc.has('sib')).toBe(false);
    expect(desc.size).toBe(3);
  });

  it('AC-SUB-TREE-008: collectDescendants is cycle-safe (no infinite loop on malformed data)', () => {
    // A malformed 2-cycle: a→b and b→a (the DB CHECK only blocks self-parent, not cycles).
    // collectDescendants must terminate and simply return what it can reach before the cycle.
    const tasks = [t('a', 'b'), t('b', 'a')];
    const desc = collectDescendants('a', tasks);
    // 'a' reaches 'b' (its child), and 'b' reaches 'a' — but we must not loop forever.
    expect(desc.has('b')).toBe(true);
    // 'a' itself is never in its own descendant set.
    expect(desc.has('a')).toBe(false);
  });

  it('AC-SUB-TREE-009: collectDescendants on an unknown id or a leaf returns the empty set', () => {
    const tasks = [t('a'), t('b')];
    expect(collectDescendants('nope', tasks).size).toBe(0);
    expect(collectDescendants('a', tasks).size).toBe(0);
  });
});
