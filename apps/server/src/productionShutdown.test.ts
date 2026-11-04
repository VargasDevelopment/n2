import { expect, it, vi } from 'vitest';

const { localClose, frontendClose, repositoryClose } = vi.hoisted(() => ({
  localClose: vi.fn<(callback: () => void) => void>(),
  frontendClose: vi.fn<(callback: () => void) => void>(),
  repositoryClose: vi.fn()
}));

vi.mock('@hono/node-server', () => ({
  serve: vi
    .fn()
    .mockReturnValueOnce({ close: localClose })
    .mockReturnValueOnce({ close: frontendClose })
}));
vi.mock('@n2/db', () => ({
  ProjectRepository: class {
    readiness = vi.fn();
    close = repositoryClose;
  }
}));

it('starts draining both listeners immediately and closes the repository only after both finish', async () => {
  vi.stubEnv('N2_DB_PATH', '/unused/n2.sqlite');
  vi.stubEnv('N2_TAILSCALE_LOGIN', 'owner@example.invalid');
  vi.stubEnv('N2_PUBLIC_ORIGIN', 'https://n2.example.invalid');
  const previous = new Set(process.listeners('SIGTERM'));
  try {
    await import('./production.js');
    const shutdown = process.listeners('SIGTERM').find((listener) => !previous.has(listener));
    expect(shutdown).toBeDefined();
    shutdown?.('SIGTERM');

    expect(frontendClose).toHaveBeenCalledOnce();
    expect(localClose).toHaveBeenCalledOnce();
    expect(repositoryClose).not.toHaveBeenCalled();

    localClose.mock.calls[0]?.[0]();
    await Promise.resolve();
    expect(repositoryClose).not.toHaveBeenCalled();

    frontendClose.mock.calls[0]?.[0]();
    await vi.waitFor(() => expect(repositoryClose).toHaveBeenCalledOnce());
  } finally {
    for (const listener of process.listeners('SIGTERM')) {
      if (!previous.has(listener)) {
        process.removeListener('SIGTERM', listener);
        process.removeListener('SIGINT', listener);
      }
    }
    vi.unstubAllEnvs();
  }
});
