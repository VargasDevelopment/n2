import { runCli } from './cli.js';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

process.exitCode = await runCli(process.argv.slice(2));
