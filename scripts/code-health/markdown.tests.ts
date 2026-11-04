import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { run } from './index.js';
import { fixture } from './test-helpers.js';

void test('CommonMark policies validate effective links without code or text false positives', async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, 'docs/guide'), { recursive: true });
  await mkdir(join(root, 'assets'), { recursive: true });
  await mkdir(join(root, 'ignored'), { recursive: true });
  await mkdir(join(root, 'apps/web/dist'), { recursive: true });
  for (const name of ['plain.png', 'space name.png', 'hash#question?percent%雪.png']) {
    await writeFile(join(root, 'assets', name), 'binary', 'utf8');
  }
  await writeFile(join(root, 'ignored/bad.png'), 'binary', 'utf8');
  await writeFile(join(root, 'apps/web/dist/bad.png'), 'binary', 'utf8');
  await writeFile(join(root, 'docs/guide/README.md'), '# Guide\n', 'utf8');
  await writeFile(
    join(root, 'docs/links.md'),
    [
      '[inline](../assets/plain.png?download=1#preview)',
      '![image](<../assets/space name.png>)',
      '[encoded](../assets/hash%23question%3Fpercent%25%E9%9B%AA.png)',
      '[directory](guide/)',
      '[current directory](./)',
      '[repository root](/)',
      '[parent directory](../)',
      '[network](//cdn.example.test/asset.png)',
      '\\[escaped][missing-escaped]',
      '[not a link\\][missing-closing-bracket]',
      '[also not a link][missing-identifier\\]',
      '[not a reference][ ]',
      '[not a tab reference][\t]',
      '[reference][asset]',
      '[collapsed missing][]',
      '',
      '[asset]: ../assets/plain.png',
      '[duplicate][same]',
      '',
      '[same]: ../assets/plain.png',
      '[same]: ../missing-ignored.png',
      '[bad]: ../missing-effective.png',
      '[bad]: ../assets/plain.png',
      '[missing][nope]',
      '[ignored](../ignored/bad.png)',
      '[generated](../apps/web/dist/bad.png)',
      '[outside](../../outside.png)',
      '```md',
      '[fenced]: ../missing.png',
      '```',
      '`[inline code](../missing.png)`',
      '<!-- [comment](../missing.png) -->',
      '[uses fenced][fenced]'
    ].join('\n'),
    'utf8'
  );
  const offenses = (await run({ root })).report.metrics.brokenRelativeMarkdownLinks;
  assert.equal(offenses.length, 7, JSON.stringify(offenses, null, 2));
  const messages = offenses.map((item) => item.message).join('\n');
  assert.match(messages, /missing-effective\.png/);
  assert.match(messages, /reference: nope/);
  assert.match(messages, /reference: collapsed missing/);
  assert.match(messages, /reference: fenced/);
});
