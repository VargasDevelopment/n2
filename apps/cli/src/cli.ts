import {
  createN2Client,
  N2ApiError,
  N2ProtocolError,
  N2TransportError,
  type N2Client
} from '@n2/client';
import { projectCommandJsonSchema, ProjectCommandSchema } from '@n2/contracts';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z, ZodError } from 'zod';
import { CliInputError } from './cliInputError.js';
import { projectLibraryOptions, runProjectLibraryCommand } from './projectLibraryCommands.js';
import { runSettingsCommand, SettingsCliInputError } from './settingsCommands.js';

const DEFAULT_API_URL = 'http://127.0.0.1:4317';
const DEFAULT_PROJECT_ID = 'default';

class CliFileError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string
  ) {
    super(path ? 'The command file could not be read.' : 'Command file path cannot be blank.');
  }
}

export type CliRuntime = {
  env: Readonly<Record<string, string | undefined>>;
  fetch: typeof globalThis.fetch;
  readStdin: () => Promise<string>;
  readFile: (path: string) => Promise<string>;
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

const defaultRuntime: CliRuntime = {
  env: process.env,
  fetch: globalThis.fetch,
  readStdin: async () => {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin as AsyncIterable<string>) input += chunk;
    return input;
  },
  readFile: (path) => readFile(path, 'utf8'),
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value)
};

const help = `N² local command interface

Usage:
  n2 project list [--all] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 project create --id <uuid> --name <name> --key <reference-key> [--settings <json>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 project show [--project <id>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 project rename --project <id> --name <name> [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 project archive|restore --project <id> [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 settings application show|set <key> <value>|restore <key> [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 settings project show|set <key> <value>|clear <key> [--project <id>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 node explain <node-id-or-reference> [--project <id>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 execution show [--project <id>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 activity show [--project <id>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 execution preview <group-id> [--project <id>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 command run [--file <path> | --data <json>] [--project <id>] [--api-url <url>] [--timeout-ms <ms>] [--pretty]
  n2 command schema [--pretty]

Without --file or --data, command run reads one JSON command document from stdin.
project list omits Archived Projects unless --all is given. Archived Projects reject every change
until restored; rename, archive, and restore require an explicit --project.
Every successful data command writes JSON to stdout. Errors are JSON on stderr.
Changes are attributed in Project Activity to the agent named by N2_AGENT_NAME (default "cli").
`;

const commonOptions = {
  project: { type: 'string' as const },
  'api-url': { type: 'string' as const },
  'timeout-ms': { type: 'string' as const },
  pretty: { type: 'boolean' as const, default: false },
  help: { type: 'boolean' as const, short: 'h' }
};

const CliOptionValuesSchema = z
  .object({
    project: z.string().optional(),
    'api-url': z.string().optional(),
    'timeout-ms': z.string().optional(),
    pretty: z.boolean().default(false),
    help: z.boolean().optional()
  })
  .catchall(z.union([z.string(), z.boolean()]));

type CliOptionValues = z.infer<typeof CliOptionValuesSchema>;

const CommandInputOptionsSchema = z.object({
  file: z.string().optional(),
  data: z.string().optional()
});

const CliConfigSchema = z.object({
  projectId: z.string().trim().min(1, 'Project ID cannot be blank.'),
  apiUrl: z
    .string()
    .trim()
    .min(1, 'API URL must be an absolute URL.')
    .refine((value) => URL.canParse(value), { message: 'API URL must be an absolute URL.' })
    .refine(
      (value) => !URL.canParse(value) || ['http:', 'https:'].includes(new URL(value).protocol),
      {
        message: 'API URL must use HTTP or HTTPS.'
      }
    ),
  timeoutMs: z.coerce.number().int().positive().max(300_000)
});

type ParseArgsConfig = NonNullable<Parameters<typeof parseArgs>[0]>;
type ParseArgsOptions = NonNullable<ParseArgsConfig['options']>;

const commandOptions: Readonly<Record<string, ParseArgsOptions>> = {
  'command run': { file: { type: 'string' }, data: { type: 'string' } },
  ...projectLibraryOptions
};

