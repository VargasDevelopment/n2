import type { ProjectedRelationship } from '@n2/contracts';
import { describe, expect, it } from 'vitest';
import {
  labelAtRest,
  restingForm,
  STUB_MIN_LENGTH,
  STUB_PATH_LENGTH,
  stubDashArray
} from './relationshipRest.js';

const now = '2026-08-21T12:00:00.000Z';
const dependsOn = (isBlocking = false): ProjectedRelationship => ({
  id: 'dependency',
  kind: 'depends_on',
  dependentId: 'a',
  dependencyId: 'b',
  createdAt: now,
  isBlocking
});
const partOf = (isBlocking = false): ProjectedRelationship => ({
  id: 'membership',
  kind: 'member_of',
  memberId: 'a',
  groupId: 'b',
  createdAt: now,
  isBlocking
});
const long = STUB_MIN_LENGTH * 3;

describe('restingForm', () => {
  it('never hides or stubs a blocking relationship', () => {
    expect(restingForm(dependsOn(true), { groupRegions: true, length: long })).toBe('line');
    expect(restingForm(partOf(true), { groupRegions: true, length: long })).toBe('line');
  });

  it('hides Part of only where Group regions draw it', () => {
    expect(restingForm(partOf(), { groupRegions: true, length: 10 })).toBe('hidden');
    expect(restingForm(partOf(), { groupRegions: false, length: long })).toBe('line');
  });

  it('stubs Depends on from the threshold up, in every view', () => {
    for (const groupRegions of [true, false]) {
      expect(restingForm(dependsOn(), { groupRegions, length: STUB_MIN_LENGTH - 1 })).toBe('line');
      expect(restingForm(dependsOn(), { groupRegions, length: STUB_MIN_LENGTH })).toBe('stub');
    }
  });
});

describe('labelAtRest', () => {
  it('shows only blocking labels at rest', () => {
    expect(labelAtRest(dependsOn(true))).toBe(true);
    expect(labelAtRest(partOf(true))).toBe(true);
    expect(labelAtRest(dependsOn())).toBe(false);
    expect(labelAtRest(partOf())).toBe(false);
  });
});

describe('stubDashArray', () => {
  it('fills the whole path, opening and closing on a stub of about 56 px', () => {
    for (const length of [STUB_MIN_LENGTH, 1200, 4000]) {
      const dashes = stubDashArray(length).split(' ').map(Number);
      expect(dashes).toHaveLength(11);
      expect(dashes.reduce((sum, dash) => sum + dash, 0)).toBeCloseTo(STUB_PATH_LENGTH, 0);
      const pixelsPerUnit = length / STUB_PATH_LENGTH;
      // Curves run longer than their chord, so stubs come out a little short, never long.
      expect(dashes[0]! * pixelsPerUnit).toBeLessThanOrEqual(56);
      expect(dashes[0]! * pixelsPerUnit).toBeGreaterThan(45);
      expect(dashes.at(-1)).toBe(dashes[0]);
    }
  });
});
