import {
  CanvasItemConflictError,
  CommandReceiptConflictError,
  EntityNotFoundError,
  EntityIdConflictError,
  ExecutionConflictError,
  ProjectArchivedError,
  ProjectConflictError,
  RelationshipConflictError,
  VersionConflictError,
  type ProjectUseCases
} from '@n2/application';
import {
  ApiErrorSchema,
  ApplicationPreferenceInputSchema,
  ApplicationPreferenceKeySchema,
  BUILD_COMMIT_HEADER,
  COMMAND_ACTOR_HEADER,
  CreateProjectInputSchema,
  MarkActivitySeenInputSchema,
  MarkLibraryActivitySeenInputSchema,
  parseCommandActorHeader,
  ProjectSettingInputSchema,
  ProjectSettingKeySchema,
  ProjectCommandTransportSchema,
  RenameProjectInputSchema
} from '@n2/contracts';
import type { ProjectCommand } from '@n2/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z, type ZodIssue, type ZodType } from 'zod';

class InvalidRequestJsonError extends Error {}
class RequestValidationError extends Error {
  constructor(readonly issues: readonly ZodIssue[]) {
    super('The request was invalid.');
  }
}

type ValidationIssue = {
  path: Array<string | number>;
  code: string;
  message: string;
};

const validationIssues = (issues: readonly ZodIssue[]): ValidationIssue[] =>
  issues.map((issue) => ({
    path: issue.path.map((part) => (typeof part === 'symbol' ? part.toString() : part)),
    code: issue.code,
    message: issue.message
  }));

const parseBody = async <T>(request: Request, schema: ZodType<T>): Promise<T> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new InvalidRequestJsonError();
    throw cause;
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
};

const SettingValueBodySchema = z.object({ value: z.unknown() }).strict();

const ProjectLibraryIncludeSchema = z.enum(['archived']).optional();

const parseProjectLibraryQuery = (include: string | undefined) => {
  const result = ProjectLibraryIncludeSchema.safeParse(include);
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return { includeArchived: result.data === 'archived' };
};

const parseApplicationPreferenceKey = (value: string) => {
  const result = ApplicationPreferenceKeySchema.safeParse(value);
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
};

const parseApplicationPreferenceValue = async (request: Request, key: string) => {
  const body = await parseBody(request, SettingValueBodySchema);
  const result = ApplicationPreferenceInputSchema.safeParse({
    key: parseApplicationPreferenceKey(key),
    value: body.value
  });
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
};

const parseProjectSettingKey = (value: string) => {
  const result = ProjectSettingKeySchema.safeParse(value);
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
};

const parseProjectSettingValue = async (request: Request, key: string) => {
  const body = await parseBody(request, SettingValueBodySchema);
  const result = ProjectSettingInputSchema.safeParse({
    key: parseProjectSettingKey(key),
    value: body.value
  });
  if (!result.success) throw new RequestValidationError(result.error.issues);
  return result.data;
};

const alternateNoteUpdate = (
  application: ProjectUseCases,
  projectId: string,
  command: ProjectCommand
): ProjectCommand | null => {
  if (command.kind !== 'update_node') return null;
  const hasDescription = command.patch.description !== undefined;
  const hasContent = command.patch.content !== undefined;
  if (hasDescription === hasContent) return null;

  const item = application.queryProject(projectId).nodes.find(({ id }) => id === command.nodeId);
  if (item?.kind !== 'note') return null;

  if (command.patch.description !== undefined) {
    const { description, ...patch } = command.patch;
    return { ...command, patch: { ...patch, content: description } };
  }
  if (command.patch.content !== undefined) {
    const { content, ...patch } = command.patch;
    return { ...command, patch: { ...patch, description: content } };
  }
  return null;
};

