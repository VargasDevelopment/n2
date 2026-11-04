import {
  projectCommandOutcome,
  ApplicationPreferencesSchema,
  ApiErrorSchema,
  CreateProjectInputSchema,
  CreateProjectResponseSchema,
  NodeExplanationSchema,
  ProjectLibrarySchema,
  ProjectCommandResponseSchema,
  ProjectCommandSchema,
  ProjectedProjectSchema,
  EffectiveProjectSettingsSchema,
  GroupEnablePreviewSchema,
  ProjectExecutionSchema,
  ApplicationPreferenceInputSchema,
  ApplicationPreferenceKeySchema,
  ProjectSettingInputSchema,
  ProjectSettingKeySchema,
  ProjectUpdateResponseSchema,
  RenameProjectInputSchema,
  type ApplicationPreferences,
  type ApplicationPreferenceInput,
  type ApplicationPreferenceKey,
  type ApiError,
  type CreateProjectInput,
  type CreateProjectResponse,
  type EffectiveProjectSettings,
  type GroupEnablePreview,
  type NodeExplanation,
  type ProjectCommandInput,
  type ProjectCommandResponse,
  type ProjectLibrary,
  type ProjectLibraryQuery,
  type ProjectUpdateResponse,
  type RenameProjectInput,
  type ProjectSettingInput,
  type ProjectSettingKey,
  type ProjectedProject,
  type ProjectExecution,
  COMMAND_ACTOR_HEADER,
  formatCommandActorHeader,
  LibraryActivitySchema,
  LibrarySeenMarkersSchema,
  ProjectActivitySchema,
  SeenMarkerSchema,
  type CommandActor,
  type LibraryActivity,
  type LibrarySeenMarkers,
  type MarkLibraryActivitySeenInput,
  type ProjectActivity,
  type SeenMarker
} from '@n2/contracts';
import type { ZodType } from 'zod';

export class N2ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError
  ) {
    super(body.error);
  }
}

export class N2ProtocolError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path: (string | number)[]; code: string; message: string }[] = []
  ) {
    super(message);
  }
}

export class N2TransportError extends Error {
  constructor(
    readonly code: 'service_timeout' | 'service_unavailable',
    message: string
  ) {
    super(message);
  }
}

export type N2Client = {
  listProjects: (query?: ProjectLibraryQuery) => Promise<ProjectLibrary>;
  createProject: (input: CreateProjectInput) => Promise<CreateProjectResponse>;
  renameProject: (projectId: string, input: RenameProjectInput) => Promise<ProjectUpdateResponse>;
  archiveProject: (projectId: string) => Promise<ProjectUpdateResponse>;
  restoreProject: (projectId: string) => Promise<ProjectUpdateResponse>;
  getApplicationPreferences: () => Promise<ApplicationPreferences>;
  updateApplicationPreference: (
    input: ApplicationPreferenceInput
  ) => Promise<ApplicationPreferences>;
  restoreApplicationPreference: (key: ApplicationPreferenceKey) => Promise<ApplicationPreferences>;
  getProjectSettings: (projectId: string) => Promise<EffectiveProjectSettings>;
  updateProjectSettingOverride: (
    projectId: string,
    input: ProjectSettingInput
  ) => Promise<EffectiveProjectSettings>;
  clearProjectSettingOverride: (
    projectId: string,
    key: ProjectSettingKey
  ) => Promise<EffectiveProjectSettings>;
  getProject: (projectId: string) => Promise<ProjectedProject>;
  getExecution: (projectId: string) => Promise<ProjectExecution>;
  previewGroupEnablement: (projectId: string, groupId: string) => Promise<GroupEnablePreview>;
  executeCommand: (
    projectId: string,
    command: ProjectCommandInput
  ) => Promise<ProjectCommandResponse>;
  explainNode: (projectId: string, nodeLocator: string) => Promise<NodeExplanation>;
  getActivity: (projectId: string) => Promise<ProjectActivity>;
  getLibraryActivity: () => Promise<LibraryActivity>;
  markActivitySeen: (projectId: string, sequence: number) => Promise<SeenMarker>;
  markLibraryActivitySeen: (input: MarkLibraryActivitySeenInput) => Promise<LibrarySeenMarkers>;
};

type ClientOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Declared on every Project Command so Project Activity can say who changed what. */
  actor?: CommandActor;
};

