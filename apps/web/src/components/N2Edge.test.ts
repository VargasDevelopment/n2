import type { ProjectedRelationship } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import {
  relationshipAriaLabel,
  relationshipColor,
  relationshipLabel
} from '../relationshipPresentation.js';

const createdAt = '2026-08-21T12:00:00.000Z';

describe('relationshipLabel', () => {
  it('keeps blocked membership language distinct', () => {
    const relationship: ProjectedRelationship = {
      id: 'membership',
      kind: 'member_of',
      memberId: 'member',
      groupId: 'group',
      createdAt,
      isBlocking: true
    };

    expect(relationshipLabel(relationship)).toBe('Blocked part');
    expect(relationshipColor(relationship)).toBe('var(--color-relationship-blocking)');
  });

  it('gives non-blocking membership its own directional marker color', () => {
    const relationship: ProjectedRelationship = {
      id: 'membership',
      kind: 'member_of',
      memberId: 'child-group',
      groupId: 'parent-group',
      createdAt,
      isBlocking: false
    };

    expect(relationshipLabel(relationship)).toBe('Part of');
    expect(relationshipColor(relationship)).toBe('var(--color-relationship-member-of)');
  });

  it('reads an active dependency from dependent to dependency', () => {
    const relationship: ProjectedRelationship = {
      id: 'dependency',
      kind: 'depends_on',
      dependentId: 'dependent',
      dependencyId: 'dependency',
      createdAt,
      isBlocking: true
    };

    expect(relationshipLabel(relationship)).toBe('Blocked by');
    expect(relationshipColor(relationship)).toBe('var(--color-relationship-blocking)');
    expect(relationshipColor({ ...relationship, isBlocking: false })).toBe(
      'var(--color-relationship-depends-on)'
    );
    expect(
      relationshipAriaLabel(
        relationship,
        new Map([
          ['dependent', 'Ship N²'],
          ['dependency', 'Fix persistence']
        ])
      )
    ).toBe('Ship N² is blocked by Fix persistence');
  });
});