const serialize = (value: unknown, pretty: boolean): string =>
  `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;

const parseCommon = (args: string[], extraOptions: ParseArgsOptions = {}) => {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: { ...commonOptions, ...extraOptions }
    });
    return { ...parsed, values: CliOptionValuesSchema.parse(parsed.values) };
  } catch (cause) {
    if (cause instanceof TypeError) throw new CliInputError('usage_error', cause.message);
    throw cause;
  }
};

const commandInput = async (
  values: { file?: string; data?: string },
  runtime: CliRuntime
): Promise<unknown> => {
  if (values.file !== undefined && values.data !== undefined) {
    throw new CliInputError('usage_error', 'Use only one of --file or --data.');
  }
  let source: string;
  if (values.data !== undefined) {
    source = values.data;
  } else if (values.file !== undefined) {
    if (!values.file.trim()) throw new CliFileError(values.file, 'The path was blank.');
    try {
      source = await runtime.readFile(values.file);
    } catch (cause) {
      throw new CliFileError(
        values.file,
        cause instanceof Error ? cause.message : 'The file system rejected the read.'
      );
    }
  } else {
    source = await runtime.readStdin();
  }
  if (!source.trim()) {
    throw new CliInputError('missing_input', 'A JSON command document is required.');
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new CliInputError('invalid_json', 'The command document is not valid JSON.');
  }
};

const writeError = (cause: unknown, runtime: CliRuntime): void => {
  if (cause instanceof N2ApiError) {
    runtime.stderr(
      serialize(
        {
          ok: false,
          error: {
            code: cause.body.code,
            message: cause.body.error,
            ...('details' in cause.body ? { details: cause.body.details } : {})
          }
        },
        false
      )
    );
    return;
  }
  if (cause instanceof ZodError) {
    runtime.stderr(
      serialize(
        {
          ok: false,
          error: {
            code: 'validation_error',
            message: 'The command document is invalid.',
            details: {
              issues: cause.issues.map(({ path, code, message }) => ({ path, code, message }))
            }
          }
        },
        false
      )
    );
    return;
  }
  if (cause instanceof CliInputError) {
    runtime.stderr(
      serialize({ ok: false, error: { code: cause.code, message: cause.message } }, false)
    );
    return;
  }
  if (cause instanceof SettingsCliInputError) {
    runtime.stderr(
      serialize({ ok: false, error: { code: 'usage_error', message: cause.message } }, false)
    );
    return;
  }
  if (cause instanceof CliFileError) {
    runtime.stderr(
      serialize(
        {
          ok: false,
          error: {
            code: 'file_error',
            message: cause.message,
            details: { path: cause.path, reason: cause.reason }
          }
        },
        false
      )
    );
    return;
  }
  if (cause instanceof N2ProtocolError) {
    runtime.stderr(
      serialize(
        {
          ok: false,
          error: {
            code: 'invalid_response',
            message: cause.message,
            details: { status: cause.status, issues: cause.issues }
          }
        },
        false
      )
    );
    return;
  }
  if (cause instanceof N2TransportError) {
    runtime.stderr(
      serialize({ ok: false, error: { code: cause.code, message: cause.message } }, false)
    );
    return;
  }
  runtime.stderr(
    serialize(
      {
        ok: false,
        error: {
          code: cause instanceof TypeError ? 'service_unavailable' : 'command_error',
          message: cause instanceof Error ? cause.message : 'The command failed.'
        }
      },
      false
    )
  );
};

const createCommandContext = (
  noun: string,
  verb: string | undefined,
  values: CliOptionValues,
  runtime: CliRuntime
) => {
  const configured = CliConfigSchema.safeParse({
    projectId:
      noun === 'settings' && verb === 'application'
        ? DEFAULT_PROJECT_ID
        : (values.project ?? runtime.env.N2_PROJECT_ID ?? DEFAULT_PROJECT_ID),
    apiUrl: values['api-url'] ?? runtime.env.N2_API_URL ?? DEFAULT_API_URL,
    timeoutMs: values['timeout-ms'] ?? runtime.env.N2_TIMEOUT_MS ?? '10000'
  });
  if (!configured.success) {
    throw new CliInputError(
      'usage_error',
      configured.error.issues[0]?.message ?? 'The CLI configuration is invalid.'
    );
  }
  const { projectId, apiUrl, timeoutMs } = configured.data;
  // The CLI is the headless agent adapter, so its changes are attributed to a named agent.
  const actor = { kind: 'agent', name: runtime.env.N2_AGENT_NAME?.trim() || 'cli' } as const;
  const client = createN2Client({ baseUrl: apiUrl, fetch: runtime.fetch, timeoutMs, actor });
  return { projectId, client };
};

const runProjectCommand = async ({
  noun,
  verb,
  positionals,
  projectId,
  client,
  values,
  runtime
}: {
  noun: string;
  verb: string | undefined;
  positionals: readonly string[];
  projectId: string;
  client: N2Client;
  values: CliOptionValues;
  runtime: CliRuntime;
}): Promise<unknown> => {
  switch (`${noun} ${verb}`) {
    case 'project show': {
      if (positionals.length > 0) {
        throw new CliInputError('usage_error', 'project show does not accept arguments.');
      }
      return client.getProject(projectId);
    }

    case 'node explain': {
      const [nodeLocator, ...unexpected] = positionals;
      if (!nodeLocator || unexpected.length > 0) {
        throw new CliInputError(
          'usage_error',
          'node explain requires exactly one node ID or Canvas Item Reference.'
        );
      }
      return client.explainNode(projectId, nodeLocator);
    }

    case 'execution show': {
      if (positionals.length > 0) {
        throw new CliInputError('usage_error', 'execution show does not accept arguments.');
      }
      return client.getExecution(projectId);
    }

    case 'activity show': {
      if (positionals.length > 0) {
        throw new CliInputError('usage_error', 'activity show does not accept arguments.');
      }
      return client.getActivity(projectId);
    }

    case 'execution preview': {
      const [groupId, ...unexpected] = positionals;
      if (!groupId || unexpected.length > 0) {
        throw new CliInputError('usage_error', 'execution preview requires exactly one Group ID.');
      }
      return client.previewGroupEnablement(projectId, groupId);
    }

    case 'command run': {
      if (positionals.length > 0) {
        throw new CliInputError('usage_error', 'command run does not accept arguments.');
      }
      const inputOptions = CommandInputOptionsSchema.parse({
        file: values.file,
        data: values.data
      });
      const parsed = ProjectCommandSchema.parse(
        await commandInput(
          {
            ...(inputOptions.file === undefined ? {} : { file: inputOptions.file }),
            ...(inputOptions.data === undefined ? {} : { data: inputOptions.data })
          },
          runtime
        )
      );
      return client.executeCommand(projectId, parsed);
    }
  }

  throw new CliInputError(
    'usage_error',
    `Unknown command: ${[noun, verb].filter(Boolean).join(' ')}.`
  );
};

export async function runCli(
  args: string[],
  runtime: CliRuntime = defaultRuntime
): Promise<number> {
  try {
    const [noun, verb, ...rest] = args;
    if (!noun || noun === 'help' || noun === '--help' || noun === '-h') {
      runtime.stdout(help);
      return 0;
    }

    if (noun === 'command' && verb === 'schema') {
      const { values, positionals } = parseCommon(rest);
      if (values.help) {
        runtime.stdout(help);
        return 0;
      }
      if (positionals.length > 0) {
        throw new CliInputError('usage_error', 'command schema does not accept arguments.');
      }
      runtime.stdout(serialize(projectCommandJsonSchema(), values.pretty));
      return 0;
    }

    const { values, positionals } = parseCommon(rest, commandOptions[`${noun} ${verb}`]);
    if (values.help) {
      runtime.stdout(help);
      return 0;
    }
    const { projectId, client } = createCommandContext(noun, verb, values, runtime);

    const projectLibraryResult = await runProjectLibraryCommand({
      noun,
      verb,
      positionals,
      values,
      client
    });
    if (projectLibraryResult.handled) {
      runtime.stdout(serialize(projectLibraryResult.output, values.pretty));
      return 0;
    }

    const settingsResult = await runSettingsCommand({
      noun,
      scope: verb,
      positionals,
      projectId,
      hasProjectSelector: values.project !== undefined,
      client
    });
    if (settingsResult.handled) {
      runtime.stdout(serialize(settingsResult.output, values.pretty));
      return 0;
    }

    const output = await runProjectCommand({
      noun,
      verb,
      positionals,
      projectId,
      client,
      values,
      runtime
    });
    runtime.stdout(serialize(output, values.pretty));
    return 0;
  } catch (cause) {
    writeError(cause, runtime);
    return 1;
  }
}