export function createApp(
  application: ProjectUseCases,
  readiness: () => { schemaVersion: number }
): Hono {
  const app = new Hono();
  const commit = process.env.N2_BUILD_COMMIT;

  // A development server has no build commit, so no tab can see itself as out of date.
  if (commit) {
    app.use('*', async (context, next) => {
      await next();
      context.header(BUILD_COMMIT_HEADER, commit);
    });
  }

  app.use(
    '/api/*',
    cors({
      origin: ['http://localhost:4318', 'http://127.0.0.1:4318'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', COMMAND_ACTOR_HEADER]
    })
  );

  app.get('/health', (context) => {
    const reported = commit ?? 'development';
    try {
      return context.json({ ok: true, ...readiness(), commit: reported });
    } catch {
      return context.json({ ok: false, commit: reported }, 503);
    }
  });

  app.get('/api/projects', (context) =>
    context.json(
      application.queryProjectLibrary(parseProjectLibraryQuery(context.req.query('include')))
    )
  );

  app.post('/api/projects', async (context) => {
    const result = application.createProject(
      await parseBody(context.req.raw, CreateProjectInputSchema)
    );
    return context.json(result, result.disposition === 'created' ? 201 : 200);
  });

  app.get('/api/settings/application', (context) =>
    context.json(application.queryApplicationPreferences())
  );

  app.put('/api/settings/application/:settingKey', async (context) =>
    context.json(
      application.updateApplicationPreference(
        await parseApplicationPreferenceValue(context.req.raw, context.req.param('settingKey'))
      )
    )
  );

  app.delete('/api/settings/application/:settingKey', (context) =>
    context.json(
      application.restoreApplicationPreference(
        parseApplicationPreferenceKey(context.req.param('settingKey'))
      )
    )
  );

  app.get('/api/projects/:projectId', (context) =>
    context.json(application.queryProject(context.req.param('projectId')))
  );

  app.patch('/api/projects/:projectId', async (context) =>
    context.json(
      application.renameProject(
        context.req.param('projectId'),
        await parseBody(context.req.raw, RenameProjectInputSchema)
      )
    )
  );

  app.post('/api/projects/:projectId/archive', (context) =>
    context.json(application.archiveProject(context.req.param('projectId')))
  );

  app.post('/api/projects/:projectId/restore', (context) =>
    context.json(application.restoreProject(context.req.param('projectId')))
  );

  app.get('/api/projects/:projectId/execution', (context) =>
    context.json(application.queryExecution(context.req.param('projectId')))
  );

  app.get('/api/projects/:projectId/groups/:groupId/agent-enablement-preview', (context) =>
    context.json(
      application.previewGroupEnablement(
        context.req.param('projectId'),
        context.req.param('groupId')
      )
    )
  );

  app.get('/api/projects/:projectId/settings', (context) =>
    context.json(application.queryProjectSettings(context.req.param('projectId')))
  );

  app.put('/api/projects/:projectId/settings/:settingKey', async (context) =>
    context.json(
      application.updateProjectSettingOverride(
        context.req.param('projectId'),
        await parseProjectSettingValue(context.req.raw, context.req.param('settingKey'))
      )
    )
  );

  app.delete('/api/projects/:projectId/settings/:settingKey', (context) =>
    context.json(
      application.clearProjectSettingOverride(
        context.req.param('projectId'),
        parseProjectSettingKey(context.req.param('settingKey'))
      )
    )
  );

  app.post('/api/projects/:projectId/commands', async (context) => {
    const projectId = context.req.param('projectId');
    const command = await parseBody(context.req.raw, ProjectCommandTransportSchema);
    const alternate = alternateNoteUpdate(application, projectId, command);
    // An absent or malformed actor is recorded as unknown rather than rejecting the change.
    const actor = parseCommandActorHeader(context.req.header(COMMAND_ACTOR_HEADER));
    try {
      return context.json(application.executeCommand(projectId, command, actor));
    } catch (cause) {
      if (
        !alternate ||
        (!(cause instanceof CanvasItemConflictError) &&
          !(cause instanceof CommandReceiptConflictError))
      ) {
        throw cause;
      }
      return context.json(application.executeCommand(projectId, alternate, actor));
    }
  });

  app.get('/api/activity', (context) => context.json(application.queryLibraryActivity()));

  app.post('/api/activity/seen', async (context) =>
    context.json(
      application.markLibraryActivitySeen(
        await parseBody(context.req.raw, MarkLibraryActivitySeenInputSchema)
      )
    )
  );

  app.get('/api/projects/:projectId/activity', (context) =>
    context.json(application.queryActivity(context.req.param('projectId')))
  );

  app.post('/api/projects/:projectId/activity/seen', async (context) => {
    const { sequence } = await parseBody(context.req.raw, MarkActivitySeenInputSchema);
    return context.json(application.markActivitySeen(context.req.param('projectId'), sequence));
  });

  app.get('/api/projects/:projectId/nodes/:nodeId/explanation', (context) =>
    context.json(
      application.explainNode(context.req.param('projectId'), context.req.param('nodeId'))
    )
  );

  app.onError((error, context) => {
    if (error instanceof RequestValidationError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'validation_error',
          error: 'The request was invalid.',
          details: {
            issues: validationIssues(error.issues)
          }
        }),
        400
      );
    }
    if (error instanceof EntityNotFoundError) {
      return context.json(ApiErrorSchema.parse({ code: 'not_found', error: error.message }), 404);
    }
    if (error instanceof VersionConflictError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'version_conflict',
          error: error.message,
          details: { currentVersion: error.currentVersion }
        }),
        409
      );
    }
    if (error instanceof RelationshipConflictError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'relationship_conflict',
          error: error.message,
          details: { violation: error.violation }
        }),
        409
      );
    }
    if (error instanceof CanvasItemConflictError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'canvas_item_conflict',
          error: error.message,
          details: {
            itemId: error.itemId,
            itemKind: error.itemKind,
            fields: error.fields
          }
        }),
        409
      );
    }
    if (error instanceof CommandReceiptConflictError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'command_conflict',
          error: error.message,
          details: { commandId: error.commandId }
        }),
        409
      );
    }
    if (error instanceof EntityIdConflictError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'entity_conflict',
          error: error.message,
          details: { entityType: error.entityType, entityId: error.entityId }
        }),
        409
      );
    }
    if (error instanceof ProjectConflictError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'project_conflict',
          error: error.message,
          details: { field: error.field, value: error.value }
        }),
        409
      );
    }
    if (error instanceof ProjectArchivedError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'project_archived',
          error: error.message,
          details: { projectId: error.projectId, archivedAt: error.archivedAt }
        }),
        409
      );
    }
    if (error instanceof ExecutionConflictError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'execution_conflict',
          error: error.message,
          details: { reason: error.reason, ...error.details }
        }),
        409
      );
    }
    if (error instanceof InvalidRequestJsonError) {
      return context.json(
        ApiErrorSchema.parse({
          code: 'invalid_json',
          error: 'The request body was not valid JSON.'
        }),
        400
      );
    }

    console.error(error);
    return context.json(
      ApiErrorSchema.parse({ code: 'unexpected', error: 'An unexpected local error occurred.' }),
      500
    );
  });

  return app;
}
