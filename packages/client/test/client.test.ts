import { describe, expect, it, vi } from 'vitest';
import { createN2Client, N2ApiError, N2ProtocolError } from '../src/index.js';

describe('N2 client', () => {
  const applicationPreferences = {
    values: { handleOrientation: 'horizontal' as const, minimapVisible: true, theme: 'midnight' },
    productDefaults: {
      handleOrientation: 'horizontal' as const,
      minimapVisible: true,
      theme: 'midnight'
    },
    storedValues: {}
  };

  const projectSettings = {
    projectId: 'default',
    effectiveValues: {
      handleOrientation: 'vertical' as const,
      minimapVisible: true,
      theme: 'midnight' as const
    },
    applicationValues: {
      handleOrientation: 'horizontal' as const,
      minimapVisible: true,
      theme: 'midnight' as const
    },
    sources: {
      handleOrientation: 'project' as const,
      minimapVisible: 'application' as const,
      theme: 'application' as const
    },
    overrides: { handleOrientation: 'vertical' as const }
  };

  const clearedProjectSettings = {
    ...projectSettings,
    effectiveValues: {
      handleOrientation: 'horizontal' as const,
      minimapVisible: true,
      theme: 'midnight' as const
    },
    sources: {
      handleOrientation: 'application' as const,
      minimapVisible: 'application' as const,
      theme: 'application' as const
    },
    overrides: {}
  };

  it('lists and creates Projects through the Project Library protocol', async () => {
    const input = {
      projectId: '00000000-0000-4000-8000-000000000301',
      name: 'Garden decision',
      referenceKey: 'GARDEN'
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          projects: [
            {
              id: 'default',
              name: 'N²',
              referenceKey: 'N2',
              canvasItemCount: 52,
              archivedAt: null,
              lifecycleRevision: 0
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            disposition: 'created',
            project: {
              id: input.projectId,
              name: input.name,
              referenceKey: input.referenceKey,
              canvasItemCount: 0,
              archivedAt: null,
              lifecycleRevision: 0
            }
          },
          { status: 201 }
        )
      );
    const client = createN2Client({ baseUrl: 'http://127.0.0.1:4317', fetch });

    await expect(client.listProjects()).resolves.toMatchObject({
      projects: [expect.objectContaining({ id: 'default', referenceKey: 'N2' })]
    });
    await expect(client.createProject(input)).resolves.toMatchObject({
      disposition: 'created',
      project: { id: input.projectId, referenceKey: 'GARDEN' }
    });

    expect(fetch.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4317/api/projects');
    expect(fetch.mock.calls[1]).toMatchObject([
      'http://127.0.0.1:4317/api/projects',
      { method: 'POST', body: JSON.stringify(input) }
    ]);
  });

  it('lists archived Projects only on request and correlates lifecycle responses', async () => {
    const summary = {
      id: 'default',
      name: 'Electricity Renewal 2026',
      referenceKey: 'N2',
      canvasItemCount: 4,
      archivedAt: '2026-10-18T12:00:00.000Z',
      lifecycleRevision: 0
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ projects: [summary] }))
      .mockResolvedValueOnce(Response.json({ disposition: 'updated', project: summary }))
      .mockResolvedValueOnce(Response.json({ disposition: 'unchanged', project: summary }))
      .mockResolvedValueOnce(Response.json({ disposition: 'updated', project: summary }));
    const client = createN2Client({ baseUrl: 'http://127.0.0.1:4317', fetch });

    await client.listProjects({ includeArchived: true });
    await expect(
      client.renameProject('default', { name: ' Electricity Renewal 2026 ' })
    ).resolves.toMatchObject({ disposition: 'updated' });
    await expect(client.archiveProject('default')).resolves.toMatchObject({
      disposition: 'unchanged'
    });
    await expect(client.restoreProject('default')).rejects.toBeInstanceOf(N2ProtocolError);

    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      ['http://127.0.0.1:4317/api/projects?include=archived', undefined, undefined],
      [
        'http://127.0.0.1:4317/api/projects/default',
        'PATCH',
        JSON.stringify({ name: 'Electricity Renewal 2026' })
      ],
      ['http://127.0.0.1:4317/api/projects/default/archive', 'POST', undefined],
      ['http://127.0.0.1:4317/api/projects/default/restore', 'POST', undefined]
    ]);
  });

  it('reports the actual creation status when returned Project identity is invalid', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          disposition: 'created',
          project: {
            id: '00000000-0000-4000-8000-000000000099',
            name: 'Wrong Project',
            referenceKey: 'WRONG',
            canvasItemCount: 0,
            archivedAt: null,
            lifecycleRevision: 0
          }
        },
        { status: 201 }
      )
    );
    const client = createN2Client({ baseUrl: 'http://local', fetch });

    await expect(
      client.createProject({
        projectId: '00000000-0000-4000-8000-000000000002',
        name: 'Garden decision',
        referenceKey: 'GARDEN'
      })
    ).rejects.toMatchObject({ status: 201 });
  });

  it('preserves a structured initial-Settings creation conflict', async () => {
    const projectId = '00000000-0000-4000-8000-000000000088';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          code: 'project_conflict',
          error: `Project ${projectId} already exists with different initial settings.`,
          details: { field: 'initialSettings', value: projectId }
        },
        { status: 409 }
      )
    );
    const client = createN2Client({ baseUrl: 'http://local', fetch });

    await expect(
      client.createProject({
        projectId,
        name: 'Configured',
        referenceKey: 'CONFIG',
        settings: { minimapVisible: false }
      })
    ).rejects.toMatchObject({
      status: 409,
      body: { code: 'project_conflict', details: { field: 'initialSettings', value: projectId } }
    });
  });

  it('operates Application Preferences and effective Project Settings', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(applicationPreferences))
      .mockResolvedValueOnce(
        Response.json({
          ...applicationPreferences,
          values: { ...applicationPreferences.values, minimapVisible: false },
          storedValues: { minimapVisible: false }
        })
      )
      .mockResolvedValueOnce(Response.json(applicationPreferences))
      .mockResolvedValueOnce(Response.json(projectSettings))
      .mockResolvedValueOnce(Response.json(projectSettings))
      .mockResolvedValueOnce(Response.json(clearedProjectSettings));
    const client = createN2Client({ baseUrl: 'http://local', fetch });

    await expect(client.getApplicationPreferences()).resolves.toEqual(applicationPreferences);
    await client.updateApplicationPreference({ key: 'minimapVisible', value: false });
    await client.restoreApplicationPreference('minimapVisible');
    await expect(client.getProjectSettings('default')).resolves.toEqual(projectSettings);
    await client.updateProjectSettingOverride('default', {
      key: 'handleOrientation',
      value: 'vertical'
    });
    await client.clearProjectSettingOverride('default', 'handleOrientation');

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://local/api/settings/application',
      'http://local/api/settings/application/minimapVisible',
      'http://local/api/settings/application/minimapVisible',
      'http://local/api/projects/default/settings',
      'http://local/api/projects/default/settings/handleOrientation',
      'http://local/api/projects/default/settings/handleOrientation'
    ]);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ value: false })
    });
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(fetch.mock.calls[4]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ value: 'vertical' })
    });
    expect(fetch.mock.calls[5]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('rejects a Project Settings response for another Project', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ...projectSettings, projectId: 'other' }));
    const client = createN2Client({ baseUrl: 'http://local', fetch });

    await expect(client.getProjectSettings('default')).rejects.toMatchObject({ status: 200 });
  });

  it('rejects contradictory effective Settings snapshots', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        ...projectSettings,
        effectiveValues: { ...projectSettings.effectiveValues, handleOrientation: 'horizontal' }
      })
    );
    const client = createN2Client({ baseUrl: 'http://local', fetch });

    const error = await client.getProjectSettings('default').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(N2ProtocolError);
    if (!(error instanceof N2ProtocolError)) throw new Error('Expected a protocol error.');
    expect(error.status).toBe(200);
    expect(error.issues).toContainEqual(
      expect.objectContaining({ path: ['effectiveValues', 'handleOrientation'] })
    );
  });

  it('rejects successful mutation responses that did not apply the requested transition', async () => {
    const ignoredApplicationUpdate = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(applicationPreferences));
    const applicationClient = createN2Client({
      baseUrl: 'http://local',
      fetch: ignoredApplicationUpdate
    });
    await expect(
      applicationClient.updateApplicationPreference({ key: 'minimapVisible', value: false })
    ).rejects.toMatchObject({ status: 200 });

    const ignoredDefaultValuedUpdate = createN2Client({
      baseUrl: 'http://local',
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json(applicationPreferences))
    });
    await expect(
      ignoredDefaultValuedUpdate.updateApplicationPreference({
        key: 'handleOrientation',
        value: 'horizontal'
      })
    ).rejects.toMatchObject({ status: 200 });

    const ignoredRestore = createN2Client({
      baseUrl: 'http://local',
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          ...applicationPreferences,
          storedValues: { handleOrientation: 'horizontal' }
        })
      )
    });
    await expect(
      ignoredRestore.restoreApplicationPreference('handleOrientation')
    ).rejects.toMatchObject({ status: 200 });

    const ignoredProjectClear = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(projectSettings));
    const projectClient = createN2Client({ baseUrl: 'http://local', fetch: ignoredProjectClear });
    await expect(
      projectClient.clearProjectSettingOverride('default', 'handleOrientation')
    ).rejects.toMatchObject({ status: 200 });
  });

  it.each([
    { status: 200, disposition: 'created' as const },
    { status: 201, disposition: 'existing' as const }
  ])(
    'rejects HTTP $status with contradictory $disposition disposition',
    async ({ status, disposition }) => {
      const input = {
        projectId: '00000000-0000-4000-8000-000000000002',
        name: 'Garden decision',
        referenceKey: 'GARDEN'
      };
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json(
          {
            disposition,
            project: {
              id: input.projectId,
              name: input.name,
              referenceKey: input.referenceKey,
              canvasItemCount: 0,
              archivedAt: null,
              lifecycleRevision: 0
            }
          },
          { status }
        )
      );
      const client = createN2Client({ baseUrl: 'http://local', fetch });

      await expect(client.createProject(input)).rejects.toMatchObject({ status });
    }
  );

  it('validates and sends canonical command documents', async () => {
    const commandId = '00000000-0000-4000-8000-000000000001';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          project: {
            id: 'default',
            name: 'N²',
            referenceKey: 'N2',
            nodes: [],
            relationships: [],
            warnings: [],
            latestSequence: 0
          },
          commandId,
          disposition: 'applied',
          outcome: { kind: 'relationship_deleted', relationshipId: 'relationship' }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const client = createN2Client({ baseUrl: 'http://127.0.0.1:4317/', fetch });

    await client.executeCommand('default', {
      kind: 'delete_relationship',
      commandId,
      relationshipId: 'relationship'
    });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:4317/api/projects/default/commands');
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        kind: 'delete_relationship',
        commandId,
        relationshipId: 'relationship'
      })
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('preserves machine-readable API failures', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'not_found', error: 'Project missing does not exist.' }),
        {
          status: 404,
          headers: { 'content-type': 'application/json' }
        }
      )
    );
    const client = createN2Client({ fetch });

    const error = await client.getProject('missing').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(N2ApiError);
    expect(error).toMatchObject({
      status: 404,
      body: { code: 'not_found', error: 'Project missing does not exist.' }
    });
  });

  it('distinguishes invalid success payloads from command validation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const client = createN2Client({ fetch });

    const error = await client.getProject('default').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(N2ProtocolError);
    expect(error).toMatchObject({
      status: 200,
      message: 'The local service response did not match the N² protocol.'
    });
  });

  it('rejects command metadata that does not correlate with the request', async () => {
    const commandId = '00000000-0000-4000-8000-000000000010';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        commandId,
        disposition: 'applied',
        project: {
          id: 'default',
          name: 'N²',
          referenceKey: 'N2',
          nodes: [],
          relationships: [],
          warnings: [],
          latestSequence: 0
        },
        outcome: { kind: 'node_created', nodeId: 'wrong' }
      })
    );
    const client = createN2Client({ fetch });

    const error = await client
      .executeCommand('default', {
        kind: 'delete_relationship',
        commandId,
        relationshipId: 'expected'
      })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(N2ProtocolError);
    expect(error).toMatchObject({
      message: 'The local service returned command metadata that did not match the request.'
    });
  });

  it('correlates project and explanation query responses with their requested IDs', async () => {
    const wrongProject = createN2Client({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          id: 'other',
          name: 'Other',
          referenceKey: 'OTHER',
          nodes: [],
          relationships: [],
          warnings: [],
          latestSequence: 0
        })
      )
    });
    const projectError = await wrongProject
      .getProject('requested')
      .catch((cause: unknown) => cause);
    expect(projectError).toMatchObject({
      message: 'The local service returned a project that did not match the request.'
    });

    const projectedNode = {
      id: 'other-node',
      reference: 'N2-99',
      title: 'Other node',
      description: '',
      kind: 'task',
      requestedStatus: 'ready',
      effectiveStatus: 'ready',
      progress: 0,
      blockedBy: [],
      position: { x: 0, y: 0 },
      version: 0,
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z'
    };
    const wrongExplanation = createN2Client({
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          projectId: 'default',
          node: projectedNode,
          status: {
            requested: 'ready',
            effective: 'ready',
            basis: 'requested_status',
            blockers: []
          },
          progress: { value: 0, basis: 'requested_status', members: [] },
          relationships: { groups: [], members: [], dependencies: [], dependents: [] }
        })
      )
    });
    const explanationError = await wrongExplanation
      .explainNode('default', 'requested-node')
      .catch((cause: unknown) => cause);
    expect(explanationError).toMatchObject({
      message: 'The local service returned a node explanation that did not match the request.'
    });
  });

  it('turns non-JSON HTTP failures into a stable API fallback', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response('Service unavailable', { status: 503 }));
    const client = createN2Client({ fetch });

    const error = await client.getProject('default').catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(N2ApiError);
    expect(error).toMatchObject({
      status: 503,
      body: {
        code: 'unexpected',
        error: 'The local service returned 503 with a non-JSON response.'
      }
    });
  });

  it('bounds stalled local requests with a typed timeout', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timed out', 'TimeoutError')),
            {
              once: true
            }
          );
        })
    );
    const client = createN2Client({ fetch, timeoutMs: 5 });

    const error = await client.getProject('default').catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'service_timeout',
      message: 'The local service did not respond within 5 ms.'
    });
  });

  it('keeps the typed timeout when response headers arrive before a stalled body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new DOMException('Timed out', 'TimeoutError')),
                { once: true }
              );
            }
          })
        )
      )
    );
    const client = createN2Client({ fetch, timeoutMs: 5 });

    const error = await client.getProject('default').catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      code: 'service_timeout',
      message: 'The local service did not respond within 5 ms.'
    });
  });
});
