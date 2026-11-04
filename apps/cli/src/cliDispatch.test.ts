import { describe, expect, it, vi } from 'vitest';
import { runCli, type CliRuntime } from './cli.js';

const runtime = (): CliRuntime => ({
  env: {},
  fetch: vi.fn<typeof globalThis.fetch>(),
  readStdin: vi.fn(),
  readFile: vi.fn(),
  stdout: vi.fn(),
  stderr: vi.fn()
});

describe('CLI command dispatch', () => {
  it.each([
    ['project', 'show', 'extra', 'project show does not accept arguments.'],
    ['execution', 'show', 'extra', 'execution show does not accept arguments.'],
    ['activity', 'show', 'extra', 'activity show does not accept arguments.'],
    ['command', 'run', 'extra', 'command run does not accept arguments.'],
    ['command', 'schema', 'extra', 'command schema does not accept arguments.'],
    ['node', 'explain', '', 'node explain requires exactly one node ID or Canvas Item Reference.'],
    ['execution', 'preview', '', 'execution preview requires exactly one Group ID.']
  ])('preserves argument errors for %s %s', async (noun, verb, argument, message) => {
    const test = runtime();

    expect(await runCli([noun, verb, argument], test)).toBe(1);
    expect(test.stderr).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ ok: false, error: { code: 'usage_error', message } })}\n`
    );
    expect(test.stdout).not.toHaveBeenCalled();
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.readStdin).not.toHaveBeenCalled();
  });

  it.each([
    ['node', 'explain', 'node explain requires exactly one node ID or Canvas Item Reference.'],
    ['execution', 'preview', 'execution preview requires exactly one Group ID.']
  ])('requires exactly one locator for %s %s', async (noun, verb, message) => {
    for (const positionals of [[], ['first', 'second']]) {
      const test = runtime();
      expect(await runCli([noun, verb, ...positionals], test)).toBe(1);
      expect(test.stderr).toHaveBeenCalledExactlyOnceWith(
        `${JSON.stringify({ ok: false, error: { code: 'usage_error', message } })}\n`
      );
      expect(test.fetch).not.toHaveBeenCalled();
    }
  });

  it.each([
    { args: ['unknown'], message: 'Unknown command: unknown.' },
    { args: ['project', 'unknown'], message: 'Unknown command: project unknown.' },
    { args: ['project show'], message: 'Unknown command: project show.' },
    { args: ['node', 'explain extra'], message: 'Unknown command: node explain extra.' },
    { args: ['command', ''], message: 'Unknown command: command.' },
    { args: ['execution', 'unknown', 'ignored'], message: 'Unknown command: execution unknown.' }
  ])('preserves unknown-command errors for $args', async ({ args, message }) => {
    const test = runtime();

    expect(await runCli(args, test)).toBe(1);
    expect(test.stderr).toHaveBeenCalledExactlyOnceWith(
      `${JSON.stringify({ ok: false, error: { code: 'usage_error', message } })}\n`
    );
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it('validates configuration before command arguments', async () => {
    const test = runtime();
    test.env = { N2_PROJECT_ID: '' };

    expect(await runCli(['execution', 'show', 'extra'], test)).toBe(1);
    expect(test.stderr).toHaveBeenCalledExactlyOnceWith(
      '{"ok":false,"error":{"code":"usage_error","message":"Project ID cannot be blank."}}\n'
    );
    expect(test.fetch).not.toHaveBeenCalled();
  });

  it('serves help and schema before validating service configuration', async () => {
    const test = runtime();
    test.env = { N2_PROJECT_ID: '', N2_API_URL: '', N2_TIMEOUT_MS: '' };

    expect(await runCli(['execution', 'show', 'extra', '--help'], test)).toBe(0);
    expect(await runCli(['command', 'schema'], test)).toBe(0);
    expect(test.stdout).toHaveBeenCalledTimes(2);
    expect(test.stderr).not.toHaveBeenCalled();
    expect(test.fetch).not.toHaveBeenCalled();
  });
});
