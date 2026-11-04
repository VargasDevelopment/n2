import type { Project } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import { executionFingerprint, reachableTaskIds } from '../src/execution.js';

const timestamp = '2026-10-15T00:00:00.000Z';

describe('execution domain rules', () => {
  it('deduplicates shared descendants and terminates safely on malformed membership cycles', () => {
    const project: Project = {
      id: 'project',
      name: 'Cycle fixture',
      referenceKey: 'CYCLE',
      nodes: [
        {
          id: 'outer',
          reference: 'CYCLE-1',
          kind: 'group',
          title: 'Outer',
          description: '',
          requestedStatus: 'ready',
          position: { x: 0, y: 0 },
          version: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: 'inner',
          reference: 'CYCLE-2',
          kind: 'group',
          title: 'Inner',
          description: '',
          requestedStatus: 'ready',
          position: { x: 0, y: 0 },
          version: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: 'task',
          reference: 'CYCLE-3',
          kind: 'task',
          title: 'Shared leaf',
          description: '',
          requestedStatus: 'ready',
          position: { x: 0, y: 0 },
          version: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      relationships: [
        {
          id: 'outer-in-inner',
          kind: 'member_of',
          memberId: 'outer',
          groupId: 'inner',
          createdAt: timestamp
        },
        {
          id: 'inner-in-outer',
          kind: 'member_of',
          memberId: 'inner',
          groupId: 'outer',
          createdAt: timestamp
        },
        {
          id: 'task-in-outer',
          kind: 'member_of',
          memberId: 'task',
          groupId: 'outer',
          createdAt: timestamp
        },
        {
          id: 'task-in-inner',
          kind: 'member_of',
          memberId: 'task',
          groupId: 'inner',
          createdAt: timestamp
        }
      ]
    };

    expect(reachableTaskIds(project, 'outer')).toEqual(['task']);
  });

  it('fingerprints semantic Depends on endpoints rather than relationship-row identity', () => {
    const project: Project = {
      id: 'project',
      name: 'Fingerprint fixture',
      referenceKey: 'FP',
      nodes: ['dependent', 'dependency'].map((id, index) => ({
        id,
        reference: `FP-${index + 1}`,
        kind: 'task' as const,
        title: id,
        description: '',
        requestedStatus: 'ready' as const,
        position: { x: 0, y: 0 },
        version: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      })),
      relationships: [
        {
          id: 'first-row-id',
          kind: 'depends_on',
          dependentId: 'dependent',
          dependencyId: 'dependency',
          createdAt: timestamp
        }
      ]
    };
    const before = executionFingerprint(project, 'dependent');
    project.relationships[0] = { ...project.relationships[0]!, id: 'replacement-row-id' };
    expect(executionFingerprint(project, 'dependent')).toBe(before);
  });
});
