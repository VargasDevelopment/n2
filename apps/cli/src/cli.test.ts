import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runCli, type CliRuntime } from './cli.js';

const projectedProject = {
  id: 'default',
  name: 'N²',
  referenceKey: 'N2',
  nodes: [],
  relationships: [],
  warnings: [],
  latestSequence: 0
};

const runtime = (response: Response, stdin = '') => {
  const stdout = vi.fn();
  const stderr = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
  const value: CliRuntime = {
    env: {},
    fetch,
    readStdin: vi.fn().mockResolvedValue(stdin),
    readFile: vi.fn().mockRejectedValue(new Error('Unexpected file read.')),
    stdout,
    stderr
  };
  return { runtime: value, stdout, stderr, fetch };
};

describe('N² CLI', () => {
  it('shows execution state and previews Group enablement through typed reads', async () => {
    const execution = { projectId: 'default', tasks: [], attempts: [] };
    const show = runtime(Response.json(execution));
    await expect(runCli(['execution', 'show'], show.runtime)).resolves.toBe(0);
    expect(show.fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4317/api/projects/default/execution'
    );
    expect(JSON.parse(show.stdout.mock.calls[0]![0] as string)).toEqual(execution);

    const preview = {
      projectId: 'default',
      groupId: 'group',
      previewToken: `sha256:${'1'.repeat(64)}`,
      tasks: [{ taskId: 'task', reference: 'N2-1', title: 'Task' }]
    };
    const previewRun = runtime(Response.json(preview));
    await expect(runCli(['execution', 'preview', 'group'], previewRun.runtime)).resolves.toBe(0);
    expect(previewRun.fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4317/api/projects/default/groups/group/agent-enablement-preview'
    );
  });

  it('lists Projects through the Project Library endpoint', async () => {
    const library = {
      projects: [
        {
          id: 'default',
          name: 'N²',
          referenceKey: 'N2',
          canvasItemCount: 4,
          archivedAt: null,
          lifecycleRevision: 0
        }
      ]
    };
    const test = runtime(Response.json(library));

    await expect(runCli(['project', 'list'], test.runtime)).resolves.toBe(0);

    expect(JSON.parse(test.stdout.mock.calls[0]![0] as string)).toEqual(library);
    const [url, init] = test.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:4317/api/projects');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('creates a Project from explicit human-readable metadata', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    const response = {
      disposition: 'created',
      project: {
        projectId,
        id: projectId,
        name: 'Garden',
        referenceKey: 'GARDEN',
        canvasItemCount: 0,
        archivedAt: null,
        lifecycleRevision: 0
      }
    };
    const test = runtime(Response.json(response, { status: 201 }));

    await expect(
      runCli(
        [
          'project',
          'create',
          '--id',
          projectId,
          '--name',
          'Garden',
          '--key',
          'GARDEN',
          '--settings',
          '{"handleOrientation":"vertical"}'
        ],
        test.runtime
      )
    ).resolves.toBe(0);

    expect(test.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/projects',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          projectId,
          name: 'Garden',
          referenceKey: 'GARDEN',
          settings: { handleOrientation: 'vertical' }
        })
      })
    );
  });

  it('reads and changes Settings through explicit scopes', async () => {
    const applicationPreferences = {
      values: { handleOrientation: 'vertical', minimapVisible: true, theme: 'midnight' },
      productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      storedValues: { handleOrientation: 'vertical' }
    };
    const application = runtime(Response.json(applicationPreferences));
    await expect(
      runCli(
        ['settings', 'application', 'set', 'handleOrientation', 'vertical'],
        application.runtime
      )
    ).resolves.toBe(0);
    expect(application.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/settings/application/handleOrientation',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ value: 'vertical' }) })
    );

    const projectSettings = {
      projectId: 'project',
      effectiveValues: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'paper' },
      applicationValues: {
        handleOrientation: 'horizontal',
        minimapVisible: true,
        theme: 'midnight'
      },
      sources: {
        handleOrientation: 'application',
        minimapVisible: 'application',
        theme: 'project'
      },
      overrides: { theme: 'paper' }
    };
    const pin = runtime(Response.json(projectSettings));
    await expect(
      runCli(['settings', 'project', 'set', 'theme', 'paper', '--project', 'project'], pin.runtime)
    ).resolves.toBe(0);
    expect(pin.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/projects/project/settings/theme',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ value: 'paper' }) })
    );

    const project = runtime(Response.json(projectSettings));
    await expect(
      runCli(
        ['settings', 'project', 'clear', 'handleOrientation', '--project', 'project'],
        project.runtime
      )
    ).resolves.toBe(0);
    expect(project.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/projects/project/settings/handleOrientation',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('rejects invalid typed Settings values before transport', async () => {
    const test = runtime(Response.json(projectedProject));
    await expect(
      runCli(['settings', 'application', 'set', 'minimapVisible', 'sometimes'], test.runtime)
    ).resolves.toBe(1);

    expect(test.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(test.stderr.mock.calls[0]![0] as string)).toMatchObject({
      ok: false,
      error: { code: 'usage_error', message: 'Minimap visibility must be true or false.' }
    });

    const theme = runtime(Response.json(projectedProject));
    await expect(
      runCli(['settings', 'application', 'set', 'theme', 'neon'], theme.runtime)
    ).resolves.toBe(1);
    expect(theme.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(theme.stderr.mock.calls[0]![0] as string)).toMatchObject({
      error: {
        code: 'usage_error',
        message: 'Theme must be one of midnight, mono, paper, ember, system.'
      }
    });
  });

  it('keeps Application Settings independent from Project selection', async () => {
    const preferences = {
      values: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      productDefaults: { handleOrientation: 'horizontal', minimapVisible: true, theme: 'midnight' },
      storedValues: {}
    };
    const ignoresBlankEnvironment = runtime(Response.json(preferences));
    ignoresBlankEnvironment.runtime.env = { N2_PROJECT_ID: '' };
    await expect(
      runCli(['settings', 'application', 'show'], ignoresBlankEnvironment.runtime)
    ).resolves.toBe(0);
    expect(ignoresBlankEnvironment.fetch).toHaveBeenCalled();

    const rejectsSelector = runtime(Response.json(preferences));
    await expect(
      runCli(['settings', 'application', 'show', '--project', 'unrelated'], rejectsSelector.runtime)
    ).resolves.toBe(1);
    expect(rejectsSelector.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(rejectsSelector.stderr.mock.calls[0]![0] as string)).toMatchObject({
      error: { code: 'usage_error', message: 'Application Settings do not accept --project.' }
    });
  });

  it('includes Archived Projects only when listing with --all', async () => {
    const test = runtime(Response.json({ projects: [] }));
    await expect(runCli(['project', 'list', '--all'], test.runtime)).resolves.toBe(0);
    expect(test.fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4317/api/projects?include=archived'
    );
  });

  it('renames, archives, and restores an explicitly selected Project', async () => {
    const project = {
      id: 'elec',
      name: 'Electricity Renewal 2026',
      referenceKey: 'ELEC',
      canvasItemCount: 12,
      archivedAt: '2026-10-18T12:00:00.000Z',
      lifecycleRevision: 0
    };
    const archive = runtime(Response.json({ disposition: 'updated', project }));
    await expect(
      runCli(['project', 'archive', '--project', 'elec'], archive.runtime)
    ).resolves.toBe(0);
    expect(archive.fetch.mock.calls[0]).toMatchObject([
      'http://127.0.0.1:4317/api/projects/elec/archive',
      { method: 'POST' }
    ]);
    expect(JSON.parse(archive.stdout.mock.calls[0]![0] as string)).toEqual({
      disposition: 'updated',
      project
    });

    const restore = runtime(
      Response.json({ disposition: 'updated', project: { ...project, archivedAt: null } })
    );
    await expect(
      runCli(['project', 'restore', '--project', 'elec'], restore.runtime)
    ).resolves.toBe(0);
    expect(restore.fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4317/api/projects/elec/restore'
    );

    const rename = runtime(
      Response.json({ disposition: 'updated', project: { ...project, name: 'Power 2026' } })
    );
    await expect(
      runCli(['project', 'rename', '--project', 'elec', '--name', 'Power 2026'], rename.runtime)
    ).resolves.toBe(0);
    expect(rename.fetch.mock.calls[0]).toMatchObject([
      'http://127.0.0.1:4317/api/projects/elec',
      { method: 'PATCH', body: JSON.stringify({ name: 'Power 2026' }) }
    ]);
  });

  it('refuses lifecycle changes without an explicit Project or a valid name', async () => {
    const ambient = runtime(Response.json({}));
    ambient.runtime.env = { N2_PROJECT_ID: 'elec' };
    await expect(runCli(['project', 'archive'], ambient.runtime)).resolves.toBe(1);
    expect(JSON.parse(ambient.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: {
        code: 'usage_error',
        message: 'project archive requires an explicit --project <id>.'
      }
    });

    const nameless = runtime(Response.json({}));
    await expect(
      runCli(['project', 'rename', '--project', 'elec', '--name', '  '], nameless.runtime)
    ).resolves.toBe(1);
    expect(nameless.fetch).not.toHaveBeenCalled();
    expect(nameless.stderr.mock.calls[0]![0]).toContain('requires --name');
  });

  it('reports an Archived Project rejection as machine-readable JSON', async () => {
    const rejection = {
      code: 'project_archived',
      error: 'Project elec is archived. Restore it before making changes.',
      details: { projectId: 'elec', archivedAt: '2026-10-18T12:00:00.000Z' }
    };
    const test = runtime(Response.json(rejection, { status: 409 }));
    await expect(
      runCli(['project', 'rename', '--project', 'elec', '--name', 'Power'], test.runtime)
    ).resolves.toBe(1);
    expect(JSON.parse(test.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: { code: 'project_archived', message: rejection.error, details: rejection.details }
    });
  });

  it('requires caller-owned retry identity for Project creation', async () => {
    const test = runtime(Response.json(projectedProject));

    await expect(
      runCli(['project', 'create', '--name', 'Garden', '--key', 'GARDEN'], test.runtime)
    ).resolves.toBe(1);

    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.stderr.mock.calls[0]![0]).toContain('Project ID');
    expect(JSON.parse(test.stderr.mock.calls[0]![0] as string)).toMatchObject({
      ok: false,
      error: { code: 'usage_error' }
    });
  });

  it('rejects existing-Project selectors on Project Library commands', async () => {
    const list = runtime(Response.json({ projects: [] }));
    await expect(runCli(['project', 'list', '--project', 'ignored'], list.runtime)).resolves.toBe(
      1
    );
    expect(list.fetch).not.toHaveBeenCalled();

    const create = runtime(Response.json(projectedProject));
    await expect(
      runCli(
        ['project', 'create', '--project', 'ignored', '--name', 'Garden', '--key', 'GARDEN'],
        create.runtime
      )
    ).resolves.toBe(1);
    expect(create.fetch).not.toHaveBeenCalled();
    const errorOutput = create.stderr.mock.calls[0]![0] as string;
    expect(errorOutput).toContain('uses --id');
    expect(JSON.parse(errorOutput)).toMatchObject({ error: { code: 'usage_error' } });
  });

  it('queries a project as machine-readable JSON', async () => {
    const test = runtime(Response.json(projectedProject));

    await expect(runCli(['project', 'show'], test.runtime)).resolves.toBe(0);

    expect(JSON.parse(test.stdout.mock.calls[0]![0] as string)).toEqual(projectedProject);
    const [url, init] = test.fetch.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:4317/api/projects/default');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(test.stderr).not.toHaveBeenCalled();
  });

  it('runs a validated command from stdin as the agent named by N2_AGENT_NAME', async () => {
    const commandId = '00000000-0000-4000-8000-000000000001';
    const command = {
      kind: 'update_node',
      commandId,
      nodeId: 'node',
      expectedVersion: 3,
      patch: { requestedStatus: 'done' }
    };
    const test = runtime(
      Response.json({
        commandId,
        disposition: 'applied',
        project: projectedProject,
        outcome: { kind: 'node_updated', nodeId: 'node' }
      }),
      JSON.stringify(command)
    );

    await expect(
      runCli(['command', 'run'], { ...test.runtime, env: { N2_AGENT_NAME: 'codex review' } })
    ).resolves.toBe(0);

    expect(test.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/projects/default/commands',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(command) })
    );
    expect(test.fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      'n2-actor': 'agent:codex%20review'
    });
  });

  it('shows Project Activity as a typed read', async () => {
    const activity = {
      projectId: 'default',
      latestSequence: 0,
      seen: null,
      unseenItemCount: 0,
      runs: [],
      hasEarlier: false
    };
    const test = runtime(Response.json(activity));

    await expect(runCli(['activity', 'show'], test.runtime)).resolves.toBe(0);

    expect(test.fetch.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4317/api/projects/default/activity'
    );
    expect(JSON.parse(test.stdout.mock.calls[0]![0] as string)).toEqual(activity);
  });

  it('rejects invalid commands locally with structured details', async () => {
    const test = runtime(Response.json(projectedProject), JSON.stringify({ kind: 'update_node' }));

    await expect(runCli(['command', 'run'], test.runtime)).resolves.toBe(1);

    expect(test.fetch).not.toHaveBeenCalled();
    const result = z
      .object({
        ok: z.literal(false),
        error: z
          .object({
            code: z.literal('validation_error'),
            message: z.literal('The command document is invalid.'),
            details: z
              .object({
                issues: z.array(
                  z
                    .object({
                      path: z.array(z.union([z.string(), z.number()])),
                      code: z.string(),
                      message: z.string()
                    })
                    .strict()
                )
              })
              .strict()
          })
          .strict()
      })
      .strict()
      .parse(JSON.parse(test.stderr.mock.calls[0]![0] as string));
    expect(
      result.error.details.issues.some(
        ({ path, code }) => path.join('.') === 'commandId' && code === 'invalid_type'
      )
    ).toBe(true);
  });

  it('keeps service and API failures machine-readable', async () => {
    const unavailable = runtime(Response.json(projectedProject));
    unavailable.fetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(runCli(['project', 'show'], unavailable.runtime)).resolves.toBe(1);
    expect(JSON.parse(unavailable.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: { code: 'service_unavailable', message: 'fetch failed' }
    });

    const missing = runtime(
      Response.json(
        { code: 'not_found', error: 'Project missing does not exist.' },
        { status: 404 }
      )
    );
    await expect(runCli(['project', 'show'], missing.runtime)).resolves.toBe(1);
    expect(JSON.parse(missing.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Project missing does not exist.' }
    });

    const invalidResponse = runtime(Response.json({}));
    await expect(runCli(['project', 'show'], invalidResponse.runtime)).resolves.toBe(1);
    expect(JSON.parse(invalidResponse.stderr.mock.calls[0]![0] as string)).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_response',
        message: 'The local service response did not match the N² protocol.',
        details: { status: 200 }
      }
    });

    const plainTextFailure = runtime(new Response('Unavailable', { status: 503 }));
    await expect(runCli(['project', 'show'], plainTextFailure.runtime)).resolves.toBe(1);
    expect(JSON.parse(plainTextFailure.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: {
        code: 'unexpected',
        message: 'The local service returned 503 with a non-JSON response.'
      }
    });

    const stalled = runtime(Response.json(projectedProject));
    stalled.runtime.env = { N2_TIMEOUT_MS: '5' };
    stalled.fetch.mockImplementation(
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
    await expect(runCli(['project', 'show'], stalled.runtime)).resolves.toBe(1);
    expect(JSON.parse(stalled.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: {
        code: 'service_timeout',
        message: 'The local service did not respond within 5 ms.'
      }
    });
  });

  it('rejects blank local configuration before making a request', async () => {
    const blankProject = runtime(Response.json(projectedProject));
    await expect(runCli(['project', 'show', '--project', ''], blankProject.runtime)).resolves.toBe(
      1
    );
    expect(JSON.parse(blankProject.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: { code: 'usage_error', message: 'Project ID cannot be blank.' }
    });
    expect(blankProject.fetch).not.toHaveBeenCalled();

    const blankUrl = runtime(Response.json(projectedProject));
    await expect(runCli(['project', 'show', '--api-url', ''], blankUrl.runtime)).resolves.toBe(1);
    expect(JSON.parse(blankUrl.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: { code: 'usage_error', message: 'API URL must be an absolute URL.' }
    });
    expect(blankUrl.fetch).not.toHaveBeenCalled();
  });

  it('treats file selection as explicit and reports stable file errors', async () => {
    const bothSources = runtime(Response.json(projectedProject));
    await expect(
      runCli(
        ['command', 'run', '--file', '', '--data', '{"kind":"delete_relationship"}'],
        bothSources.runtime
      )
    ).resolves.toBe(1);
    expect(JSON.parse(bothSources.stderr.mock.calls[0]![0] as string)).toEqual({
      ok: false,
      error: { code: 'usage_error', message: 'Use only one of --file or --data.' }
    });
    expect(bothSources.runtime.readStdin).not.toHaveBeenCalled();
    expect(bothSources.fetch).not.toHaveBeenCalled();

    const blankFile = runtime(Response.json(projectedProject), '{"kind":"delete_node"}');
    await expect(runCli(['command', 'run', '--file', ''], blankFile.runtime)).resolves.toBe(1);
    expect(JSON.parse(blankFile.stderr.mock.calls[0]![0] as string)).toMatchObject({
      ok: false,
      error: { code: 'file_error', message: 'Command file path cannot be blank.' }
    });
    expect(blankFile.runtime.readStdin).not.toHaveBeenCalled();
    expect(blankFile.fetch).not.toHaveBeenCalled();

    const missingFile = runtime(Response.json(projectedProject));
    await expect(
      runCli(['command', 'run', '--file', '/missing/command.json'], missingFile.runtime)
    ).resolves.toBe(1);
    expect(JSON.parse(missingFile.stderr.mock.calls[0]![0] as string)).toMatchObject({
      ok: false,
      error: {
        code: 'file_error',
        message: 'The command file could not be read.',
        details: { path: '/missing/command.json' }
      }
    });
    expect(missingFile.runtime.readStdin).not.toHaveBeenCalled();
    expect(missingFile.fetch).not.toHaveBeenCalled();
  });

  it('prints the canonical command schema without contacting the service', async () => {
    const test = runtime(Response.json(projectedProject));

    await expect(runCli(['command', 'schema'], test.runtime)).resolves.toBe(0);

    const schema: unknown = JSON.parse(test.stdout.mock.calls[0]![0] as string);
    expect(
      z.object({ oneOf: z.array(z.unknown()).min(1) }).parse(schema).oneOf.length
    ).toBeGreaterThan(0);
    expect(JSON.stringify(schema)).toContain('planningPlacement');
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it('shows help at command level without contacting the service', async () => {
    const test = runtime(Response.json(projectedProject));

    await expect(runCli(['project', 'show', '--help'], test.runtime)).resolves.toBe(0);

    expect(test.stdout.mock.calls[0]?.[0]).toContain('n2 project show');
    expect(test.fetch).not.toHaveBeenCalled();
  });
});
