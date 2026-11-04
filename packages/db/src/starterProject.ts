import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { edges, entityIdReservations, nodes, workspaces } from './schema.js';
import type { schema } from './schema.js';

export const DEFAULT_PROJECT_ID = 'default';

export function initializeStarterProject(
  sqlite: Database.Database,
  db: BetterSQLite3Database<typeof schema>
): void {
  const exists = db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, DEFAULT_PROJECT_ID))
    .get();
  if (exists) return;

  const timestamp = new Date().toISOString();
  const seedNodes: (typeof nodes.$inferInsert)[] = [
    {
      id: 'n2-group',
      reference: 'N2-1',
      workspaceId: DEFAULT_PROJECT_ID,
      title: 'Build N²',
      description: 'The first local-first N² workspace.',
      kind: 'group',
      requestedStatus: 'ready',
      positionX: 1130,
      positionY: 170,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: 'domain',
      reference: 'N2-2',
      workspaceId: DEFAULT_PROJECT_ID,
      title: 'Define the graph domain',
      description: 'Keep graph rules pure, deterministic, and shared by every interface.',
      kind: 'task',
      requestedStatus: 'done',
      positionX: 780,
      positionY: 40,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: 'local',
      reference: 'N2-3',
      workspaceId: DEFAULT_PROJECT_ID,
      title: 'Make local persistence boring',
      description: 'Treat SQLite as the authoritative local record.',
      kind: 'task',
      requestedStatus: 'in_progress',
      positionX: 430,
      positionY: 190,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: 'agent',
      reference: 'N2-4',
      workspaceId: DEFAULT_PROJECT_ID,
      title: 'Give agents first-class commands',
      description: 'Let humans and agents use the same explicit domain operations.',
      kind: 'task',
      requestedStatus: 'ready',
      positionX: 80,
      positionY: 340,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
  const seedRelationships: (typeof edges.$inferInsert)[] = [
    ['domain', 'member-domain'],
    ['local', 'member-local'],
    ['agent', 'member-agent']
  ].map(([source, id]) => ({
    id: id!,
    workspaceId: DEFAULT_PROJECT_ID,
    source: source!,
    target: 'n2-group',
    kind: 'member_of' as const,
    createdAt: timestamp
  }));
  seedRelationships.push(
    {
      id: 'domain-before-local',
      workspaceId: DEFAULT_PROJECT_ID,
      source: 'local',
      target: 'domain',
      kind: 'depends_on',
      createdAt: timestamp
    },
    {
      id: 'local-before-agent',
      workspaceId: DEFAULT_PROJECT_ID,
      source: 'agent',
      target: 'local',
      kind: 'depends_on',
      createdAt: timestamp
    }
  );

  sqlite.transaction(() => {
    db.insert(workspaces)
      .values({
        id: DEFAULT_PROJECT_ID,
        name: 'Starter project',
        referenceKey: 'N2',
        nextCanvasItemNumber: 5
      })
      .run();
    db.insert(entityIdReservations)
      .values([
        ...seedNodes.map(({ id, kind, reference, createdAt }) => ({
          entityType: 'node' as const,
          entityId: id,
          nodeKind: kind,
          reference,
          createdAt
        })),
        ...seedRelationships.map(({ id, createdAt }) => ({
          entityType: 'relationship' as const,
          entityId: id,
          createdAt
        }))
      ])
      .run();
    db.insert(nodes).values(seedNodes).run();
    db.insert(edges).values(seedRelationships).run();
  })();
}
