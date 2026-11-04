import { createN2Client } from '@n2/client';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import {
  captureShot,
  inspect,
  inspectorFrame,
  kanbanFrame,
  panBesideInspector,
  showView,
  type Shot
} from './capture.js';
import { BLOCKED_TASK, seedDemoProject } from './demoProject.js';
import { startSelfHost } from './selfHost.js';

// Regenerates the README screenshots: builds N2, runs it on a throwaway library, seeds the demo
// Project through public commands and captures each shot. See CONTRIBUTING.md.

const root = process.cwd();
const output = join(root, 'docs/images');

const shots: readonly Shot[] = [
  { name: 'canvas-midnight', theme: 'midnight' },
  { name: 'canvas-paper', theme: 'paper' },
  {
    name: 'inspector-blocked',
    theme: 'midnight',
    prepare: async (page) => {
      await inspect(page, BLOCKED_TASK.reference);
      await panBesideInspector(page, BLOCKED_TASK.groupReference);
    },
    frame: inspectorFrame
  },
  {
    name: 'kanban',
    theme: 'midnight',
    prepare: (page) => showView(page, 'Kanban'),
    frame: kanbanFrame
  }
];

async function main(): Promise<void> {
  // Always rebuild unless told not to, so a stale bundle never ends up in the README.
  if (!process.argv.includes('--skip-build')) {
    execFileSync('pnpm', ['--filter', '@n2/web', '--filter', '@n2/server', 'build'], {
      stdio: 'inherit'
    });
  }
  const server = startSelfHost(root);
  let browser: Browser | undefined;
  let cleaning: Promise<void> | undefined;
  // One shared cleanup, so a signal during normal teardown waits for it instead of starting another.
  const cleanUp = (): Promise<void> =>
    (cleaning ??= (async () => {
      try {
        await browser?.close();
      } finally {
        await server.stop();
      }
    })());
  // Ctrl-C or a kill skips the finally block below, which would leave the server running and its
  // library on disk. Playwright's own handlers exit before that cleanup ends, so they are off.
  const exitOnSignal = (signal: NodeJS.Signals): void => {
    void cleanUp().finally(() => {
      // With nothing left behind, re-raise the signal so the process ends the way it asked.
      process.off('SIGINT', exitOnSignal).off('SIGTERM', exitOnSignal);
      process.kill(process.pid, signal);
    });
  };
  process.on('SIGINT', exitOnSignal).on('SIGTERM', exitOnSignal);
  try {
    const origin = await server.ready;
    const client = createN2Client({ baseUrl: origin, actor: { kind: 'person' } });
    const projectId = await seedDemoProject(client);
    // The minimap would cover part of the frame and repeat what the shot already shows.
    await client.updateApplicationPreference({ key: 'minimapVisible', value: false });
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false });
    mkdirSync(output, { recursive: true });
    for (const shot of shots) {
      const image = await captureShot({ browser, client, origin, projectId }, shot);
      writeFileSync(join(output, `${shot.name}.webp`), image);
      console.log(`docs/images/${shot.name}.webp  ${Math.round(image.length / 1024)} KB`);
    }
  } finally {
    // Keep the handlers until cleanup settles: without them a signal would end it partway.
    try {
      await cleanUp();
    } finally {
      process.off('SIGINT', exitOnSignal).off('SIGTERM', exitOnSignal);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