const projectPath = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}`;

export function createN2Client(options: ClientOptions = {}): N2Client {
  const baseUrl = options.baseUrl?.replace(/\/$/, '') ?? '';
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('N² client timeout must be a positive integer.');
  }

  const requestResult = async <T>(
    path: string,
    schema: ZodType<T>,
    init?: RequestInit
  ): Promise<{ body: T; status: number }> => {
    let response: Response;
    let responseText: string;
    try {
      response = await fetchImplementation(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs)
      });
      responseText = await response.text();
    } catch (cause) {
      const timedOut =
        cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
      throw new N2TransportError(
        timedOut ? 'service_timeout' : 'service_unavailable',
        timedOut
          ? `The local service did not respond within ${timeoutMs} ms.`
          : cause instanceof Error
            ? cause.message
            : 'The local service request failed.'
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(responseText) as unknown;
    } catch {
      if (!response.ok) {
        throw new N2ApiError(response.status, {
          code: 'unexpected',
          error: `The local service returned ${response.status} with a non-JSON response.`
        });
      }
      throw new N2ProtocolError(
        response.status,
        'The local service returned a successful response that was not valid JSON.'
      );
    }
    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(body);
      throw new N2ApiError(
        response.status,
        parsed.success
          ? parsed.data
          : { code: 'unexpected', error: `The local service returned ${response.status}.` }
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new N2ProtocolError(
        response.status,
        'The local service response did not match the N² protocol.',
        parsed.error.issues.map(({ path, code, message }) => ({
          path: path.map((part) => (typeof part === 'symbol' ? part.toString() : part)),
          code,
          message
        }))
      );
    }
    return { body: parsed.data, status: response.status };
  };

  const request = <T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> =>
    requestResult(path, schema, init).then(({ body }) => body);

  const requireProjectSettingsIdentity = (
    projectId: string,
    settings: EffectiveProjectSettings
  ): EffectiveProjectSettings => {
    if (settings.projectId !== projectId) {
      throw new N2ProtocolError(
        200,
        'The local service returned settings that did not match the requested Project.'
      );
    }
    return settings;
  };

  const requireProjectUpdate = (
    projectId: string,
    expected: (project: ProjectUpdateResponse['project']) => boolean,
    response: ProjectUpdateResponse
  ): ProjectUpdateResponse => {
    if (response.project.id !== projectId || !expected(response.project)) {
      throw new N2ProtocolError(
        200,
        'The local service returned a Project update that did not match the request.'
      );
    }
    return response;
  };

  const settingMatches = <Values, Key extends keyof Values>(
    values: Partial<Values>,
    input: { key: Key; value: Values[Key] }
  ): boolean => values[input.key] === input.value;

  return {
    listProjects: (query = { includeArchived: false }) =>
      request(
        query.includeArchived ? '/api/projects?include=archived' : '/api/projects',
        ProjectLibrarySchema
      ),
    createProject: (input) => {
      const parsed = CreateProjectInputSchema.parse(input);
      return requestResult('/api/projects', CreateProjectResponseSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed)
      }).then(({ body: response, status }) => {
        const expectedStatus = response.disposition === 'created' ? 201 : 200;
        if (
          status !== expectedStatus ||
          response.project.id !== parsed.projectId ||
          response.project.name !== parsed.name ||
          response.project.referenceKey !== parsed.referenceKey
        ) {
          throw new N2ProtocolError(
            status,
            'The local service returned a Project creation response that did not match the request.'
          );
        }
        return response;
      });
    },
    renameProject: (projectId, input) => {
      const parsed = RenameProjectInputSchema.parse(input);
      return request(projectPath(projectId), ProjectUpdateResponseSchema, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed)
      }).then((response) =>
        requireProjectUpdate(projectId, ({ name }) => name === parsed.name, response)
      );
    },
    archiveProject: (projectId) =>
      request(`${projectPath(projectId)}/archive`, ProjectUpdateResponseSchema, {
        method: 'POST'
      }).then((response) =>
        requireProjectUpdate(projectId, ({ archivedAt }) => archivedAt !== null, response)
      ),
    restoreProject: (projectId) =>
      request(`${projectPath(projectId)}/restore`, ProjectUpdateResponseSchema, {
        method: 'POST'
      }).then((response) =>
        requireProjectUpdate(projectId, ({ archivedAt }) => archivedAt === null, response)
      ),
    getApplicationPreferences: () =>
      request('/api/settings/application', ApplicationPreferencesSchema),
    updateApplicationPreference: (input) => {
      const parsed = ApplicationPreferenceInputSchema.parse(input);
      return request(
        `/api/settings/application/${encodeURIComponent(parsed.key)}`,
        ApplicationPreferencesSchema,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: parsed.value })
        }
      ).then((preferences) => {
        if (!settingMatches(preferences.storedValues, parsed)) {
          throw new N2ProtocolError(
            200,
            'The local service did not acknowledge the Application Preference update.'
          );
        }
        return preferences;
      });
    },
    restoreApplicationPreference: (key) => {
      const parsed = ApplicationPreferenceKeySchema.parse(key);
      return request(
        `/api/settings/application/${encodeURIComponent(parsed)}`,
        ApplicationPreferencesSchema,
        { method: 'DELETE' }
      ).then((preferences) => {
        if (Object.hasOwn(preferences.storedValues, parsed)) {
          throw new N2ProtocolError(
            200,
            'The local service did not acknowledge the Application Preference restore.'
          );
        }
        return preferences;
      });
    },
    getProjectSettings: (projectId) =>
      request(`${projectPath(projectId)}/settings`, EffectiveProjectSettingsSchema).then(
        (settings) => requireProjectSettingsIdentity(projectId, settings)
      ),
    updateProjectSettingOverride: (projectId, input) => {
      const parsed = ProjectSettingInputSchema.parse(input);
      return request(
        `${projectPath(projectId)}/settings/${encodeURIComponent(parsed.key)}`,
        EffectiveProjectSettingsSchema,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: parsed.value })
        }
      ).then((settings) => {
        const identified = requireProjectSettingsIdentity(projectId, settings);
        if (!settingMatches(identified.overrides, parsed)) {
          throw new N2ProtocolError(
            200,
            'The local service did not acknowledge the Project Setting override.'
          );
        }
        return identified;
      });
    },
    clearProjectSettingOverride: (projectId, key) => {
      const parsed = ProjectSettingKeySchema.parse(key);
      return request(
        `${projectPath(projectId)}/settings/${encodeURIComponent(parsed)}`,
        EffectiveProjectSettingsSchema,
        { method: 'DELETE' }
      ).then((settings) => {
        const identified = requireProjectSettingsIdentity(projectId, settings);
        if (Object.hasOwn(identified.overrides, parsed)) {
          throw new N2ProtocolError(
            200,
            'The local service did not acknowledge the Project Setting clear.'
          );
        }
        return identified;
      });
    },
    getProject: (projectId) =>
      request(projectPath(projectId), ProjectedProjectSchema).then((project) => {
        if (project.id !== projectId) {
          throw new N2ProtocolError(
            200,
            'The local service returned a project that did not match the request.'
          );
        }
        return project;
      }),
    getExecution: (projectId) =>
      request(`${projectPath(projectId)}/execution`, ProjectExecutionSchema).then((execution) => {
        if (execution.projectId !== projectId) {
          throw new N2ProtocolError(
            200,
            'The local service returned execution state that did not match the requested Project.'
          );
        }
        return execution;
      }),
    previewGroupEnablement: (projectId, groupId) =>
      request(
        `${projectPath(projectId)}/groups/${encodeURIComponent(groupId)}/agent-enablement-preview`,
        GroupEnablePreviewSchema
      ).then((preview) => {
        if (preview.projectId !== projectId || preview.groupId !== groupId) {
          throw new N2ProtocolError(
            200,
            'The local service returned a Group preview that did not match the request.'
          );
        }
        return preview;
      }),
    executeCommand: (projectId, command) => {
      const parsed = ProjectCommandSchema.parse(command);
      return request(`${projectPath(projectId)}/commands`, ProjectCommandResponseSchema, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options.actor
            ? { [COMMAND_ACTOR_HEADER]: formatCommandActorHeader(options.actor) }
            : {})
        },
        body: JSON.stringify(parsed)
      }).then((response) => {
        const expectedOutcome = projectCommandOutcome(parsed);
        if (
          response.commandId !== parsed.commandId ||
          response.project.id !== projectId ||
          JSON.stringify(response.outcome) !== JSON.stringify(expectedOutcome)
        ) {
          throw new N2ProtocolError(
            200,
            'The local service returned command metadata that did not match the request.'
          );
        }
        return response;
      });
    },
    getActivity: (projectId) =>
      request(`${projectPath(projectId)}/activity`, ProjectActivitySchema),
    getLibraryActivity: () => request('/api/activity', LibraryActivitySchema),
    markActivitySeen: (projectId, sequence) =>
      request(`${projectPath(projectId)}/activity/seen`, SeenMarkerSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequence })
      }),
    markLibraryActivitySeen: (input) =>
      request('/api/activity/seen', LibrarySeenMarkersSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      }),
    explainNode: (projectId, nodeLocator) =>
      request(
        `${projectPath(projectId)}/nodes/${encodeURIComponent(nodeLocator)}/explanation`,
        NodeExplanationSchema
      ).then((explanation) => {
        if (
          explanation.projectId !== projectId ||
          (explanation.node.id !== nodeLocator &&
            explanation.node.reference !== nodeLocator.toUpperCase())
        ) {
          throw new N2ProtocolError(
            200,
            'The local service returned a node explanation that did not match the request.'
          );
        }
        return explanation;
      })
  };
}
