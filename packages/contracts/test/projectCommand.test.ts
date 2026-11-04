import { describe, expect, it } from 'vitest';
import {
  CanvasItemReferenceSchema,
  CreateProjectInputSchema,
  NoteSchema,
  PlanningPlacementSchema,
  ProjectedNodeSchema,
  ProjectReferenceKeySchema,
  projectCommandJsonSchema,
  ProjectCommandSchema,
  type CreateNodeInput
} from '../src/index.js';

const object = (value: unknown): Record<string, unknown> => {
  expect(value).toBeTypeOf('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
};

const variant = (kind: string): Record<string, unknown> => {
  const schema = projectCommandJsonSchema();
  expect(Array.isArray(schema.oneOf)).toBe(true);
  const match = schema.oneOf?.find((candidate) => {
    const properties = object(object(candidate).properties);
    return object(properties.kind).const === kind;
  });
  expect(match).toBeDefined();
  return object(match);
};

const createInputVariant = (kind: string): Record<string, unknown> => {
  const createProperties = object(variant('create_node').properties);
  const createInput = object(createProperties.input);
  expect(Array.isArray(createInput.oneOf)).toBe(true);
  const match = (createInput.oneOf as unknown[]).find((candidate) => {
    const properties = object(object(candidate).properties);
    return object(properties.kind).const === kind;
  });
  expect(match).toBeDefined();
  return object(match);
};

describe('ProjectCommandSchema', () => {
  const commandId = '00000000-0000-4000-8000-000000000001';
  const entityId = '00000000-0000-4000-8000-000000000002';

  it('rejects undeclared fields throughout a mutating command', () => {
    expect(
      ProjectCommandSchema.safeParse({
        kind: 'create_node',
        commandId,
        nodeId: entityId,
        input: {
          title: 'Agent surface',
          position: { x: 0, y: 0 },
          descripton: 'This typo must not be lost.'
        }
      }).success
    ).toBe(false);
    expect(
      ProjectCommandSchema.safeParse({
        kind: 'update_node',
        commandId,
        nodeId: 'node',
        expectedVersion: 0,
        patch: { title: 'Renamed', unsupported: true },
        optimistic: true
      }).success
    ).toBe(false);
    expect(
      ProjectCommandSchema.safeParse({
        kind: 'create_relationship',
        commandId,
        relationshipId: entityId,
        input: {
          kind: 'depends_on',
          dependentId: 'dependent',
          dependencyId: 'dependency',
          label: 'Blocks'
        }
      }).success
    ).toBe(false);
  });

  it('publishes the accepted input defaults and structural refinements', () => {
    const taskInput = createInputVariant('task');
    expect(taskInput.required).toEqual(['title', 'position', 'kind']);
    expect(taskInput.additionalProperties).toBe(false);
    expect(object(object(taskInput.properties).title)).toMatchObject({
      minLength: 1,
      maxLength: 240,
      pattern: '^\\S(?:[\\s\\S]*\\S)?$'
    });
    const noteInput = createInputVariant('note');
    expect(noteInput.required).toEqual(['title', 'kind', 'position']);
    expect(object(noteInput.properties)).toHaveProperty('content');
    expect(object(noteInput.properties)).not.toHaveProperty('requestedStatus');
    expect(object(noteInput.properties)).not.toHaveProperty('description');

    const updateProperties = object(variant('update_node').properties);
    expect(object(updateProperties.patch)).toMatchObject({
      additionalProperties: false,
      minProperties: 1
    });

    const moveProperties = object(variant('move_nodes').properties);
    expect(object(moveProperties.moves)).toMatchObject({ minProperties: 1 });
    expect(object(moveProperties.moves).additionalProperties).toBeTypeOf('object');
  });

  it('uses object keys to make duplicate node moves unrepresentable', () => {
    expect(
      ProjectCommandSchema.safeParse({
        kind: 'move_nodes',
        commandId,
        moves: {
          node: { position: { x: 10, y: 20 }, expectedVersion: 1 }
        }
      }).success
    ).toBe(true);
    expect(
      ProjectCommandSchema.safeParse({ kind: 'move_nodes', commandId, moves: {} }).success
    ).toBe(false);
  });

  it('uses a non-transforming title contract that discovery can represent exactly', () => {
    const command = (title: string) => ({
      kind: 'create_node',
      commandId,
      nodeId: entityId,
      input: { title, kind: 'task', position: { x: 0, y: 0 } }
    });

    expect(ProjectCommandSchema.safeParse(command('Canonical title')).success).toBe(true);
    expect(ProjectCommandSchema.safeParse(command('   ')).success).toBe(false);
    expect(ProjectCommandSchema.safeParse(command(' padded ')).success).toBe(false);
    expect(ProjectCommandSchema.safeParse(command(`x${' '.repeat(240)}`)).success).toBe(false);
  });

  it('models valid date-only placements without collapsing same-day windows', () => {
    const sameDayWindow = {
      kind: 'window',
      startDate: '2026-08-25',
      endDate: '2026-08-25'
    } as const;
    const milestone = { kind: 'milestone', date: '2026-08-25' } as const;

    expect(PlanningPlacementSchema.parse(sameDayWindow)).toEqual(sameDayWindow);
    expect(PlanningPlacementSchema.parse(milestone)).toEqual(milestone);
    expect(
      PlanningPlacementSchema.safeParse({ ...sameDayWindow, endDate: '2026-08-24' }).success
    ).toBe(false);
    expect(
      PlanningPlacementSchema.safeParse({ kind: 'milestone', date: '2026-02-30' }).success
    ).toBe(false);
  });

  it('accepts placement on Work Node commands and an explicit null to unschedule', () => {
    expect(
      ProjectCommandSchema.safeParse({
        kind: 'create_node',
        commandId,
        nodeId: entityId,
        input: {
          title: 'Roadmap work',
          kind: 'task',
          planningPlacement: { kind: 'milestone', date: '2026-09-01' },
          position: { x: 0, y: 0 }
        }
      }).success
    ).toBe(true);
    expect(
      ProjectCommandSchema.safeParse({
        kind: 'update_node',
        commandId,
        nodeId: entityId,
        expectedVersion: 0,
        patch: { planningPlacement: null }
      }).success
    ).toBe(true);
  });

  it('makes notes structurally incapable of carrying work state', () => {
    const note = {
      id: 'note',
      reference: 'N2-42',
      title: 'A thought',
      content: '**Standalone** context',
      kind: 'note',
      position: { x: 10, y: 20 },
      version: 0,
      createdAt: '2026-08-23T12:00:00.000Z',
      updatedAt: '2026-08-23T12:00:00.000Z'
    } as const;

    expect(NoteSchema.parse(note)).toEqual(note);
    expect(ProjectedNodeSchema.parse(note)).toEqual(note);
    expect(NoteSchema.safeParse({ ...note, requestedStatus: 'ready' }).success).toBe(false);
    expect(NoteSchema.safeParse({ ...note, progress: 0 }).success).toBe(false);
    expect(NoteSchema.safeParse({ ...note, description: note.content }).success).toBe(false);
    expect(
      NoteSchema.safeParse({
        ...note,
        planningPlacement: { kind: 'milestone', date: '2026-08-25' }
      }).success
    ).toBe(false);
  });

  it('accepts only canonical Project keys and Canvas Item References', () => {
    expect(ProjectReferenceKeySchema.parse('N2')).toBe('N2');
    expect(CanvasItemReferenceSchema.parse('N2-42')).toBe('N2-42');
    expect(ProjectReferenceKeySchema.safeParse('n2').success).toBe(false);
    expect(ProjectReferenceKeySchema.safeParse('2N').success).toBe(false);
    expect(CanvasItemReferenceSchema.safeParse('N2-0').success).toBe(false);
    expect(CanvasItemReferenceSchema.safeParse('N2-042').success).toBe(false);
    expect(CanvasItemReferenceSchema.safeParse('n2-42').success).toBe(false);
  });

  it('requires explicit canonical identity when creating a Project', () => {
    const input = {
      projectId: '00000000-0000-4000-8000-000000000301',
      name: 'Garden decision',
      referenceKey: 'GARDEN'
    };

    expect(CreateProjectInputSchema.parse(input)).toEqual(input);
    expect(CreateProjectInputSchema.safeParse({ ...input, projectId: 'garden' }).success).toBe(
      false
    );
    expect(CreateProjectInputSchema.safeParse({ ...input, referenceKey: 'garden' }).success).toBe(
      false
    );
    expect(CreateProjectInputSchema.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('exposes only canonical, explicitly discriminated canvas-item creation', () => {
    const task: CreateNodeInput = {
      title: 'Explicit task',
      kind: 'task',
      position: { x: 0, y: 0 }
    };
    expect(
      ProjectCommandSchema.safeParse({
        kind: 'create_node',
        commandId,
        nodeId: entityId,
        input: task
      }).success
    ).toBe(true);

    expect(
      ProjectCommandSchema.safeParse({
        kind: 'create_node',
        commandId,
        nodeId: entityId,
        input: {
          title: 'Legacy note',
          description: 'Old command body',
          kind: 'note',
          position: { x: 0, y: 0 }
        }
      }).success
    ).toBe(false);
  });
});
