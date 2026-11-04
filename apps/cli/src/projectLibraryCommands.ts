import type { N2Client } from '@n2/client';
import { CreateProjectInputSchema, RenameProjectInputSchema } from '@n2/contracts';
import { CliInputError } from './cliInputError.js';
import { parseInitialProjectSettings } from './settingsCommands.js';

const PROJECT_LIBRARY_VERBS = ['list', 'create', 'rename', 'archive', 'restore'] as const;
type ProjectLibraryVerb = (typeof PROJECT_LIBRARY_VERBS)[number];

const isProjectLibraryVerb = (verb: string | undefined): verb is ProjectLibraryVerb =>
  PROJECT_LIBRARY_VERBS.some((candidate) => candidate === verb);

export const projectLibraryOptions = {
  'project list': { all: { type: 'boolean' as const } },
  'project create': {
    name: { type: 'string' as const },
    key: { type: 'string' as const },
    id: { type: 'string' as const },
    settings: { type: 'string' as const }
  },
  'project rename': { name: { type: 'string' as const } }
};

type ProjectLibraryInput = {
  noun: string;
  verb: string | undefined;
  positionals: readonly string[];
  values: Readonly<Record<string, string | boolean | undefined>>;
  client: N2Client;
};

const usage = (message: string): CliInputError => new CliInputError('usage_error', message);

/**
 * Lifecycle changes require an explicit `--project` rather than inheriting `N2_PROJECT_ID` or the
 * starter Project, so an ambient default can never rename or archive the wrong Project.
 */
const explicitProjectId = (verb: ProjectLibraryVerb, project: unknown): string => {
  if (typeof project !== 'string' || !project.trim()) {
    throw usage(`project ${verb} requires an explicit --project <id>.`);
  }
  return project.trim();
};

const createProject = (values: ProjectLibraryInput['values'], client: N2Client) => {
  if (values.id === undefined) {
    throw usage('Project ID is required so creation can be retried safely.');
  }
  const creation = CreateProjectInputSchema.safeParse({
    projectId: values.id,
    name: values.name,
    referenceKey: values.key,
    settings: parseInitialProjectSettings(
      typeof values.settings === 'string' ? values.settings : undefined
    )
  });
  if (!creation.success) {
    throw usage(creation.error.issues[0]?.message ?? 'Project creation options are invalid.');
  }
  return client.createProject(creation.data);
};

export const runProjectLibraryCommand = async ({
  noun,
  verb,
  positionals,
  values,
  client
}: ProjectLibraryInput): Promise<{ handled: false } | { handled: true; output: unknown }> => {
  if (noun !== 'project' || !isProjectLibraryVerb(verb)) return { handled: false };
  if (positionals.length > 0) throw usage(`project ${verb} does not accept arguments.`);

  if (verb === 'list' || verb === 'create') {
    if (values.project !== undefined) {
      throw usage(
        verb === 'list'
          ? 'project list does not accept --project.'
          : 'project create uses --id for retry identity and does not accept --project.'
      );
    }
    return {
      handled: true,
      output:
        verb === 'list'
          ? await client.listProjects({ includeArchived: values.all === true })
          : await createProject(values, client)
    };
  }

  const projectId = explicitProjectId(verb, values.project);
  if (verb === 'archive') {
    return { handled: true, output: await client.archiveProject(projectId) };
  }
  if (verb === 'restore') {
    return { handled: true, output: await client.restoreProject(projectId) };
  }
  const rename = RenameProjectInputSchema.safeParse({ name: values.name });
  if (!rename.success) {
    throw usage('project rename requires --name with 1 to 120 characters.');
  }
  return { handled: true, output: await client.renameProject(projectId, rename.data) };
};
