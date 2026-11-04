import { ProjectCommandSchema } from '@n2/contracts';
import * as domain from '@n2/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectApplication } from '../src/index.js';
import { MemoryProjectStore } from './memoryProjectStore.js';

// Observed, not replaced: effect derivation still runs the real domain rule.
vi.mock('@n2/domain', async (importOriginal) => {
  const actual = await importOriginal<typeof domain>();
  return { ...actual, completedGroupIds: vi.fn(actual.completedGroupIds) };
});

describe('Command Effects derivation', () => {
  let application: ProjectApplication;

  beforeEach(() => {
    application = new ProjectApplication(new MemoryProjectStore());
    vi.mocked(domain.completedGroupIds).mockClear();
  });

  it('derives command effects only for commands that can change effective status', () => {
    const run = (command: Record<string, unknown>) =>
      application.executeCommand('default', ProjectCommandSchema.parse(command));
    const renamed = run({
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000011',
      nodeId: 'local',
      expectedVersion: 0,
      patch: { title: 'Renamed' }
    });
    run({
      kind: 'move_nodes',
      commandId: '00000000-0000-4000-8000-000000000012',
      moves: { agent: { position: { x: 40, y: 40 }, expectedVersion: 0 } }
    });
    expect(domain.completedGroupIds).not.toHaveBeenCalled();
    expect(renamed.effects).toEqual({ completedGroupIds: [] });
    expect(renamed.project.nodes.find(({ id }) => id === 'local')?.title).toBe('Renamed');

    run({
      kind: 'update_node',
      commandId: '00000000-0000-4000-8000-000000000013',
      nodeId: 'local',
      expectedVersion: 1,
      patch: { requestedStatus: 'done' }
    });
    expect(domain.completedGroupIds).toHaveBeenCalledOnce();
  });
});
